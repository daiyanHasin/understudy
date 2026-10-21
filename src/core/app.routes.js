/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * HTTP routes - App window: session info, Quit, live events (SSE), open a folder in Explorer.
 * Routes only read the request, call the feature module and answer.
 * The logic lives in the modules required below.
 */
const fs   = require("fs");
const { execFile } = require("child_process");
const security = require("../core/security");
const state = require("../core/state");
const runner = require("../run/runner");
const P = require("../core/paths");
const APP_DIR = P.APP_DIR;

module.exports = function register(r, ctx) {
  const { GET, POST, json } = r;
  // ctx: { config, hidden, shutdown(reason), sse: { opened(), closed() } } from web-gui.js

  GET("/api/session", (req, res) => json(res, 200, { ok: true, version: ctx.config.version || "", hidden: ctx.hidden }));
  POST("/api/shutdown", (req, res) => {
    if (state.busy) return json(res, 409, { error: "A run is in progress. Stop it first." });
    json(res, 200, { ok: true });
    ctx.shutdown("quit from the app");
  });
  /* SSE */
  GET("/api/stream", (req, res) => {
    res.writeHead(200, security.headers.api("text/event-stream"));
    res.write(": connected\n\n");
    runner.addSseClient(res);
    ctx.sse.opened();
    req.on("close", () => { runner.removeSseClient(res); ctx.sse.closed(); });
  });
  /* Open a project folder in Explorer */
  POST("/api/open-folder", async (req, res) => {
    const b = await security.readJson(req);
    const map = {
      reports: P.reports, testdata: P.testData, backups: P.excelBackups, flowbackups: P.flowBackups,
      flows: P.flows, apps: P.apps, logs: P.LOG_DIR, project: P.root, install: APP_DIR
    };
    const target = map[String(b.kind || "")];
    if (!target) return json(res, 400, { error: "Unknown folder" });
    fs.mkdirSync(target, { recursive: true });
    if (process.platform === "win32") execFile("explorer.exe", [target], () => {});
    else execFile(process.platform === "darwin" ? "open" : "xdg-open", [target], () => {});
    json(res, 200, { ok: true, path: target });
  });
};
