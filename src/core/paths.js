/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Where things live.
 *
 *   APP_DIR   the Understudy install (code, assets, node_modules, logs, vendor)
 *   root      the open PROJECT (Flows, TestData, Reports, History, ...)
 *
 * Every module asks this file for project folders instead of building
 * paths from __dirname, so the open project can change while Understudy
 * runs (Projects menu). Before 1.2 the install folder WAS the project, and
 * it stays the default project so existing setups keep working unchanged.
 */

const path = require("path");

const APP_DIR = path.join(__dirname, "..", "..");
let root = APP_DIR;
const listeners = [];

const P = {
  APP_DIR,
  LOG_DIR: path.join(APP_DIR, "logs"),
  VENDOR_DIR: path.join(APP_DIR, "vendor"),

  get root()         { return root; },
  get flows()        { return path.join(root, "Flows"); },
  get testData()     { return path.join(root, "TestData"); },
  get jsonData()     { return path.join(root, "JsonData"); },
  get scripts()      { return path.join(root, "Scripts"); },
  get reports()      { return path.join(root, "Reports"); },
  get runs()         { return path.join(root, ".runs"); },
  get history()      { return path.join(root, "History"); },
  get suites()       { return path.join(root, "Suites"); },
  get apps()         { return path.join(root, "Apps"); },
  get excelBackups() { return path.join(root, "ExcelBackups"); },
  get flowBackups()  { return path.join(root, "FlowBackups"); },

  /** Switch the open project. Listeners (caches) are told about it. */
  setRoot(dir) {
    const next = path.resolve(String(dir));
    if (next === root) return;
    root = next;
    listeners.forEach(fn => { try { fn(root); } catch (_) {} });
  },
  onChange(fn) { listeners.push(fn); },

  /** Path relative to the project, with forward slashes. */
  rel(full) { return path.relative(root, full).split(path.sep).join("/"); },

  /** true when `full` is `dir` itself or inside it. */
  inside(dir, full) { return full === dir || full.startsWith(dir + path.sep); }
};

module.exports = P;
