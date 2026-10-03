/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Which Excel sheets does a flow use, and which rows should it run?
 *
 * A flow's own `runScript: ../Scripts/<Excel>/<Sheet>.js` lines are its
 * "data sheets": the rows you pick in the queue apply to them.
 * Sheets used inside `runFlow:` sub-flows (e.g. Login.yaml -> LoginData)
 * are listed as `sub` and stay on row 1.
 */

const fs   = require("fs");
const path = require("path");
const { rowVar, SCRIPTS_DIR, JSON_DIR } = require("./prepare");

const FLOWS_DIR = path.join(__dirname, "..", "Flows");

// `- runScript: "../x.js"`, `- runScript: ../x.js`, or `- runScript:\n    file: ../x.js`
const SCRIPT_RE = /^[ \t]*-?[ \t]*runScript:[ \t]*(?:\r?\n[ \t]*file:[ \t]*)?["']?([^"'\s#]+\.js)/gm;
const FLOW_RE   = /^[ \t]*-?[ \t]*runFlow:[ \t]*(?:\r?\n[ \t]*file:[ \t]*)?["']?([^"'\s#]+\.ya?ml)/gm;

function rowCount(excel, sheet) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(JSON_DIR, excel, sheet + ".json"), "utf8"));
    return Array.isArray(data) ? data.length : 0;
  } catch (_) { return 0; }   // not prepared yet
}

function scan(fullFlowPath, sub, depth, seen, out) {
  if (depth > 4 || seen.has(fullFlowPath)) return;
  seen.add(fullFlowPath);
  let text;
  try { text = fs.readFileSync(fullFlowPath, "utf8"); } catch (_) { return; }
  const dir = path.dirname(fullFlowPath);

  for (const m of text.matchAll(SCRIPT_RE)) {
    const full = path.resolve(dir, m[1]);
    if (!full.startsWith(SCRIPTS_DIR + path.sep)) continue;       // hand-written script
    const rel = path.relative(SCRIPTS_DIR, full).split(path.sep);
    if (rel.length !== 2) continue;                               // expect <Excel>/<Sheet>.js
    const excel = rel[0], sheet = rel[1].replace(/\.js$/i, "");
    if (out.some(s => s.excel === excel && s.sheet === sheet)) continue;
    out.push({ excel, sheet, var: rowVar(excel, sheet), rows: rowCount(excel, sheet), sub });
  }
  for (const m of text.matchAll(FLOW_RE)) {
    scan(path.resolve(dir, m[1]), true, depth + 1, seen, out);
  }
}

/** Sheets used by a flow (path relative to Flows/). Direct sheets first. */
function flowSheets(relFlow) {
  const out = [];
  scan(path.join(FLOWS_DIR, relFlow), false, 0, new Set(), out);
  return out.sort((a, b) => a.sub - b.sub);
}

/**
 * "" -> [1]   "all" -> [1..total]   "2,7,13" -> [2,7,13]   "2-5,9" -> [2,3,4,5,9]
 * Throws a readable error for bad input or rows that don't exist.
 */
function parseRows(spec, total) {
  const s = String(spec || "").trim().toLowerCase();
  if (!s) return [1];
  if (!total) throw new Error("no data rows found — run Prepare Data first");
  if (s === "all" || s === "*") return Array.from({ length: total }, (_, i) => i + 1);
  const rows = [];
  for (const part of s.split(",").map(x => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error('"' + part + '" is not a row number or range');
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b < a) throw new Error('"' + part + '" is not a valid range');
    if (b > total) throw new Error("row " + b + " does not exist (sheet has " + total + " rows)");
    for (let r = a; r <= b; r++) if (!rows.includes(r)) rows.push(r);
  }
  if (!rows.length) throw new Error("no rows selected");
  if (rows.length > 500) throw new Error("more than 500 rows selected");
  return rows;
}

module.exports = { flowSheets, parseRows };
