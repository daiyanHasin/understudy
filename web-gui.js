/*
 * Understudy — local web GUI server
 * Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE.
 *
 * Portions are derived from "Maestro Excel Data Driven Framework",
 * Copyright 2026 Md. Mohai Minul Islam, licensed under the Apache License 2.0
 * (https://github.com/mohai17/Maestro-Excel-Data-Driven-Framework).
 * Those portions have been modified. See THIRD_PARTY_NOTICES.md and
 * LICENSES/Apache-2.0.txt.
 *
 * Layout:
 *   web-gui.js            (this file) HTTP routes, static files, SSE
 *   lib/security.js       session token, CSRF, origin + host checks, headers
 *   lib/android.js        SDK, adb, emulator, Wi-Fi phones, snapshots, frames, input, layout
 *   lib/recorder.js       selectors, steps <-> YAML, save flow + test data
 *   lib/capture.js        turns taps made on the device itself into steps
 *   lib/doctor.js         Setup checks
 *   lib/app-window.js     opens the UI in its own app window
 *   lib/runner.js         flow discovery, Maestro runs, jobs, SSE events
 *   lib/prepare.js        Excel -> Scripts/**.js data providers
 *   lib/flow-data.js      which sheets a flow uses, row selection parsing
 *   lib/live-steps.js     live step progress from maestro.log
 *   lib/excel.js          Excel editor read/write
 *   lib/flows-io.js       flow YAML read/save/rename/delete, appId + tags
 *   lib/history.js        run history (dashboard)
 *   lib/suites.js         saved test suites
 *   lib/state.js          shared busy/child flags
 *   index.html, styles.css, app.js, ui/*.js, assets/   browser UI
 *
 * Start options:
 *   --hidden    started by Understudy.vbs: no console, stops itself when the
 *               window has been closed for a while and nothing is running
 *   --no-open   don't open a window (e.g. you open the address yourself)
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const security = require("./lib/security");
const state    = require("./lib/state");
const runner   = require("./lib/runner");
const excel    = require("./lib/excel");
const flowIo   = require("./lib/flows-io");
const history  = require("./lib/history");
const suites   = require("./lib/suites");
const android  = require("./lib/android");
const recorder = require("./lib/recorder");
const doctor   = require("./lib/doctor");
const appWin   = require("./lib/app-window");
const capture  = require("./lib/capture");

// Browsers send *.localhost to this computer automatically: no hosts-file change needed.
const HOST_NAME   = "understudy.localhost";
const PORT        = 4545;
const URL_MAIN    = "http://" + HOST_NAME + ":" + PORT;
const HIDDEN      = process.argv.includes("--hidden");
const NO_OPEN     = process.argv.includes("--no-open");
const IDLE_MS     = 3 * 60 * 1000;
const APPS_DIR    = path.join(__dirname, "Apps");
const APK_LIMIT   = 800 * 1024 * 1024;

const PROJECT_DIR = __dirname;
const REPORTS_DIR = runner.REPORTS_DIR;

let CONFIG = {};
try { CONFIG = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "app.config.json"), "utf8")); } catch (_) {}

security.configure({ port: PORT, hostNames: [HOST_NAME] });

// Runner only accepts flow paths that are safe inside a quoted command line
const FLOW_SAFE = /^[A-Za-z0-9._\-\/ ]{1,200}$/;

/* ---------- Response helpers ---------- */
function json(res, status, obj) {
  res.writeHead(status, security.headers.api());
  res.end(JSON.stringify(obj));
}
function fail(res, e) {
  const status = e && e.status ? e.status : 400;
  json(res, status, { error: (e && e.message) || "Request failed" });
}

const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json"
};
function sendStatic(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, security.headers.plain("text/plain")); return res.end("Not found"); }
    res.writeHead(200, security.headers.app(STATIC_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream"));
    res.end(data);
  });
}
function sendIndex(res) {
  fs.readFile(path.join(PROJECT_DIR, "index.html"), "utf8", (err, html) => {
    if (err) { res.writeHead(500); return res.end("index.html missing"); }
    const h = security.headers.app("text/html; charset=utf-8");
    h["Set-Cookie"] = security.sessionCookie();
    h["Cache-Control"] = "no-store";
    res.writeHead(200, h);
    res.end(html.replace("__US_TOKEN__", security.TOKEN));
  });
}

/* ---------- Idle shutdown (hidden mode only) ---------- */
let sseCount = 0, lastActivity = Date.now();
function shutdown(reason) {
  console.log("Stopping Understudy (" + reason + ")");
  try { if (state.currentChild) runner.killTree(state.currentChild); } catch (_) {}
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
}
if (HIDDEN) {
  setInterval(() => {
    if (sseCount > 0 || state.busy) { lastActivity = Date.now(); return; }
    if (Date.now() - lastActivity > IDLE_MS) shutdown("window closed");
  }, 15000).unref();
}

/* ---------- Busy guard for device input ---------- */
function deviceFree() {
  if (state.busy) { const e = new Error("A test run is using the device. Wait for it to finish or stop it."); e.status = 409; throw e; }
}

/* ---------- API routes ---------- */
const routes = {};
const GET  = (p, fn) => { routes["GET "  + p] = fn; };
const POST = (p, fn) => { routes["POST " + p] = fn; };

/* Project */
GET("/api/project", (req, res) => {
  res.writeHead(200, security.headers.api("text/plain; charset=utf-8"));
  res.end(PROJECT_DIR);
});
GET("/api/session", (req, res) => json(res, 200, { ok: true, version: CONFIG.version || "", hidden: HIDDEN }));
POST("/api/shutdown", (req, res) => {
  if (state.busy) return json(res, 409, { error: "A run is in progress. Stop it first." });
  json(res, 200, { ok: true });
  shutdown("quit from the app");
});

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

/* History, data preview */
GET("/api/history", (req, res) => json(res, 200, history.list()));
GET("/api/data", (req, res, u) => {
  const ex = String(u.searchParams.get("excel") || ""), sh = String(u.searchParams.get("sheet") || "");
  if (!/^[\w-]+$/.test(ex) || !/^[\w-]+$/.test(sh)) return json(res, 400, { error: "bad name" });
  fs.readFile(path.join(PROJECT_DIR, "JsonData", ex, sh + ".json"), "utf8", (err, txt) => {
    if (err) return json(res, 404, { error: "No data yet. Run Prepare Data." });
    res.writeHead(200, security.headers.api());
    res.end(txt);
  });
});

/* Flows, reports */
GET("/api/flows",   (req, res) => json(res, 200, runner.listFlows()));
GET("/api/reports", (req, res) => json(res, 200, runner.listReports()));

/* SSE */
GET("/api/stream", (req, res) => {
  res.writeHead(200, security.headers.api("text/event-stream"));
  res.write(": connected\n\n");
  runner.addSseClient(res);
  sseCount++;
  req.on("close", () => { runner.removeSseClient(res); sseCount--; lastActivity = Date.now(); });
});

/* Prepare data */
POST("/api/setup", (req, res) => {
  if (state.busy) return json(res, 409, { ok: false, error: "busy" });
  state.busy = true;
  state.stopRequested = false;
  runner.broadcast("\n=== Prepare Data ===\n");
  runner.runSetup()
    .then(code => { runner.broadcast("\n[SETUP DONE] exit code: " + code + "\n"); json(res, 200, { ok: code === 0 }); })
    .catch(e => json(res, 500, { ok: false, error: e.message }))
    .finally(() => state.reset());
});

/* Run flows */
POST("/api/run", async (req, res) => {
  const parsed = await security.readJson(req);
  const valid  = new Set(runner.listFlowPaths());
  let items = Array.isArray(parsed.items) ? parsed.items
            : (parsed.flows || []).map(f => ({ flow: f, rows: "" }));
  items = items.filter(it => it && valid.has(it.flow))
               .map(it => ({ flow: it.flow, rows: String(it.rows || "").slice(0, 200) }));
  const unsafe = items.filter(it => !FLOW_SAFE.test(it.flow) || it.flow.includes(".."));
  if (unsafe.length) return json(res, 400, { ok: false,
    error: "Rename these flows (use letters, numbers, spaces, - _ .): " + unsafe.map(i => i.flow).join(", ") });
  if (!items.length) return json(res, 400, { ok: false, error: "no valid flows" });
  const jobs = runner.buildJobs(items);              // validates row selections
  const meta = { suite: parsed.suite ? String(parsed.suite).slice(0, 60) : null };
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
GET("/api/flow/read", (req, res, u) => {
  const rel = u.searchParams.get("path");
  json(res, 200, { path: rel, content: flowIo.readFlow(rel) });
});
function flowWrite(fn) {
  return async (req, res) => {
    if (state.busy) return json(res, 409, { error: "Another task is running." });
    fn(await security.readJson(req));
    json(res, 200, { ok: true });
  };
}
POST("/api/flow/save",      flowWrite(b => flowIo.saveFlow(b.path, b.content)));
POST("/api/flow/duplicate", flowWrite(b => flowIo.duplicateFlow(b.from, b.to)));
POST("/api/flow/delete",    flowWrite(b => flowIo.deleteFlow(b.path)));
POST("/api/flow/rename",    flowWrite(b => flowIo.renameFlow(b.from, b.to)));

/* Open a project folder in Explorer */
POST("/api/open-folder", async (req, res) => {
  const b = await security.readJson(req);
  const map = {
    reports: path.join(PROJECT_DIR, "Reports"), testdata: path.join(PROJECT_DIR, "TestData"),
    backups: path.join(PROJECT_DIR, "ExcelBackups"), flowbackups: path.join(PROJECT_DIR, "FlowBackups"),
    flows: path.join(PROJECT_DIR, "Flows"), apps: APPS_DIR, logs: path.join(PROJECT_DIR, "logs"),
    project: PROJECT_DIR
  };
  const target = map[String(b.kind || "")];
  if (!target) return json(res, 400, { error: "Unknown folder" });
  fs.mkdirSync(target, { recursive: true });
  if (process.platform === "win32") execFile("explorer.exe", [target], () => {});
  json(res, 200, { ok: true, path: target });
});

/* Excel */
GET("/api/excel/files", (req, res) => json(res, 200, { files: excel.scanExcel(), lib: excel.excelLib(), root: excel.EXCEL_ROOT }));
GET("/api/excel/read", async (req, res, u) => {
  const file = excel.resolveExcel(u.searchParams.get("file"));
  json(res, 200, { sheets: await excel.readExcel(file) });
});
POST("/api/excel/save", async (req, res) => {
  if (state.busy) return json(res, 409, { error: "Another task is running. Wait for it to finish." });
  const parsed = await security.readJson(req);
  const file   = excel.resolveExcel(parsed.file);
  const edits  = (parsed.edits || []).filter(e =>
    e && typeof e.sheet === "string" && Number.isInteger(e.r) && Number.isInteger(e.c) &&
    e.r >= 0 && e.c >= 0 && e.r < 100000 && e.c < 1000 && typeof e.v === "string");
  const ops    = (parsed.ops || []).filter(o =>
    o && typeof o.sheet === "string" &&
    ["insertRow", "deleteRow", "insertCol", "deleteCol"].includes(o.op) &&
    Number.isInteger(o.at) && o.at >= 0);
  if (!edits.length && !ops.length) return json(res, 400, { error: "No changes to save" });
  state.busy = true;
  try { await excel.applyExcelChanges(file, ops, edits); } finally { state.busy = false; }
  json(res, 200, { ok: true, saved: edits.length, ops: ops.length });
});
POST("/api/excel/newfile", async (req, res) => {
  if (state.busy) return json(res, 409, { error: "Another task is running. Wait for it to finish." });
  const parsed = await security.readJson(req);
  const sheet  = excel.checkSheetName(parsed.sheet || "Sheet1", []);
  const target = excel.resolveNewExcel(parsed.folder, parsed.name);
  state.busy = true;
  try { await excel.createExcel(target.dir, target.full, sheet, excel.parseHeaders(parsed.headers)); }
  finally { state.busy = false; }
  json(res, 200, { ok: true, path: path.relative(PROJECT_DIR, target.full).split(path.sep).join("/") });
});
POST("/api/excel/newsheet", async (req, res) => {
  if (state.busy) return json(res, 409, { error: "Another task is running. Wait for it to finish." });
  const parsed = await security.readJson(req);
  const file   = excel.resolveExcel(parsed.file);
  state.busy = true;
  try { await excel.addSheetToExcel(file, parsed.name, excel.parseHeaders(parsed.headers)); }
  finally { state.busy = false; }
  json(res, 200, { ok: true });
});

/* ----- Setup checks ----- */
GET("/api/doctor", async (req, res) => json(res, 200, { checks: await doctor.check() }));

/* ----- Devices ----- */
GET("/api/device/list", async (req, res) => {
  const [devices, avds] = await Promise.all([android.devices().catch(() => []), android.avds()]);
  const problems = {};
  avds.forEach(a => { const p = android.avdProblem(a); if (p) problems[a] = p; });
  json(res, 200, { devices, avds, problems });
});
POST("/api/device/start", async (req, res) => {
  const b = await security.readJson(req);
  json(res, 200, android.startAvd(b.avd, { headless: b.headless !== false, graphics: b.graphics, cold: !!b.cold }));
});
POST("/api/device/stop", async (req, res) => {
  const b = await security.readJson(req);
  capture.stop(String(b.serial || ""));
  json(res, 200, await android.stopDevice(b.serial));
});
POST("/api/device/connect", async (req, res) => {
  const b = await security.readJson(req);
  if (b.code) await android.pair(String(b.pairAddress || ""), String(b.code));
  json(res, 200, await android.connect(String(b.address || "")));
});
POST("/api/device/snapshot", async (req, res) => {
  deviceFree();
  const b = await security.readJson(req);
  json(res, 200, await android.snapshot(b.serial, b.action));
});
// Raw RGBA frame, shrunk on this PC. Headers carry the sizes.
GET("/api/device/frame", async (req, res, u) => {
  const f = await android.frame(u.searchParams.get("serial"), { prefetch: u.searchParams.get("prefetch") === "1" && !state.busy });
  const h = security.headers.api("application/octet-stream");
  h["X-Frame-W"] = f.w; h["X-Frame-H"] = f.h; h["X-Device-W"] = f.dw; h["X-Device-H"] = f.dh;
  h["Access-Control-Expose-Headers"] = "X-Frame-W, X-Frame-H, X-Device-W, X-Device-H";
  res.writeHead(200, h);
  res.end(f.data);
});
POST("/api/device/input", async (req, res) => {
  deviceFree();
  const b = await security.readJson(req);
  const s = b.serial;
  switch (b.action) {
    case "tap":       await android.tap(s, b.x, b.y); break;
    case "longPress": await android.longPress(s, b.x, b.y); break;
    case "swipe":     await android.swipe(s, b.x1, b.y1, b.x2, b.y2, b.ms); break;
    case "key":       await android.key(s, String(b.key)); break;
    case "text":      await android.text(s, b.text); break;
    case "hideKeyboard": await android.hideKeyboard(s); break;
    case "erase":     await android.erase(s, b.count); break;
    default: return json(res, 400, { error: "Unknown action" });
  }
  json(res, 200, { ok: true });
});
GET("/api/device/packages", async (req, res, u) =>
  json(res, 200, { packages: await android.packages(u.searchParams.get("serial")) }));
POST("/api/app/launch", async (req, res) => {
  deviceFree();
  const b = await security.readJson(req);
  json(res, 200, await android.launch(b.serial, b.package, !!b.clearState));
});

/* ----- APKs: kept only in the local Apps/ folder, never uploaded anywhere ----- */
function apkName(n) {
  const base = path.basename(String(n || "")).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!/\.apk$/i.test(base) || base.length > 100 || base.startsWith(".")) throw new Error("Choose an .apk file");
  return base;
}
function apkFile(n) {
  const full = path.resolve(APPS_DIR, apkName(n));
  if (!full.startsWith(APPS_DIR + path.sep) || !fs.existsSync(full)) throw new Error("APK not found");
  return full;
}
GET("/api/apk/list", (req, res) => {
  fs.mkdirSync(APPS_DIR, { recursive: true });
  const list = fs.readdirSync(APPS_DIR).filter(f => /\.apk$/i.test(f)).map(f => {
    const st = fs.statSync(path.join(APPS_DIR, f));
    return { name: f, size: st.size, mtime: st.mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime);
  json(res, 200, { apks: list });
});
POST("/api/apk/upload", (req, res, u) => new Promise((resolve, reject) => {
  const name = apkName(u.searchParams.get("name"));
  if (!/^application\/octet-stream\b/i.test(String(req.headers["content-type"] || ""))) {
    const e = new Error("Expected a file"); e.status = 415; throw e;
  }
  if (Number(req.headers["content-length"] || 0) > APK_LIMIT) { const e = new Error("APK is larger than 800 MB"); e.status = 413; throw e; }
  fs.mkdirSync(APPS_DIR, { recursive: true });
  const final = path.join(APPS_DIR, name), part = final + ".part";
  const out = fs.createWriteStream(part);
  let size = 0, head = null, aborted = false;
  const abort = (msg, status) => {
    if (aborted) return; aborted = true;
    out.destroy(); try { fs.unlinkSync(part); } catch (_) {}
    const e = new Error(msg); e.status = status || 400; reject(e);
  };
  req.on("data", c => {
    if (!head) head = c.subarray(0, 4);
    size += c.length;
    if (size > APK_LIMIT) { req.unpipe(out); req.resume(); abort("APK is larger than 800 MB", 413); }
  });
  req.pipe(out);
  req.on("error", () => abort("Upload interrupted"));
  out.on("finish", () => {
    if (aborted) return;
    if (!head || head[0] !== 0x50 || head[1] !== 0x4b) return abort("That file is not a valid APK");
    fs.renameSync(part, final);
    android.apkPackage(final).then(pkg => { json(res, 200, { ok: true, name, size, package: pkg }); resolve(); });
  });
}));
POST("/api/apk/install", async (req, res) => {
  deviceFree();
  const b = await security.readJson(req);
  json(res, 200, await android.install(b.serial, apkFile(b.name)));
});
POST("/api/apk/delete", async (req, res) => {
  const b = await security.readJson(req);
  fs.unlinkSync(apkFile(b.name));
  json(res, 200, { ok: true });
});

/* Android SDK setup without Android Studio (opens a visible PowerShell window) */
POST("/api/setup/android", (req, res) => {
  if (process.platform !== "win32") return json(res, 400, { error: "This installer is for Windows" });
  const script = path.join(PROJECT_DIR, "tools", "install-android.ps1");
  if (!fs.existsSync(script)) return json(res, 404, { error: "tools/install-android.ps1 is missing" });
  execFile("cmd.exe", ["/c", "start", "Understudy - Android setup", "powershell.exe",
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: false, cwd: PROJECT_DIR }, () => {});
  json(res, 200, { ok: true });
});

/* ----- Recorder ----- */
POST("/api/rec/inspect", async (req, res) => {
  deviceFree();
  const b = await security.readJson(req);
  const t0 = Date.now();
  const l = await android.layout(b.serial);
  const r = recorder.inspect(l.nodes, Number(b.x), Number(b.y));
  r.cached = l.cached; r.ms = Date.now() - t0;
  json(res, 200, r);
});
POST("/api/rec/preview", async (req, res) => {
  const b = await security.readJson(req);
  try { json(res, 200, { yaml: recorder.buildYaml(b).yaml }); }
  catch (e) { json(res, 200, { yaml: "", problem: e.message }); }
});
POST("/api/rec/parse", async (req, res) => {
  const b = await security.readJson(req);
  json(res, 200, await recorder.parseYaml(String(b.yaml || ""), Array.isArray(b.steps) ? b.steps : []));
});
GET("/api/rec/datafiles", (req, res) => json(res, 200, { files: recorder.dataFiles() }));
GET("/api/rec/sheets", async (req, res, u) => json(res, 200, { sheets: await recorder.sheets(u.searchParams.get("file")) }));
POST("/api/rec/save", async (req, res) => {
  if (state.busy) return json(res, 409, { error: "Another task is running. Wait for it to finish." });
  const b = await security.readJson(req);
  state.busy = true;
  try { json(res, 200, await recorder.save(b.recording, { overwrite: !!b.overwrite })); }
  catch (e) { json(res, e.code === "EXISTS" ? 409 : 400, { error: e.message, code: e.code }); }
  finally { state.busy = false; }
});

/* ----- Capture taps made on the device itself ----- */
POST("/api/capture/start", async (req, res) => {
  deviceFree();
  const b = await security.readJson(req);
  json(res, 200, await capture.start(String(b.serial || ""), String(b.appId || "")));
});
POST("/api/capture/stop", async (req, res) => {
  const b = await security.readJson(req);
  json(res, 200, capture.stop(String(b.serial || "")));
});
GET("/api/capture/poll", (req, res, u) => json(res, 200, capture.poll(String(u.searchParams.get("serial") || ""))));

/* ---------- Files behind the session (reports, failure screenshots) ---------- */
function serveReport(req, res, p) {
  const rel = decodeURIComponent(p.slice("/reports/".length));
  const filePath = path.resolve(REPORTS_DIR, rel);
  if (!filePath.startsWith(REPORTS_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const types = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
                    ".css": "text/css", ".js": "application/javascript", ".json": "application/json" };
    res.writeHead(200, security.headers.report(types[path.extname(filePath).toLowerCase()] || "application/octet-stream"));
    res.end(data);
  });
}
function serveRunShot(req, res, p) {
  const rel = p.slice("/runs/".length).split("/").map(decodeURIComponent).join(path.sep);
  const filePath = path.resolve(runner.RUNS_DIR, rel);
  if (!filePath.startsWith(runner.RUNS_DIR + path.sep) || !/\.png$/i.test(filePath)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, security.headers.api("image/png"));
    res.end(data);
  });
}

/* ---------- Server ---------- */
const server = http.createServer(async (req, res) => {
  // 1. Only requests addressed to this machine (blocks DNS rebinding)
  if (!security.hostOk(req)) { res.writeHead(403, security.headers.plain("text/plain")); return res.end("Forbidden host"); }
  let u;
  try { u = new URL(req.url, "http://localhost:" + PORT); } catch (_) { res.writeHead(400); return res.end(); }
  const p = u.pathname;

  // 2. Public static files (no data in them)
  if (req.method === "GET") {
    if (p === "/" || p === "/index.html") return sendIndex(res);
    if (p === "/styles.css" || p === "/app.js" || p === "/app.config.json" || p === "/manifest.webmanifest")
      return sendStatic(res, path.join(PROJECT_DIR, p.slice(1)));
    if (/^\/ui\/[a-z0-9-]+\.js$/.test(p)) return sendStatic(res, path.join(PROJECT_DIR, p));
    if (/^\/assets\/[a-z0-9-]+\.(svg|png|ico)$/.test(p)) return sendStatic(res, path.join(PROJECT_DIR, p));
    if (p === "/favicon.ico") return sendStatic(res, path.join(PROJECT_DIR, "assets", "understudy.ico"));
  }

  const isApi = p.startsWith("/api/"), isFile = p.startsWith("/reports/") || p.startsWith("/runs/");
  if (!isApi && !isFile) { res.writeHead(404, security.headers.plain("text/plain")); return res.end("Not found"); }

  // Report assets (images/css inside a report) are loaded by the sandboxed report frame,
  // which has no cookies. They are only readable, never executable here.
  const reportAsset = req.method === "GET" && p.startsWith("/reports/") && !/\.html?$/i.test(p);
  if (reportAsset) return serveReport(req, res, p);

  // 3. Everything else needs this window's session; changes also need the token header
  if (!security.sessionOk(req)) return json(res, 401, { error: "Session expired. Reload Understudy.", code: "SESSION" });
  if (!security.csrfOk(req))    return json(res, 403, { error: "Request blocked", code: "CSRF" });
  lastActivity = Date.now();

  if (req.method === "GET" && p.startsWith("/reports/")) return serveReport(req, res, p);
  if (req.method === "GET" && p.startsWith("/runs/"))    return serveRunShot(req, res, p);

  const fn = routes[req.method + " " + p];
  if (!fn) return json(res, 404, { error: "Not found" });
  try { await fn(req, res, u); }
  catch (e) {
    if (!res.headersSent) fail(res, e);
    else { try { res.end(); } catch (_) {} }
  }
});

server.on("error", e => {
  if (e.code === "EADDRINUSE") {
    // Already running: just bring up a window and leave
    console.log("Understudy is already running. Opening it.");
    if (!NO_OPEN) appWin.open(URL_MAIN, CONFIG.window);
    setTimeout(() => process.exit(0), 500);
  } else {
    console.log("Server error: " + e.message);
    process.exit(1);
  }
});

// Hidden mode has no console: keep a log file (only the instance that owns the port writes it)
function startLogFile() {
  try {
    const dir = path.join(PROJECT_DIR, "logs");
    fs.mkdirSync(dir, { recursive: true });
    const out = fs.createWriteStream(path.join(dir, "understudy.log"), { flags: "w" });
    const write = (...a) => out.write(new Date().toISOString() + "  " + a.map(String).join(" ") + "\n");
    console.log = write; console.error = write; console.warn = write;
    process.on("uncaughtException", e => { write("[CRASH] " + (e && e.stack || e)); setTimeout(() => process.exit(1), 200); });
  } catch (_) {}
}

server.listen(PORT, "127.0.0.1", () => {
  if (HIDDEN) startLogFile();
  try {
    const r = require("./lib/prepare").prepareData(() => {});
    console.log(" Test data   : " + r.files + " Excel file(s), " + r.sheets + " sheet(s) prepared");
  } catch (e) { console.log(" Test data   : could not prepare (" + e.message + ")"); }
  console.log("");
  console.log("=================================================");
  console.log(" Understudy " + (CONFIG.version || "") + ": " + URL_MAIN);
  console.log(" (also works as http://localhost:" + PORT + ")");
  console.log("=================================================");
  console.log(" Excel library: " + (excel.excelLib() || "NOT FOUND (run: npm install)"));
  console.log(HIDDEN ? " Running in the background. Use Quit in the app to stop." : " Press Ctrl+C to stop.");
  console.log("");
  if (!NO_OPEN) appWin.open(URL_MAIN, CONFIG.window);
});
