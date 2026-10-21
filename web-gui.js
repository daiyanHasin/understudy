/*
 * Understudy — local web GUI server
 * Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE.
 *
 * Portions are derived from "Maestro Excel Data Driven Framework",
 * Copyright 2026 Md. Mohai Minul Islam, licensed under the Apache License 2.0
 * (https://github.com/mohai17/Maestro-Excel-Data-Driven-Framework).
 * Those portions have been modified. See THIRD_PARTY_NOTICES.md and
 * LICENSES/Apache-2.0.txt.
 * *
 * This file only starts things. Where everything else lives:
 *   src/server/http.js      router + json() / fail() / deviceFree() helpers
 *   src/server/static.js    UI files, reports, failure screenshots
 *   src/<feature>/<feature>.routes.js   the HTTP routes of one feature
 *   src/<feature>/*.js      the logic of that feature (no HTTP in there)
 *   src/<feature>/*.ui.js   the browser side of that feature
 * Full map: docs/FILE-MAP.md. How it fits together: docs/ARCHITECTURE.md.
 *
 * Start options:
 *   --hidden    started by Understudy.vbs: no console, stops itself when the
 *               window has been closed for a while and nothing is running
 *   --no-open   don't open a window (e.g. you open the address yourself)
 *   --project <folder>   open this project instead of the last one
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");

const security   = require("./src/core/security");
const state      = require("./src/core/state");
const runner     = require("./src/run/runner");
const excel      = require("./src/data/excel");
const appWin     = require("./src/core/app-window");
const P          = require("./src/core/paths");
const projects   = require("./src/projects/projects");
const animations = require("./src/device/animations");
const { createRouter, json, fail } = require("./src/server/http");
const files      = require("./src/server/static");

// Browsers send *.localhost to this computer automatically: no hosts-file change needed.
const HOST_NAME   = "understudy.localhost";
const PORT        = 4545;
const URL_MAIN    = "http://" + HOST_NAME + ":" + PORT;
const HIDDEN      = process.argv.includes("--hidden");
const NO_OPEN     = process.argv.includes("--no-open");
const IDLE_MS     = 3 * 60 * 1000;

// APP_DIR = the Understudy install (app/, src/, assets/).
// Project folders (Flows, TestData, Reports ...) always come from src/core/paths.js.
const APP_DIR = P.APP_DIR;
const argProject = (() => { const i = process.argv.indexOf("--project"); return i > 0 ? process.argv[i + 1] : process.env.UNDERSTUDY_PROJECT; })();

let CONFIG = {};
try { CONFIG = JSON.parse(fs.readFileSync(path.join(APP_DIR, "app.config.json"), "utf8")); } catch (_) {}

security.configure({ port: PORT, hostNames: [HOST_NAME] });

/* ---------- Idle shutdown (hidden mode only) ---------- */
let sseCount = 0, lastActivity = Date.now();
function shutdown(reason) {
  console.log("Stopping Understudy (" + reason + ")");
  try { if (state.currentChild) runner.killTree(state.currentChild); } catch (_) {}
  server.close();
  // Give the phones their animations back (at most 5 s), then leave
  const bye = setTimeout(() => process.exit(0), 5000); bye.unref();
  animations.restoreAll().catch(() => {}).then(() => setTimeout(() => process.exit(0), 300).unref());
}
// Console mode: Ctrl+C or closing the console window still restores the phones' animations
if (!HIDDEN) ["SIGINT", "SIGHUP", "SIGBREAK"].forEach(sig => { try { process.on(sig, () => shutdown(sig)); } catch (_) {} });
if (HIDDEN) {
  setInterval(() => {
    if (sseCount > 0 || state.busy) { lastActivity = Date.now(); return; }
    if (Date.now() - lastActivity > IDLE_MS) shutdown("window closed");
  }, 15000).unref();
}

/* ---------- API routes: one file per feature ---------- */
const router = createRouter();
const ctx = {
  config: CONFIG,
  hidden: HIDDEN,
  shutdown,
  sse: { opened: () => { sseCount++; }, closed: () => { sseCount--; lastActivity = Date.now(); } }
};
[
  "./src/core/app.routes",
  "./src/projects/projects.routes",
  "./src/run/run.routes",
  "./src/data/data.routes",
  "./src/reports/reports.routes",
  "./src/setup/setup.routes",
  "./src/device/device.routes",
  "./src/record/record.routes",
  "./src/ai/ai.routes"
].forEach(file => require(file)(router, ctx));

// `node web-gui.js --list-routes` prints every route and exits (used by tools/check.js)
if (process.argv.includes("--list-routes")) { console.log(router.list().join("\n")); process.exit(0); }

/* ---------- Server ---------- */
const server = http.createServer(async (req, res) => {
  // 1. Only requests addressed to this machine (blocks DNS rebinding)
  if (!security.hostOk(req)) { res.writeHead(403, security.headers.plain("text/plain")); return res.end("Forbidden host"); }
  let u;
  try { u = new URL(req.url, "http://localhost:" + PORT); } catch (_) { res.writeHead(400); return res.end(); }
  const p = u.pathname;

  // 2. Public static files (no data in them)
  if (files.servePublic(req, res, p)) return;

  const isApi = p.startsWith("/api/"), isFile = p.startsWith("/reports/") || p.startsWith("/runs/");
  if (!isApi && !isFile) { res.writeHead(404, security.headers.plain("text/plain")); return res.end("Not found"); }

  // Report assets (images/css inside a report) are loaded by the sandboxed report frame,
  // which has no cookies. They are only readable, never executable here.
  const reportAsset = req.method === "GET" && p.startsWith("/reports/") && !/\.html?$/i.test(p);
  if (reportAsset) return files.serveReport(req, res, p);

  // 3. Everything else needs this window's session; changes also need the token header
  if (!security.sessionOk(req)) return json(res, 401, { error: "Session expired. Reload Understudy.", code: "SESSION" });
  if (!security.csrfOk(req))    return json(res, 403, { error: "Request blocked", code: "CSRF" });
  lastActivity = Date.now();

  if (req.method === "GET" && p.startsWith("/reports/")) return files.serveReport(req, res, p);
  if (req.method === "GET" && p.startsWith("/runs/"))    return files.serveRunShot(req, res, p);

  const fn = router.find(req.method, p);
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
    const dir = P.LOG_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const out = fs.createWriteStream(path.join(dir, "understudy.log"), { flags: "w" });
    const write = (...a) => out.write(new Date().toISOString() + "  " + a.map(String).join(" ") + "\n");
    console.log = write; console.error = write; console.warn = write;
    process.on("uncaughtException", e => { write("[CRASH] " + (e && e.stack || e)); setTimeout(() => process.exit(1), 200); });
  } catch (_) {}
}

// Open the last project (or --project <folder>) before anything reads project files
try { projects.init(argProject); } catch (e) { console.log(" Project     : " + e.message); }

server.listen(PORT, "127.0.0.1", () => {
  if (HIDDEN) startLogFile();
  console.log(" Project     : " + P.root);
  require("./src/data/prepare").prepareData(() => {})
    .then(r => console.log(" Test data   : " + r.files + " Excel file(s), " + r.sheets + " sheet(s) prepared"))
    .catch(e => console.log(" Test data   : could not prepare (" + e.message + ")"));
  console.log("");
  console.log("=================================================");
  console.log(" Understudy " + (CONFIG.version || "") + ": " + URL_MAIN);
  console.log(" (also works as http://localhost:" + PORT + ")");
  console.log("=================================================");
  console.log(" Excel library: " + (excel.excelLib() || "NOT FOUND (run: npm install)"));
  console.log(HIDDEN ? " Running in the background. Use Quit in the app to stop." : " Press Ctrl+C to stop.");
  if (process.env.NODE_EXTRA_CA_CERTS) console.log(" Certificates: extra company certificates loaded (" + path.basename(process.env.NODE_EXTRA_CA_CERTS) + ")");
  // Phones left without animations by a previous session that didn't quit cleanly
  animations.restoreAll().then(r => { if (r.restored.length) console.log(" Animations  : restored on " + r.restored.join(", ")); }).catch(() => {});
  console.log("");
  if (!NO_OPEN) appWin.open(URL_MAIN, CONFIG.window);
});
