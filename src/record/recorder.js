/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Recorder: element picking, steps <-> Maestro YAML, saving flow + test data.
 *
 * Files (this file saves; the others do one job each):
 *   steps.js        step model + checks (normalize): the rules every step follows
 *   selectors.js    element under a point, selector choices, Maestro matching rules
 *   yaml-write.js   steps -> YAML
 *   yaml-read.js    YAML -> steps
 *   recorder.js     save(): test data into Excel, then the flow, then data scripts
 *
 *   inspect(nodes, x, y)   element under a point + target choices
 *   buildYaml(rec)         steps -> YAML (preview and save)
 *   parseYaml(text, prev)  YAML edited by the user -> steps (two-way editing)
 *   save(rec)              writes test data, then the flow, then data scripts
 *   sheets(file)           sheets and columns of a test data file
 *
 * Steps:
 *   launch {clearState}                     input {mode:"fixed"|"data", value, column}
 *   tap | doubleTap | longPress {sel}       erase {count}   swipe {from,to}   scroll
 *   assertVisible | assertNotVisible {sel}  key {key}       hideKeyboard      wait
 *   scrollUntilVisible {sel, direction}     screenshot {name}
 *   block {kind:"repeat"|"while"|"if"|"retry", times, visible, sel, steps:[...]}
 *         "if" also: cond:"visible"|"notVisible"|"expr", expr, elseSteps:[...]
 *   raw {value}   any other Maestro command, kept as written
 *
 *   Apps:      openApp {appId, clearState, stopApp}   stopApp {appId}   killApp {appId}
 *              clearState {appId}   openLink {url, browser}
 *   Variables: setVar {name, value, mode:"text"|"expr"}   copyText {sel, name}   paste
 *              input {mode:"var", ref}   assertTrue {expr}
 *   Waiting:   waitUntil {sel, visible, timeout}
 *   Flows:     runFlowFile {file, env}   runScriptFile {file}
 *   Device:    setLocation {lat, lon}   airplane {on}   record {action:"start"|"stop", name}
 *
 *   rec.env = { NAME: "value" } -> `env:` in the flow header, used as ${NAME}
 * sel: { kind:"id"|"text"|"point", value, exact, text?, index? }
 *        exact = already a regex, don't escape
 *        text  = (id only) the same element must also show this text      -> id + text
 *        index = 0-based, among the matches sorted top-to-bottom, then left-to-right
 *                (Maestro's own order) - used only when nothing else is unique
 */


const fs   = require("fs");
const path = require("path");

const excel   = require("../data/excel");
const prepare = require("../data/prepare");
const flowIo  = require("../data/flows-io");
const P       = require("../core/paths");

const steps     = require("./steps");
const selectors = require("./selectors");
const { buildYaml } = require("./yaml-write");
const { parseYaml } = require("./yaml-read");
const { BOOK_RE, FLOWNAME_RE, COLUMN_RE, dataSteps, normalize } = steps;
const { inspect, nodesAt, matches, pointOnly, suggestColumn, compactNodes } = selectors;

/* ---------- Test data files offered in the value dialog ---------- */
async function sheets(file) {
  const full = excel.resolveExcel(file);
  const list = await excel.readExcel(full);
  return list.map(s => ({ name: s.name, columns: (s.rows[0] || []).map(h => String(h || "").trim()).filter(Boolean) }));
}

function dataFiles() {
  return excel.scanExcel().map(f => ({ path: f.path, name: f.name, folder: f.folder,
    usable: BOOK_RE.test(path.basename(f.name, ".xlsx")) }));
}

async function writeData(data, steps) {
  const cols = [], vals = {};
  dataSteps(steps).forEach(s => { if (!(s.column in vals)) { cols.push(s.column); vals[s.column] = s.value; } });
  if (!cols.length) return { columns: 0 };

  let file;
  if (data.file) file = excel.resolveExcel(data.file);
  else {
    const clash = excel.scanExcel().find(f => f.name.toLowerCase() === (data.book + ".xlsx").toLowerCase());
    if (clash) file = excel.resolveExcel(clash.path);          // same name: use the existing file
    else {
      const t = excel.resolveNewExcel("", data.book);
      await excel.createExcel(t.dir, t.full, data.sheet, cols);
      file = t.full;
    }
  }
  let list = await excel.readExcel(file);
  if (!list.find(s => s.name === data.sheet)) {
    await excel.addSheetToExcel(file, data.sheet, cols);
    list = await excel.readExcel(file);
  }
  const sh = list.find(s => s.name === data.sheet);
  const header = (sh.rows[0] || []).map(h => String(h || "").trim());
  const row1 = sh.rows[1] || [];
  const edits = [];
  let next = header.length;
  while (next > 0 && !header[next - 1]) next--;
  for (const col of cols) {
    let c = header.indexOf(col);
    if (c < 0) { c = next++; edits.push({ sheet: data.sheet, r: 0, c, v: col }); }
    const cur = row1[c] == null ? "" : String(row1[c]);
    if (cur === "" && vals[col] !== "") edits.push({ sheet: data.sheet, r: 1, c, v: vals[col] });
  }
  if (edits.length) await excel.applyExcelChanges(file, [], edits);
  return { columns: cols.length, file: P.rel(file) };
}

async function save(recIn, opts) {
  opts = opts || {};
  const { yaml, rec } = buildYaml(recIn);
  if (!rec.flow || !FLOWNAME_RE.test(rec.flow) || rec.flow.includes(".."))
    throw new Error("Flow name: use letters, numbers, spaces, - _ . and / for folders");
  if (!rec.steps.length) throw new Error("Record at least one step first");
  const full = flowIo.resolveFlow(rec.flow);
  if (fs.existsSync(full) && !opts.overwrite) { const e = new Error("A flow with that name already exists"); e.code = "EXISTS"; throw e; }
  const dataResult = rec.data ? await writeData(rec.data, rec.steps) : { columns: 0 };
  flowIo.saveFlow(rec.flow, yaml);
  if (rec.data) prepare.prepareData(() => {});
  return { ok: true, path: rec.flow, data: dataResult };
}

module.exports = { inspect, nodesAt, matches, pointOnly, buildYaml, parseYaml, save, sheets, dataFiles, suggestColumn, normalize, compactNodes, COLUMN_RE };
