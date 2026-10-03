/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Recorder: element picking, steps <-> Maestro YAML, saving flow + test data.
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
 *   raw {value}   any other Maestro command, kept as written
 * sel: { kind:"id"|"text"|"point", value, exact }  exact = already a regex, don't escape
 */

const fs   = require("fs");
const path = require("path");

const excel   = require("./excel");
const prepare = require("./prepare");
const flowIo  = require("./flows-io");
let YAML = null;
try { YAML = require("yaml"); } catch (_) {}

const PROJECT_DIR = path.join(__dirname, "..");
const COLUMN_RE   = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
const BOOK_RE     = /^[A-Za-z0-9_-]{1,60}$/;
const SHEET_RE    = /^[A-Za-z0-9_-]{1,31}$/;
const FLOWNAME_RE = /^[A-Za-z0-9._\-/ ]{1,120}$/;
const PCT_RE      = /^\d{1,3}%,\d{1,3}%$/;
const MAX_STEPS   = 1000;
const safe = s => String(s).trim().replace(/[^a-zA-Z0-9_-]/g, "_");   // same as prepare.js

/* ======================= Picking the element ======================= */
const area     = n => Math.max(1, (n.x2 - n.x1) * (n.y2 - n.y1));
const contains = (n, x, y) => x >= n.x1 && x < n.x2 && y >= n.y1 && y < n.y2;
const reEscape = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function screenSize(nodes) {
  let w = 1, h = 1;
  nodes.forEach(n => { if (n.x2 > w) w = n.x2; if (n.y2 > h) h = n.y2; });
  return { w, h };
}

function inspect(nodes, x, y) {
  const under = nodes.filter(n => contains(n, x, y) && n.x2 > n.x1 && n.y2 > n.y1)
                     .sort((a, b) => area(a) - area(b) || b.i - a.i);
  const size = screenSize(nodes);
  const pct = (v, t) => Math.max(0, Math.min(100, Math.round(v / t * 100)));
  const point = { kind: "point", value: pct(x, size.w) + "%," + pct(y, size.h) + "%", unique: true, count: 1, label: "Screen position" };
  if (!under.length) return { element: null, candidates: [point], size };

  const leaf = under[0];
  // A text field, or the placeholder text drawn inside one (Jetpack Compose draws it as a child)
  const field = under.find(n => n.editable && area(n) <= area(leaf) * 30);
  let target = field || leaf;
  if (!field) {
    for (const n of under.slice(0, 6)) {
      if ((n.id || n.text || n.desc || n.hint) && area(n) <= area(leaf) * 6) { target = n; break; }
    }
  }

  // Placeholder: hint attribute, else text drawn inside the field, else the field's own text
  // (older Android versions report an empty field's placeholder as its text)
  let placeholder = "";
  if (field) {
    const inner = nodes.find(n => n.parent === field.i && n.text && !n.editable) ||
                  (leaf !== field && leaf.text ? leaf : null);
    placeholder = field.hint || (inner ? inner.text : "") || (!field.focused ? field.text : "");
  }

  const count = fn => nodes.filter(fn).length;
  const c = [];
  const add = (kind, value, label) => {
    if (!value || value.length > 120 || c.some(o => o.kind === kind && o.value === value)) return;
    const n = kind === "id" ? count(o => o.id === value)
                            : count(o => o.text === value || o.desc === value || o.hint === value);
    c.push({ kind, value, unique: n === 1, count: Math.max(n, 1), label });
  };
  const idShort = target.id.split(":id/").pop();
  if (target.id) add("id", target.id, "ID  " + idShort);
  if (field) {
    add("text", placeholder, "Placeholder  \u201C" + placeholder + "\u201D");
    if (field.desc) add("text", field.desc, "Label  \u201C" + field.desc + "\u201D");
  } else {
    if (target.text) add("text", target.text, "Text  \u201C" + target.text + "\u201D");
    if (target.desc) add("text", target.desc, "Label  \u201C" + target.desc + "\u201D");
  }
  c.sort((a, b) => b.unique - a.unique);
  c.push(point);

  return {
    element: {
      id: target.id, idShort, text: field ? "" : target.text, desc: target.desc, hint: target.hint,
      placeholder, cls: target.cls.split(".").pop(), editable: !!field, password: target.password,
      pkg: target.pkg, bounds: [target.x1, target.y1, target.x2, target.y2]
    },
    suggestedColumn: suggestColumn(target, placeholder),
    candidates: c,
    size
  };
}

// "com.app:id/et_email" -> "Email", "Enter your password" -> "Password"
function suggestColumn(n, placeholder) {
  const fromId = n.id ? n.id.split(":id/").pop() : "";
  let s = (fromId.length >= 3 ? fromId : "") || placeholder || n.hint || n.desc || fromId || "";
  s = s.replace(/^(et|edt|edit|txt|input|tv|field|inp)[_\-]?/i, "")
       .replace(/[_\-](input|field|edit|text|et)$/i, "")
       .replace(/^(please\s+)?(enter|type|input|your)\s+(your\s+|the\s+)?/i, "");
  const words = s.split(/[^A-Za-z0-9]+|(?=[A-Z][a-z])/).filter(Boolean).slice(0, 3);
  let col = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  if (!col || !/^[A-Za-z_]/.test(col)) col = "Value" + (col || "");
  return col.slice(0, 40);
}

/* ======================= Validation ======================= */
function checkSel(sel) {
  if (!sel || typeof sel !== "object") throw new Error("A step is missing its target");
  const v = String(sel.value == null ? "" : sel.value);
  if (!v || v.length > 300) throw new Error("A step has an empty or too long target");
  if (sel.kind === "point") { if (!PCT_RE.test(v)) throw new Error("Invalid screen position: " + v); }
  else if (sel.kind !== "id" && sel.kind !== "text") throw new Error("Invalid target type");
  return { kind: sel.kind, value: v, exact: !!sel.exact };
}

const SEL_TYPES = ["tap", "doubleTap", "longPress", "assertVisible", "assertNotVisible"];

function normStep(s, depth) {
  const t = String(s && s.type || "");
  if (SEL_TYPES.includes(t)) return { type: t, sel: checkSel(s.sel) };
  switch (t) {
    case "launch": return { type: t, clearState: !!s.clearState };
    case "scrollUntilVisible":
      return { type: t, sel: checkSel(s.sel), direction: ["UP", "DOWN", "LEFT", "RIGHT"].includes(s.direction) ? s.direction : "DOWN" };
    case "input": {
      const mode = s.mode === "data" ? "data" : "fixed";
      const value = String(s.value == null ? "" : s.value);
      if (value.length > 1000) throw new Error("Typed text is too long");
      if (mode === "data" && !COLUMN_RE.test(String(s.column || "")))
        throw new Error("Column names use letters, numbers and _ and start with a letter: " + s.column);
      return { type: t, mode, value, column: mode === "data" ? String(s.column) : undefined, password: !!s.password };
    }
    case "swipe":
      if (!PCT_RE.test(String(s.from)) || !PCT_RE.test(String(s.to))) throw new Error("Invalid swipe");
      return { type: t, from: String(s.from), to: String(s.to) };
    case "erase": return { type: t, count: Math.max(1, Math.min(200, parseInt(s.count, 10) || 50)) };
    case "key":
      if (!["back", "enter", "home", "tab"].includes(s.key)) throw new Error("Invalid key");
      return { type: t, key: s.key };
    case "scroll": case "hideKeyboard": case "wait": return { type: t };
    case "screenshot":
      return { type: t, name: String(s.name || "screen").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60) || "screen" };
    case "block": {
      if (depth > 5) throw new Error("Blocks are nested too deeply");
      const kind = String(s.kind);
      if (!["repeat", "while", "if", "retry"].includes(kind)) throw new Error("Unknown block");
      const b = { type: t, kind, steps: (Array.isArray(s.steps) ? s.steps : []).map(x => normStep(x, depth + 1)) };
      if (kind === "repeat") b.times = Math.max(1, Math.min(1000, parseInt(s.times, 10) || 2));
      if (kind === "retry")  b.times = Math.max(1, Math.min(10, parseInt(s.times, 10) || 3));
      if (kind === "while" || kind === "if") { b.visible = s.visible !== false; b.sel = checkSel(s.sel); }
      return b;
    }
    case "raw":
      if (s.value === undefined || JSON.stringify(s.value).length > 20000) throw new Error("Invalid custom step");
      return { type: t, value: s.value };
    default: throw new Error("Unknown step type: " + t);
  }
}

function walk(steps, fn) { steps.forEach(s => { fn(s); if (s.type === "block") walk(s.steps || [], fn); }); }
function dataSteps(steps) { const out = []; walk(steps, s => { if (s.type === "input" && s.mode === "data") out.push(s); }); return out; }

function normalize(rec) {
  if (!rec || typeof rec !== "object") throw new Error("Nothing to save");
  const out = {};
  out.appId = String(rec.appId || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(out.appId)) throw new Error("Enter the app ID first (for example com.example.app)");
  out.flow = String(rec.flow || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (out.flow && !/\.ya?ml$/i.test(out.flow)) out.flow += ".yaml";
  out.name = String(rec.name || "").trim().slice(0, 120);
  out.tags = (Array.isArray(rec.tags) ? rec.tags : []).map(t => String(t).trim())
               .filter(t => /^[A-Za-z0-9_-]{1,30}$/.test(t)).slice(0, 10);
  const steps = Array.isArray(rec.steps) ? rec.steps : [];
  if (steps.length > MAX_STEPS) throw new Error("Too many steps");
  out.steps = steps.map(s => normStep(s, 0));
  if (dataSteps(out.steps).length) out.data = checkData(rec.data);
  return out;
}

function checkData(d) {
  d = d || {};
  const sheet = String(d.sheet || "").trim();
  if (d.file) {
    const file = String(d.file);
    excel.resolveExcel(file);                      // must be an .xlsx inside TestData/
    const base = path.basename(file, ".xlsx");
    if (!BOOK_RE.test(base)) throw new Error("Rename " + path.basename(file) + " to use only letters, numbers, - and _ so flows can use it");
    if (!sheet || sheet.length > 31) throw new Error("Choose a sheet for the test data");
    return { file, book: base, sheet };
  }
  const book = String(d.workbook || "").trim();
  if (!BOOK_RE.test(book)) throw new Error("Choose where test data goes: pick an Excel file, or name a new one (letters, numbers, - and _)");
  if (!SHEET_RE.test(sheet)) throw new Error("New sheet name: use letters, numbers, - and _ (31 max)");
  return { file: "", book, sheet };
}

/* ======================= Steps -> YAML ======================= */
const q = s => JSON.stringify(String(s));
const CMD = { tap: "tapOn", doubleTap: "doubleTapOn", longPress: "longPressOn",
              assertVisible: "assertVisible", assertNotVisible: "assertNotVisible" };

function selLines(sel, pad) {
  if (sel.kind === "point") return [pad + "point: " + q(sel.value)];
  return [pad + sel.kind + ": " + q(sel.exact ? sel.value : reEscape(sel.value))];
}

function stepLines(s, pad) {
  const P = pad, I = pad + "    ";
  switch (s.type) {
    case "launch": return s.clearState ? [P + "- launchApp:", I + "clearState: true"] : [P + "- launchApp"];
    case "tap": case "doubleTap": case "longPress": case "assertVisible": case "assertNotVisible":
      return [P + "- " + CMD[s.type] + ":"].concat(selLines(s.sel, I));
    case "scrollUntilVisible":
      return [P + "- scrollUntilVisible:", I + "element:"].concat(selLines(s.sel, I + "  "), [I + "direction: " + s.direction]);
    case "input":
      return [P + "- inputText: " + (s.mode === "data" ? "\"${output." + s.column + "}\"" : q(s.value))];
    case "erase":  return [P + "- eraseText: " + s.count];
    case "swipe":  return [P + "- swipe:", I + "start: " + q(s.from), I + "end: " + q(s.to)];
    case "scroll": return [P + "- scroll"];
    case "hideKeyboard": return [P + "- hideKeyboard"];
    case "wait":   return [P + "- waitForAnimationToEnd"];
    case "key":    return [P + (s.key === "back" ? "- back" : "- pressKey: " + { enter: "Enter", home: "Home", tab: "Tab" }[s.key])];
    case "screenshot": return [P + "- takeScreenshot: " + q(s.name)];
    case "block": {
      const L = [];
      const cond = (word) => [I + word + ":", I + "  " + (s.visible ? "visible" : "notVisible") + ":"].concat(selLines(s.sel, I + "    "));
      if (s.kind === "repeat") L.push(P + "- repeat:", I + "times: " + s.times);
      if (s.kind === "while")  L.push(P + "- repeat:", ...cond("while"));
      if (s.kind === "if")     L.push(P + "- runFlow:", ...cond("when"));
      if (s.kind === "retry")  L.push(P + "- retry:", I + "maxRetries: " + s.times);
      L.push(I + "commands:");
      if (!s.steps.length) L.push(I + "  - waitForAnimationToEnd");
      s.steps.forEach(c => L.push(...stepLines(c, I + "  ")));
      return L;
    }
    case "raw": {
      const txt = YAML ? YAML.stringify([s.value], { lineWidth: 0 }).trimEnd() : "- " + JSON.stringify(s.value);
      return txt.split("\n").map(l => P + l);
    }
  }
  return [];
}

function scriptRef(flowRel, data) {
  const flowDir = path.dirname(path.join(flowIo.FLOWS_DIR, flowRel || "x.yaml"));
  const target  = path.join(prepare.SCRIPTS_DIR, data.book, safe(data.sheet) + ".js");
  return path.relative(flowDir, target).split(path.sep).join("/");
}

function buildYaml(recIn) {
  const rec = normalize(recIn);
  const L = ["appId: " + rec.appId];
  if (rec.name) L.push("name: " + q(rec.name));
  L.push("tags:");
  (rec.tags.length ? rec.tags : ["recorded"]).forEach(t => L.push("  - " + t));
  L.push("---");
  if (rec.data) L.push("- runScript: " + q(scriptRef(rec.flow, rec.data)));
  rec.steps.forEach(s => L.push(...stepLines(s, "")));
  return { yaml: L.join("\n") + "\n", rec };
}

/* ======================= YAML -> steps ======================= */
function selFrom(v) {
  if (typeof v === "string" || typeof v === "number") return { kind: "text", value: String(v), exact: true };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1 && ["id", "text", "point"].includes(keys[0]) && typeof v[keys[0]] !== "object") {
      const kind = keys[0], value = String(v[kind]);
      if (kind === "point" && !PCT_RE.test(value)) return null;
      return { kind, value, exact: true };
    }
  }
  return null;
}
function condFrom(c) {
  if (!c || typeof c !== "object") return null;
  const keys = Object.keys(c);
  if (keys.length !== 1 || !["visible", "notVisible"].includes(keys[0])) return null;
  const sel = selFrom(c[keys[0]]);
  return sel ? { visible: keys[0] === "visible", sel } : null;
}

function fromCommand(item, ctx) {
  const raw = { type: "raw", value: item };
  if (typeof item === "string") {
    return { launchApp: { type: "launch", clearState: false }, back: { type: "key", key: "back" },
             scroll: { type: "scroll" }, hideKeyboard: { type: "hideKeyboard" },
             waitForAnimationToEnd: { type: "wait" } }[item] || raw;
  }
  if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== 1) return raw;
  const k = Object.keys(item)[0], v = item[k];
  const selCmd = { tapOn: "tap", doubleTapOn: "doubleTap", longPressOn: "longPress",
                   assertVisible: "assertVisible", assertNotVisible: "assertNotVisible" }[k];
  if (selCmd) { const sel = selFrom(v); return sel ? { type: selCmd, sel } : raw; }
  switch (k) {
    case "launchApp":
      if (v == null) return { type: "launch", clearState: false };
      if (typeof v === "object" && Object.keys(v).every(x => x === "clearState")) return { type: "launch", clearState: !!v.clearState };
      return raw;
    case "inputText": {
      if (typeof v !== "string" && typeof v !== "number") return raw;
      const m = String(v).match(/^\$\{output\.([A-Za-z_][A-Za-z0-9_]*)\}$/);
      if (m) return { type: "input", mode: "data", column: m[1], value: ctx.values[m[1]] || "" };
      return { type: "input", mode: "fixed", value: String(v) };
    }
    case "eraseText": return { type: "erase", count: parseInt(v, 10) || 50 };
    case "swipe":
      if (v && PCT_RE.test(String(v.start)) && PCT_RE.test(String(v.end)) && Object.keys(v).length === 2)
        return { type: "swipe", from: String(v.start), to: String(v.end) };
      return raw;
    case "pressKey": {
      const key = { Enter: "enter", Home: "home", Tab: "tab", Back: "back" }[v];
      return key ? { type: "key", key } : raw;
    }
    case "takeScreenshot": return typeof v === "string" ? { type: "screenshot", name: v } : raw;
    case "scrollUntilVisible": {
      if (!v || typeof v !== "object") return raw;
      const sel = selFrom(v.element);
      const extra = Object.keys(v).filter(x => x !== "element" && x !== "direction");
      return sel && !extra.length ? { type: "scrollUntilVisible", sel, direction: String(v.direction || "DOWN").toUpperCase() } : raw;
    }
    case "runScript": {
      const m = String(typeof v === "string" ? v : (v && v.file) || "").match(/Scripts\/([^/]+)\/([^/]+)\.js$/);
      if (m && !ctx.dataRef) { ctx.dataRef = { book: m[1], script: m[2] }; return null; }
      return raw;
    }
    case "repeat": case "retry": case "runFlow": {
      if (!v || typeof v !== "object" || !Array.isArray(v.commands)) return raw;
      const keys = Object.keys(v).filter(x => x !== "commands");
      const kids = () => v.commands.map(c => fromCommand(c, ctx)).filter(Boolean);
      if (k === "repeat" && keys.length === 1 && keys[0] === "times") return { type: "block", kind: "repeat", times: parseInt(v.times, 10) || 2, steps: kids() };
      if (k === "retry" && keys.every(x => x === "maxRetries")) return { type: "block", kind: "retry", times: parseInt(v.maxRetries, 10) || 3, steps: kids() };
      if (k === "repeat" && keys.length === 1 && keys[0] === "while") {
        const c = condFrom(v.while); if (c) return { type: "block", kind: "while", visible: c.visible, sel: c.sel, steps: kids() };
      }
      if (k === "runFlow" && keys.length === 1 && keys[0] === "when") {
        const c = condFrom(v.when); if (c) return { type: "block", kind: "if", visible: c.visible, sel: c.sel, steps: kids() };
      }
      return raw;
    }
  }
  return raw;
}

async function parseYaml(text, prevSteps) {
  if (!YAML) throw new Error("Editing the flow needs one more component. Close Understudy and run: npm install");
  const docs = YAML.parseAllDocuments(String(text || ""));
  for (const d of docs) if (d.errors && d.errors.length) {
    const e = d.errors[0]; throw new Error("YAML problem" + (e.linePos ? " on line " + e.linePos[0].line : "") + ": " + e.message.split("\n")[0]);
  }
  let config = {}, commands = [];
  if (docs.length >= 2) { config = docs[0].toJSON() || {}; commands = docs[1].toJSON() || []; }
  else if (docs.length === 1) {
    const v = docs[0].toJSON();
    if (Array.isArray(v)) commands = v; else config = v || {};
  }
  if (!Array.isArray(commands)) throw new Error("The part after --- must be a list of steps");

  const values = {};
  dataSteps((prevSteps || []).filter(s => s && typeof s === "object")).forEach(s => { if (!(s.column in values)) values[s.column] = s.value; });
  const ctx = { values, dataRef: null };
  const steps = commands.map(c => fromCommand(c, ctx)).filter(Boolean);

  // Resolve the runScript reference back to a test data file and sheet
  let data = null;
  if (ctx.dataRef) {
    const file = excel.scanExcel().find(f => f.name.toLowerCase() === (ctx.dataRef.book + ".xlsx").toLowerCase());
    if (file) {
      try {
        const sh = (await excel.readExcel(excel.resolveExcel(file.path))).find(s => safe(s.name) === ctx.dataRef.script);
        if (sh) {
          data = { file: file.path, sheet: sh.name };
          const head = (sh.rows[0] || []).map(h => String(h || "").trim()), row1 = sh.rows[1] || [];
          dataSteps(steps).forEach(s => {
            const c = head.indexOf(s.column);
            if (!s.value && c >= 0 && row1[c] != null) s.value = String(row1[c]);
          });
        }
      } catch (_) {}
    }
    if (!data) data = { file: "", workbook: ctx.dataRef.book, sheet: ctx.dataRef.script };
  }
  const tags = Array.isArray(config.tags) ? config.tags.map(String) : [];
  return { appId: String(config.appId || ""), name: config.name ? String(config.name) : "", tags, steps, data };
}

/* ======================= Test data ======================= */
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
  return { columns: cols.length, file: path.relative(PROJECT_DIR, file).split(path.sep).join("/") };
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

module.exports = { inspect, buildYaml, parseYaml, save, sheets, dataFiles, suggestColumn, normalize, COLUMN_RE };
