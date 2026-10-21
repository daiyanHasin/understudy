/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * HTTP routes - Files the tester edits: flows (YAML), Excel test data, Prepare Data, data previews.
 * Routes only read the request, call the feature module and answer.
 * The logic lives in the modules required below.
 */
const fs   = require("fs");
const path = require("path");
const security = require("../core/security");
const state = require("../core/state");
const runner = require("../run/runner");
const excel = require("../data/excel");
const flowIo = require("../data/flows-io");
const P = require("../core/paths");

module.exports = function register(r, ctx) {
  const { GET, POST, json } = r;

  GET("/api/data", (req, res, u) => {
    const ex = String(u.searchParams.get("excel") || ""), sh = String(u.searchParams.get("sheet") || "");
    if (!/^[\w-]+$/.test(ex) || !/^[\w-]+$/.test(sh)) return json(res, 400, { error: "bad name" });
    fs.readFile(path.join(P.jsonData, ex, sh + ".json"), "utf8", (err, txt) => {
      if (err) return json(res, 404, { error: "No data yet. Run Prepare Data." });
      res.writeHead(200, security.headers.api());
      res.end(txt);
    });
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
    json(res, 200, { ok: true, path: P.rel(target.full) });
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
};
