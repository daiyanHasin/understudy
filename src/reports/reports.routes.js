/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * HTTP routes - Results: run history, one run, HTML reports.
 * Routes only read the request, call the feature module and answer.
 * The logic lives in the modules required below.
 */
const security = require("../core/security");
const runner = require("../run/runner");
const history = require("../reports/history");
const report = require("../reports/report");

module.exports = function register(r, ctx) {
  const { GET, POST, json } = r;

  /* History, data preview */
  GET("/api/history", (req, res) => json(res, 200, history.list()));
  GET("/api/history/run", (req, res, u) => {
    const r = history.get(u.searchParams.get("id"));
    if (!r) return json(res, 404, { error: "Run not found" });
    json(res, 200, r);
  });
  // Standalone report for any run in the history (older runs had none)
  POST("/api/report/write", async (req, res) => {
    const b = await security.readJson(req);
    const r = history.get(b.id);
    if (!r) return json(res, 404, { error: "Run not found" });
    json(res, 200, { ok: true, name: report.write(r) });
  });
  GET("/api/reports", (req, res) => json(res, 200, runner.listReports()));
};
