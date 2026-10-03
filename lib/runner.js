/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Flow discovery + Maestro run orchestration + SSE broadcast.
 */

const fs = require("fs");
const path = require("path");
const { spawn, exec } = require("child_process");
const state = require("./state");
const flowIo = require("./flows-io");
const prepare = require("./prepare");
const flowData = require("./flow-data");
const live = require("./live-steps");
const history = require("./history");

const PROJECT_DIR = path.join(__dirname, "..");
const FLOWS_DIR   = path.join(PROJECT_DIR, "Flows");
const REPORTS_DIR = path.join(PROJECT_DIR, "Reports");
const RUNS_DIR    = path.join(PROJECT_DIR, ".runs");   // Maestro debug output of the last run

/* ---------- SSE ---------- */
const sseClients = new Set();

function emit(obj) {
  const payload = "data: " + JSON.stringify(obj) + "\n\n";
  for (const c of sseClients) {
    try { c.write(payload); }
    catch (_) { sseClients.delete(c); }
  }
}

const strip = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
function broadcast(text) { emit({ type: "log", text: strip(String(text)) }); }

function addSseClient(res) { sseClients.add(res); }
function removeSseClient(res) { sseClients.delete(res); }

/* ---------- Flow discovery ---------- */
function walkFlowPaths(dir, base, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const e of entries) {
    if (!e.isDirectory() && /\.ya?ml$/i.test(e.name))
      out.push(base ? base + "/" + e.name : e.name);
  }
  for (const e of entries) {
    if (e.isDirectory())
      walkFlowPaths(path.join(dir, e.name), base ? base + "/" + e.name : e.name, out);
  }
}

// Returns [{ path, appId }]
function listFlows() {
  if (!fs.existsSync(FLOWS_DIR)) return [];
  const paths = [];
  walkFlowPaths(FLOWS_DIR, "", paths);
  return paths.map(p => ({ path: p, appId: flowIo.peekAppId(p), tags: flowIo.peekTags(p),
                           sheets: flowData.flowSheets(p) }));
}

// Convenience: just the paths (used by /api/run validation)
function listFlowPaths() { return listFlows().map(f => f.path); }

// Report named after the flow: sub/login.yaml -> sub__login.html
function reportNameFor(flow) {
  return flow.replace(/\.ya?ml$/i, "").replace(/\//g, "__")
             .replace(/[^a-zA-Z0-9._-]/g, "_") + ".html";
}

function listReports() {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  return fs.readdirSync(REPORTS_DIR)
    .filter(f => f.toLowerCase().endsWith(".html"))
    .map(f => ({ name: f, time: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
    .map(r => r.name);
}

/* ---------- Process control ---------- */
function killTree(child) {
  if (!child || !child.pid) return;
  exec("taskkill /PID " + child.pid + " /T /F", () => {});
}

// Prepare Data now runs in-process (lib/prepare.js). No run-server.bat,
// no json-server, no port 8080: the data is embedded in Scripts/**/*.js.
function runSetup() {
  return new Promise(resolve => {
    try {
      const r = prepare.prepareData(broadcast);
      resolve(r.ok ? 0 : 1);
    } catch (e) {
      broadcast("[ERROR] " + e.message + "\n");
      resolve(1);
    }
  });
}

function runMaestro(job, reportPath, debugDir) {
  return new Promise(resolve => {
    let envArgs = "";
    for (const k of Object.keys(job.env || {})) {
      const v = String(job.env[k]);
      envArgs += ' -e "' + k + '=' + v.replace(/"/g, '\\"') + '"';
    }
    const cmd = 'maestro test "Flows/' + job.flow + '" --format html-detailed --output "' +
                reportPath + '" --debug-output "' + debugDir + '"' + envArgs;
    broadcast("$ " + cmd + "\n");

    // Live steps from maestro.log -> UI step list + readable console lines
    const icons = { RUNNING: "\u25B6", COMPLETED: "\u2713", FAILED: "\u2717", SKIPPED: "\u21B7", WARNED: "!" };
    const tailer = live.tail(debugDir, st => {
      if (st.flow) { broadcast("  > Flow " + st.flow + "\n"); return; }
      emit({ type: "step", id: job.id, desc: st.desc, status: st.status, ts: st.ts });
      if (st.status === "FAILED" && !job.failedStep) job.failedStep = st.desc;   // innermost failure
      if (st.status !== "RUNNING") broadcast("  " + icons[st.status] + " " + st.desc + "  " + st.status + "\n");
    });

    const child = spawn(cmd, { cwd: PROJECT_DIR, shell: true, windowsHide: true });
    state.currentChild = child;
    if (state.stopRequested) killTree(child);
    child.stdout.on("data", d => broadcast(d.toString()));
    child.stderr.on("data", d => broadcast(d.toString()));
    child.on("error", e => { tailer.stop(); broadcast("[ERROR] " + e.message + "\n"); resolve(1); });
    child.on("close", code => { tailer.stop(); state.currentChild = null; resolve(code); });
  });
}

/**
 * Expand queue items into jobs, one per (flow, row).
 * items: [{ flow: "TC-001.yaml", rows: "all" | "2,7,13" | "2-5" | "" }]
 * Throws with a readable message if a row selection is invalid.
 */
function buildJobs(items) {
  const jobs = [];
  for (const it of items) {
    const direct = flowData.flowSheets(it.flow).filter(sh => !sh.sub);
    if (!direct.length) {                       // flow has no Excel data
      jobs.push({ id: it.flow, flow: it.flow, row: null, label: it.flow, env: {} });
      continue;
    }
    let rows;
    try { rows = flowData.parseRows(it.rows, direct[0].rows); }
    catch (e) { throw new Error(it.flow + ": " + e.message); }
    for (const r of rows) {
      const env = {};
      direct.forEach(sh => { env[sh.var] = r; });   // every direct sheet uses this row
      jobs.push({ id: it.flow + "#" + r, flow: it.flow, row: r,
                  label: it.flow + "  \u00b7  row " + r, env });
    }
  }
  return jobs;
}

async function runFlows(jobs, stopOnFail, meta) {
  meta = meta || {};
  const runStarted = Date.now();
  const results = [];
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  try { fs.rmSync(RUNS_DIR, { recursive: true, force: true }); } catch (_) {}
  emit({ type: "queue", jobs: jobs.map(j => ({ id: j.id, label: j.label, flow: j.flow, row: j.row })) });

  try {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (state.stopRequested || (stopOnFail && results.some(r => !r.ok))) break;

      emit({ type: "start", id: job.id, label: job.label, index: i, total: jobs.length });
      broadcast("\n=== [" + (i + 1) + "/" + jobs.length + "] " + job.label + " ===\n");

      const reportName = reportNameFor(job.flow).replace(/\.html$/,
        job.row ? "__row" + job.row + ".html" : ".html");
      const reportPath = path.join(REPORTS_DIR, reportName);
      try { fs.unlinkSync(reportPath); } catch (_) {}

      const debugDir = path.join(RUNS_DIR, job.id.replace(/[^a-zA-Z0-9._-]/g, "_"));
      fs.mkdirSync(debugDir, { recursive: true });
      const started = Date.now();
      const code    = await runMaestro(job, reportPath, debugDir);
      const stopped = state.stopRequested;
      const shot    = code !== 0 ? live.failureScreenshot(debugDir) : null;
      const r = {
        id: job.id, flow: job.flow, row: job.row, label: job.label,
        ok: code === 0 && !stopped,
        stopped,
        reportName,
        report: fs.existsSync(reportPath) ? "/reports/" + encodeURIComponent(reportName) : null,
        duration: Date.now() - started,
        failedStep: job.failedStep || null,
        screenshot: shot ? "/runs/" + path.relative(RUNS_DIR, shot).split(path.sep).map(encodeURIComponent).join("/") : null
      };
      results.push(r);
      emit(Object.assign({ type: "result" }, r));
    }

    for (const job of jobs.slice(results.length)) {
      const r = { id: job.id, flow: job.flow, row: job.row, label: job.label, ok: false, skipped: true, report: null };
      results.push(r);
      emit({ type: "skipped", id: job.id });
    }

    const passed  = results.filter(r => r.ok).length;
    const failed  = results.filter(r => !r.ok && !r.skipped && !r.stopped).length;
    const skipped = results.filter(r => r.skipped || r.stopped).length;
    broadcast("\n[DONE] " + passed + " passed, " + failed + " failed, " +
      skipped + " skipped/stopped\n");
    try {
      history.add({
        id: String(runStarted), started: runStarted, finished: Date.now(),
        suite: meta.suite || null, passed, failed, skipped,
        jobs: results.map(r => ({
          id: r.id, flow: r.flow, row: r.row, label: r.label,
          status: r.skipped ? "skipped" : r.stopped ? "stopped" : r.ok ? "pass" : "fail",
          duration: r.duration || 0, failedStep: r.failedStep || null, report: r.report || null
        }))
      });
    } catch (e) { broadcast("[WARN] Could not save run history: " + e.message + "\n"); }
    emit({ type: "done", ok: results.every(r => r.ok), passed, failed, skipped, results });
  } catch (e) {
    emit({ type: "done", ok: false, error: e.message, passed: 0, failed: 1, skipped: 0, results });
    broadcast("[ERROR] " + e.message + "\n");
  } finally {
    state.reset();
  }
}

module.exports = {
  PROJECT_DIR, FLOWS_DIR, REPORTS_DIR, RUNS_DIR,
  emit, broadcast, addSseClient, removeSseClient,
  listFlows, listFlowPaths, listReports, reportNameFor,
  killTree, runSetup, runMaestro, runFlows, buildJobs
};