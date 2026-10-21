/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * HTTP routes - Running tests: flow list, suites, start / stop a run, steps for "run from step".
 * Routes only read the request, call the feature module and answer.
 * The logic lives in the modules required below.
 */
const security = require("../core/security");
const state = require("../core/state");
const runner = require("../run/runner");
const suites = require("../run/suites");
const android = require("../device/android");
const partial = require("../run/partial");
// Runner only accepts flow paths that are safe inside a quoted command line
const FLOW_SAFE = /^[A-Za-z0-9._\-\/ ]{1,200}$/;

module.exports = function register(r, ctx) {
  const { GET, POST, json } = r;

  /* Suites */
  GET("/api/suites", (req, res) => json(res, 200, suites.list()));
  POST("/api/suites/save", async (req, res) => {
    const b = await security.readJson(req);
    suites.save(b, new Set(runner.listFlowPaths()));
    json(res, 200, { ok: true, suites: suites.list() });
  });
  POST("/api/suites/delete", async (req, res) => {
    const b = await security.readJson(req);
    suites.remove(String(b.name || ""));
    json(res, 200, { ok: true, suites: suites.list() });
  });
  /* Flows, reports */
  GET("/api/flows",   (req, res) => json(res, 200, runner.listFlows()));
  /* Run flows */
  POST("/api/run", async (req, res) => {
    const parsed = await security.readJson(req);
    const valid  = new Set(runner.listFlowPaths());
    let items = Array.isArray(parsed.items) ? parsed.items
              : (parsed.flows || []).map(f => ({ flow: f, rows: "" }));
    items = items.filter(it => it && valid.has(it.flow))
                 .map(it => ({ flow: it.flow, rows: String(it.rows || "").slice(0, 200),
                               fromStep: it.fromStep ? parseInt(it.fromStep, 10) || null : null }));
    const unsafe = items.filter(it => !FLOW_SAFE.test(it.flow) || it.flow.includes(".."));
    if (unsafe.length) return json(res, 400, { ok: false,
      error: "Rename these flows (use letters, numbers, spaces, - _ .): " + unsafe.map(i => i.flow).join(", ") });
    if (!items.length) return json(res, 400, { ok: false, error: "no valid flows" });
    let device = android.SERIAL_RE.test(String(parsed.device || "")) ? String(parsed.device) : null;
    if (device) {                                          // only if it is really connected now
      const list = await android.devices().catch(() => []);
      if (!list.some(d => d.serial === device && d.state === "device")) device = null;
    }
    const jobs = runner.buildJobs(items, device);      // validates row selections
    const meta = { suite: parsed.suite ? String(parsed.suite).slice(0, 60) : null, device };
    if (state.busy) return json(res, 409, { ok: false, error: "busy" });
    state.busy = true;
    state.stopRequested = false;
    json(res, 202, { ok: true, started: true, total: jobs.length });
    runner.runFlows(jobs, !!parsed.stopOnFail, meta);
  });
  POST("/api/stop", (req, res) => {
    if (state.busy) {
      state.stopRequested = true;
      runner.broadcast("\n[STOP] Stopping test run...\n");
      if (state.currentChild) runner.killTree(state.currentChild);
    }
    json(res, 200, { ok: true });
  });
  /* Flow file I/O */
  GET("/api/flow/commands", (req, res, u) => json(res, 200, { steps: partial.commands(u.searchParams.get("path")) }));
};
