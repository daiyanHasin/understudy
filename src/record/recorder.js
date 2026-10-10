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
let YAML = null;
try { YAML = require("yaml"); } catch (_) {}

const P = require("../core/paths");
const COLUMN_RE   = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
const BOOK_RE     = /^[A-Za-z0-9_-]{1,60}$/;
const SHEET_RE    = /^[A-Za-z0-9_-]{1,31}$/;
const FLOWNAME_RE = /^[A-Za-z0-9._\-/ ]{1,120}$/;
const PCT_RE      = /^\d{1,3}%,\d{1,3}%$/;
const MAX_STEPS   = 1000;
const VAR_RE      = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
const REF_RE      = /^(output\.)?[A-Za-z_][A-Za-z0-9_]{0,40}(\.[A-Za-z_][A-Za-z0-9_]{0,40})?$/;   // ${output.Token}, ${USER}, ${maestro.copiedText}
const APP_RE      = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const KEY_NAMES   = { back: "Back", enter: "Enter", home: "Home", tab: "Tab", backspace: "Backspace",
                      power: "Power", lock: "Lock", volumeUp: "Volume Up", volumeDown: "Volume Down" };
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

/**
 * Nodes under a point, from the window on top only. With `dump --windows`
 * a dialog, the keyboard and the app behind it are all in the list: a tap
 * goes to the top window, so only its nodes count. Overlays that never take
 * touches (accessibility / magnification) are skipped.
 */
const PASSIVE_WIN = /ACCESSIBILITY_OVERLAY|MAGNIFICATION/;
function nodesAt(nodes, x, y) {
  const hit = nodes.filter(n => contains(n, x, y) && n.x2 > n.x1 && n.y2 > n.y1 && !PASSIVE_WIN.test(n.wtype || ""));
  if (!hit.length) return hit;
  let top = hit[0];
  hit.forEach(n => { if ((n.layer || 0) > (top.layer || 0)) top = n; });
  return hit.filter(n => (n.win || 0) === (top.win || 0));
}

function inspect(nodes, x, y) {
  const under = nodesAt(nodes, x, y).sort((a, b) => area(a) - area(b) || b.i - a.i);
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

  const same = nodes.filter(n => (n.win || 0) === (target.win || 0));      // uniqueness within the window
  const c = [];
  const add = (sel, label) => {
    if (!sel.value || sel.value.length > 120 || (sel.text && sel.text.length > 120)) return;
    if (c.some(o => o.kind === sel.kind && o.value === sel.value && (o.text || "") === (sel.text || ""))) return;
    const hits = matches(same, sel);
    const o = Object.assign({}, sel, { unique: hits.length <= 1, count: Math.max(hits.length, 1), label });
    if (hits.length > 1) {
      const k = hits.findIndex(h => h.i === target.i || isInside(same, h, target));
      if (k >= 0) o.pos = k;
    }
    c.push(o);
  };
  const idShort = target.id.split(":id/").pop();
  const shown = field ? "" : (target.text || target.desc);
  if (target.id) add({ kind: "id", value: target.id }, "ID  " + idShort);
  if (field) {
    add({ kind: "text", value: placeholder }, "Placeholder  \u201C" + placeholder + "\u201D");
    if (field.desc) add({ kind: "text", value: field.desc }, "Label  \u201C" + field.desc + "\u201D");
  } else {
    if (target.text) add({ kind: "text", value: target.text }, "Text  \u201C" + target.text + "\u201D");
    if (target.desc) add({ kind: "text", value: target.desc }, "Label  \u201C" + target.desc + "\u201D");
  }
  // A list of rows with the same ID: the ID plus the row's own text is usually unique
  if (target.id && shown && !c.some(o => o.unique)) add({ kind: "id", value: target.id, text: shown }, "ID + text  " + idShort + " \u201C" + shown + "\u201D");
  // Still nothing unique: the Nth match (top to bottom). Better than tapping the first match or a screen position.
  if (!c.some(o => o.unique)) {
    const best = c.find(o => o.pos !== undefined && !o.text);
    if (best) c.push({ kind: best.kind, value: best.value, index: best.pos, unique: true, count: 1, fragile: true,
                       label: best.label.split(/\s{2}/)[0] + " #" + (best.pos + 1) + " of " + best.count + "  " + best.label.split(/\s{2}/).slice(1).join("  ") });
  }
  c.forEach(o => { delete o.pos; });
  // Unique and stable first, then "Nth match", then not unique; the screen position is always last
  const rank = o => o.unique ? (o.fragile ? 1 : 0) : 2;
  c.sort((a, b) => rank(a) - rank(b));
  c.push(point);

  return {
    element: {
      id: target.id, idShort, text: field ? "" : target.text, desc: target.desc, hint: target.hint,
      placeholder, cls: target.cls.split(".").pop(), editable: !!field, password: target.password,
      pkg: target.pkg, bounds: [target.x1, target.y1, target.x2, target.y2],
      checked: target.checkable ? target.checked : undefined, enabled: target.enabled
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

/*
 * Which elements Maestro would find for a selector, the way Maestro finds them:
 * text matches the text, the accessibility label or the hint; an element whose
 * child matches too is dropped (the deepest match wins); `index` counts the
 * matches top-to-bottom, then left-to-right.
 */
const hasText = (n, v) => n.text === v || n.desc === v || n.hint === v;
function selMatch(n, sel) {
  if (sel.kind === "id") return n.id === sel.value && (!sel.text || hasText(n, sel.text));
  return hasText(n, sel.value);
}
function matches(nodes, sel) {
  const hits = nodes.filter(n => n.x2 > n.x1 && n.y2 > n.y1 && selMatch(n, sel));
  const hitSet = new Set(hits.map(n => n.i));
  const byI = new Map(nodes.map(n => [n.i, n]));
  const ancestors = new Set();
  hits.forEach(h => {
    let p = h.parent, guard = 0;
    while (p !== undefined && p >= 0 && guard++ < 200) {
      if (hitSet.has(p)) ancestors.add(p);
      const pn = byI.get(p); p = pn ? pn.parent : -1;
    }
  });
  return hits.filter(n => !ancestors.has(n.i)).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
}
/** Is `n` the element `outer` or inside it? */
function isInside(nodes, n, outer) {
  const byI = new Map(nodes.map(x => [x.i, x]));
  let p = n.i, guard = 0;
  while (p !== undefined && p >= 0 && guard++ < 200) {
    if (p === outer.i) return true;
    const pn = byI.get(p); p = pn ? pn.parent : -1;
  }
  return false;
}

/** When the screen layout can't be read: the step still gets the screen position. */
function pointOnly(x, y, size, warning) {
  const pct = (v, t) => Math.max(0, Math.min(100, Math.round(v / t * 100)));
  return { element: null, size, warning: warning || "",
           candidates: [{ kind: "point", value: pct(x, size.w) + "%," + pct(y, size.h) + "%", unique: true, count: 1, label: "Screen position" }] };
}

/* ======================= Validation ======================= */
function checkSel(sel) {
  if (!sel || typeof sel !== "object") throw new Error("A step is missing its target");
  const v = String(sel.value == null ? "" : sel.value);
  if (!v || v.length > 300) throw new Error("A step has an empty or too long target");
  if (sel.kind === "point") { if (!PCT_RE.test(v)) throw new Error("Invalid screen position: " + v); return { kind: "point", value: v, exact: false }; }
  if (sel.kind !== "id" && sel.kind !== "text") throw new Error("Invalid target type");
  const out = { kind: sel.kind, value: v, exact: !!sel.exact };
  if (sel.kind === "id" && sel.text != null && String(sel.text) !== "") {
    const t = String(sel.text);
    if (t.length > 300) throw new Error("A step has a too long target text");
    out.text = t;
  }
  if (sel.index != null && sel.index !== "") {
    const k = parseInt(sel.index, 10);
    if (!(k >= 0 && k <= 500)) throw new Error("Invalid target index: " + sel.index);
    out.index = k;
  }
  return out;
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
      const mode = s.mode === "data" ? "data" : s.mode === "var" ? "var" : "fixed";
      const value = String(s.value == null ? "" : s.value);
      if (value.length > 1000) throw new Error("Typed text is too long");
      if (mode === "data" && !COLUMN_RE.test(String(s.column || "")))
        throw new Error("Column names use letters, numbers and _ and start with a letter: " + s.column);
      if (mode === "var") {
        const ref = String(s.ref || "");
        if (!REF_RE.test(ref)) throw new Error("Variable to type: e.g. output.Token or USER_NAME");
        return { type: t, mode, ref, value, password: !!s.password };
      }
      return { type: t, mode, value, column: mode === "data" ? String(s.column) : undefined, password: !!s.password };
    }
    case "openApp": case "stopApp": case "killApp": case "clearState": {
      const appId = String(s.appId || "").trim();
      if (appId && !APP_RE.test(appId)) throw new Error("Invalid app ID: " + appId);
      if (t === "openApp" && !appId) throw new Error("Open app: choose the app");
      const o = { type: t, appId };
      if (t === "openApp") { o.clearState = !!s.clearState; o.stopApp = s.stopApp !== false; }
      return o;
    }
    case "openLink": {
      const url = String(s.url || "").trim();
      if (!/^[a-z][a-z0-9+.-]*:\/\/\S{1,2000}$/i.test(url) && !/^\$\{[^}]{1,200}\}$/.test(url)) throw new Error("Open link: enter a full address like https://example.com");
      return { type: t, url, browser: !!s.browser };
    }
    case "setVar": {
      const name = String(s.name || "");
      if (!VAR_RE.test(name)) throw new Error("Variable names use letters, numbers and _ and start with a letter");
      const mode = s.mode === "expr" ? "expr" : "text";
      const value = String(s.value == null ? "" : s.value);
      if (value.length > 2000 || (mode === "expr" && (/\$\{/.test(value) || !value.trim()))) throw new Error("Invalid value for " + name);
      return { type: t, name, mode, value };
    }
    case "copyText": {
      const name = s.name ? String(s.name) : "";
      if (name && !VAR_RE.test(name)) throw new Error("Variable names use letters, numbers and _ and start with a letter");
      return { type: t, sel: checkSel(s.sel), name };
    }
    case "paste": return { type: t };
    case "assertTrue": {
      const expr = String(s.expr || "").trim();
      if (!expr || expr.length > 500 || /\$\{/.test(expr)) throw new Error("Check: write a JavaScript condition, e.g. output.Total > 0");
      return { type: t, expr };
    }
    case "waitUntil":
      return { type: t, sel: checkSel(s.sel), visible: s.visible !== false,
               timeout: Math.max(500, Math.min(600000, parseInt(s.timeout, 10) || 10000)) };
    case "runFlowFile": case "runScriptFile": {
      const file = String(s.file || "").trim().replace(/\\/g, "/");
      if (!/^[A-Za-z0-9._\-\/ ]{1,200}$/.test(file) || (t === "runFlowFile" ? !/\.ya?ml$/i.test(file) : !/\.js$/i.test(file)))
        throw new Error(t === "runFlowFile" ? "Run flow: give a .yaml file, e.g. common/login.yaml" : "Run script: give a .js file");
      const o = { type: t, file };
      if (t === "runFlowFile" && s.env && typeof s.env === "object") o.env = cleanEnv(s.env);
      return o;
    }
    case "setLocation": {
      const lat = Number(s.lat), lon = Number(s.lon);
      if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) throw new Error("Location: latitude -90..90, longitude -180..180");
      return { type: t, lat, lon };
    }
    case "airplane": return { type: t, on: s.on !== false };
    case "record": {
      const action = s.action === "stop" ? "stop" : "start";
      return { type: t, action, name: String(s.name || "recording").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60) || "recording" };
    }
    case "swipe":
      if (!PCT_RE.test(String(s.from)) || !PCT_RE.test(String(s.to))) throw new Error("Invalid swipe");
      return { type: t, from: String(s.from), to: String(s.to) };
    case "erase": return { type: t, count: Math.max(1, Math.min(200, parseInt(s.count, 10) || 50)) };
    case "key":
      if (!(s.key in KEY_NAMES)) throw new Error("Invalid key");
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
      if (kind === "while") { b.visible = s.visible !== false; b.sel = checkSel(s.sel); }
      if (kind === "if") {
        b.cond = s.cond === "expr" ? "expr" : (s.cond === "notVisible" || s.visible === false) ? "notVisible" : "visible";
        if (b.cond === "expr") {
          b.expr = String(s.expr || "").trim();
          if (!b.expr || b.expr.length > 500 || /\$\{/.test(b.expr)) throw new Error("If: write a JavaScript condition, e.g. output.Role == 'admin'");
        } else { b.visible = b.cond === "visible"; b.sel = checkSel(s.sel); }
        b.elseSteps = (Array.isArray(s.elseSteps) ? s.elseSteps : []).map(x => normStep(x, depth + 1));
      }
      return b;
    }
    case "raw":
      if (s.value === undefined || JSON.stringify(s.value).length > 20000) throw new Error("Invalid custom step");
      return { type: t, value: s.value };
    default: throw new Error("Unknown step type: " + t);
  }
}

function cleanEnv(env) {
  const out = {};
  Object.keys(env || {}).slice(0, 50).forEach(k => {
    if (VAR_RE.test(k)) out[k] = String(env[k] == null ? "" : env[k]).slice(0, 1000);
  });
  return out;
}
function walk(steps, fn) {
  steps.forEach(s => { fn(s); if (s.type === "block") { walk(s.steps || [], fn); walk(s.elseSteps || [], fn); } });
}
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
  out.env = cleanEnv(rec.env);
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
  const rx = v => q(sel.exact ? v : reEscape(v));
  const L = [pad + sel.kind + ": " + rx(sel.value)];
  if (sel.kind === "id" && sel.text) L.push(pad + "text: " + rx(sel.text));
  if (sel.index != null) L.push(pad + "index: " + sel.index);
  return L;
}

// JS string literal that is safe inside ${...} in YAML
const jsStr = v => JSON.stringify(String(v)).replace(/\$\{/g, "$\\u007b").replace(/\}/g, "\\u007d");
const script = js => q("${" + js + "}");

function stepLines(s, pad, ctx) {
  ctx = ctx || { ifs: 0 };
  const P = pad, I = pad + "    ";
  switch (s.type) {
    case "launch": return s.clearState ? [P + "- launchApp:", I + "clearState: true"] : [P + "- launchApp"];
    case "tap": case "doubleTap": case "longPress": case "assertVisible": case "assertNotVisible":
      return [P + "- " + CMD[s.type] + ":"].concat(selLines(s.sel, I));
    case "scrollUntilVisible":
      return [P + "- scrollUntilVisible:", I + "element:"].concat(selLines(s.sel, I + "  "), [I + "direction: " + s.direction]);
    case "input":
      if (s.mode === "var") return [P + "- inputText: " + q("${" + s.ref + "}")];
      return [P + "- inputText: " + (s.mode === "data" ? "\"${output." + s.column + "}\"" : q(s.value))];
    case "openApp": {
      const L = [P + "- launchApp:", I + "appId: " + q(s.appId)];
      if (s.clearState) L.push(I + "clearState: true");
      if (!s.stopApp) L.push(I + "stopApp: false");
      return L;
    }
    case "stopApp": case "killApp": case "clearState":
      return [P + "- " + s.type + (s.appId ? ": " + q(s.appId) : "")];
    case "openLink":
      return s.browser ? [P + "- openLink:", I + "link: " + q(s.url), I + "browser: true"] : [P + "- openLink: " + q(s.url)];
    case "setVar":
      return [P + "- evalScript: " + script("output." + s.name + " = " + (s.mode === "expr" ? s.value : jsStr(s.value)))];
    case "copyText": {
      const L = [P + "- copyTextFrom:"].concat(selLines(s.sel, I));
      if (s.name) L.push(P + "- evalScript: " + script("output." + s.name + " = maestro.copiedText"));
      return L;
    }
    case "paste": return [P + "- pasteText"];
    case "assertTrue": return [P + "- assertTrue: " + script(s.expr)];
    case "waitUntil":
      return [P + "- extendedWaitUntil:", I + (s.visible ? "visible:" : "notVisible:")].concat(selLines(s.sel, I + "  "), [I + "timeout: " + s.timeout]);
    case "runFlowFile": {
      if (!s.env || !Object.keys(s.env).length) return [P + "- runFlow: " + q(s.file)];
      const L = [P + "- runFlow:", I + "file: " + q(s.file), I + "env:"];
      Object.keys(s.env).forEach(k => L.push(I + "  " + k + ": " + q(s.env[k])));
      return L;
    }
    case "runScriptFile": return [P + "- runScript: " + q(s.file)];
    case "setLocation": return [P + "- setLocation:", I + "latitude: " + s.lat, I + "longitude: " + s.lon];
    case "airplane": return [P + "- setAirplaneMode: " + (s.on ? "enabled" : "disabled")];
    case "record": return s.action === "start" ? [P + "- startRecording: " + q(s.name)] : [P + "- stopRecording"];
    case "erase":  return [P + "- eraseText: " + s.count];
    case "swipe":  return [P + "- swipe:", I + "start: " + q(s.from), I + "end: " + q(s.to)];
    case "scroll": return [P + "- scroll"];
    case "hideKeyboard": return [P + "- hideKeyboard"];
    case "wait":   return [P + "- waitForAnimationToEnd"];
    case "key":    return [P + (s.key === "back" ? "- back" : "- pressKey: " + KEY_NAMES[s.key])];
    case "screenshot": return [P + "- takeScreenshot: " + q(s.name)];
    case "block": {
      const L = [];
      const cond = (word) => [I + word + ":", I + "  " + (s.visible ? "visible" : "notVisible") + ":"].concat(selLines(s.sel, I + "    "));
      const kids = (list, extra) => {
        L.push(I + "commands:");
        if (extra) L.push(I + "  " + extra);
        if (!list.length && !extra) L.push(I + "  - waitForAnimationToEnd");
        list.forEach(c => L.push(...stepLines(c, I + "  ", ctx)));
      };
      if (s.kind === "if") {
        const whenLines = s.cond === "expr" ? [I + "when:", I + "  true: " + script(s.expr)] : cond("when");
        if (!s.elseSteps || !s.elseSteps.length) { L.push(P + "- runFlow:", ...whenLines); kids(s.steps); return L; }
        // If / else: a flag decides the else part, so the "if" part may change the screen safely
        const flag = "_else" + (++ctx.ifs);
        L.push(P + "- evalScript: " + script("output." + flag + " = true"));
        L.push(P + "- runFlow:", ...whenLines);
        kids(s.steps, "- evalScript: " + script("output." + flag + " = false"));
        L.push(P + "- runFlow:", I + "when:", I + "  true: " + script("output." + flag));
        kids(s.elseSteps);
        return L;
      }
      if (s.kind === "repeat") L.push(P + "- repeat:", I + "times: " + s.times);
      if (s.kind === "while")  L.push(P + "- repeat:", ...cond("while"));
      if (s.kind === "retry")  L.push(P + "- retry:", I + "maxRetries: " + s.times);
      kids(s.steps);
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
  const envKeys = Object.keys(rec.env || {});
  if (envKeys.length) { L.push("env:"); envKeys.forEach(k => L.push("  " + k + ": " + q(rec.env[k]))); }
  L.push("---");
  if (rec.data) L.push("- runScript: " + q(scriptRef(rec.flow, rec.data)));
  const ctx = { ifs: 0 };
  rec.steps.forEach(s => L.push(...stepLines(s, "", ctx)));
  return { yaml: L.join("\n") + "\n", rec };
}

/* ======================= YAML -> steps ======================= */
function selFrom(v) {
  if (typeof v === "string" || typeof v === "number") return { kind: "text", value: String(v), exact: true };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v);
    if (!keys.length || keys.some(k => typeof v[k] === "object")) return null;
    if (keys.length === 1 && keys[0] === "point") {
      const value = String(v.point);
      return PCT_RE.test(value) ? { kind: "point", value, exact: true } : null;
    }
    // id, text, id + text, and any of them with index
    if (keys.every(k => k === "id" || k === "text" || k === "index") && (v.id !== undefined || v.text !== undefined)) {
      const sel = v.id !== undefined ? { kind: "id", value: String(v.id), exact: true } : { kind: "text", value: String(v.text), exact: true };
      if (v.id !== undefined && v.text !== undefined) sel.text = String(v.text);
      if (v.index !== undefined) {
        if (!/^\d{1,3}$/.test(String(v.index))) return null;
        sel.index = +v.index;
      }
      return sel;
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

const SCRIPT_ONLY = v => typeof v === "string" && /^\$\{([\s\S]*)\}$/.test(v.trim()) ? v.trim().slice(2, -1).trim() : null;
function unJsStr(js) {
  const t = js.trim();
  if (!/^"([^"\\]|\\.)*"$/.test(t)) return null;
  try { return JSON.parse(t); } catch (_) { return null; }
}

/* Turn a list of commands into steps; recognises the if/else pattern made by stepLines. */
function fromList(list, ctx) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    // copyTextFrom + evalScript output.X = maestro.copiedText  ->  one "copy into variable" step
    if (c && typeof c === "object" && c.copyTextFrom !== undefined) {
      const sel = selFrom(c.copyTextFrom);
      const nxt = list[i + 1], js = nxt && typeof nxt === "object" ? SCRIPT_ONLY(nxt.evalScript) : null;
      const m = js && js.match(/^output\.([A-Za-z_]\w*)\s*=\s*maestro\.copiedText;?$/);
      if (sel) { out.push({ type: "copyText", sel, name: m ? m[1] : "" }); if (m) i++; continue; }
    }
    // evalScript flag=true, runFlow when(...) [flag=false, ...], runFlow when true flag  ->  if / else
    const js0 = c && typeof c === "object" ? SCRIPT_ONLY(c.evalScript) : null;
    const f0 = js0 && js0.match(/^output\.(_else\d+)\s*=\s*true;?$/);
    if (f0) {
      const a = list[i + 1], b = list[i + 2];
      const ra = a && a.runFlow, rb = b && b.runFlow;
      const first = ra && Array.isArray(ra.commands) ? ra.commands[0] : null;
      const jsF = first && typeof first === "object" ? SCRIPT_ONLY(first.evalScript) : null;
      const jsB = rb && rb.when && Object.keys(rb.when).length === 1 ? SCRIPT_ONLY(rb.when.true) : null;
      if (ra && rb && jsF && new RegExp("^output\\." + f0[1] + "\\s*=\\s*false;?$").test(jsF) &&
          jsB && new RegExp("^output\\." + f0[1] + ";?$").test(jsB) && Array.isArray(rb.commands)) {
        const blk = ifFrom(ra.when, ra.commands.slice(1), ctx);
        if (blk) { blk.elseSteps = fromList(rb.commands, ctx); out.push(blk); i += 2; continue; }
      }
    }
    const s = fromCommand(c, ctx);
    if (s) out.push(s);
  }
  return out;
}

function ifFrom(when, commands, ctx) {
  if (!when || typeof when !== "object" || Object.keys(when).length !== 1) return null;
  if (when.true !== undefined) {
    const js = SCRIPT_ONLY(String(when.true));
    if (js == null) return null;
    return { type: "block", kind: "if", cond: "expr", expr: js, steps: fromList(commands, ctx), elseSteps: [] };
  }
  const c = condFrom(when);
  return c ? { type: "block", kind: "if", cond: c.visible ? "visible" : "notVisible", visible: c.visible, sel: c.sel,
               steps: fromList(commands, ctx), elseSteps: [] } : null;
}

function fromCommand(item, ctx) {
  const raw = { type: "raw", value: item };
  if (typeof item === "string") {
    return { launchApp: { type: "launch", clearState: false }, back: { type: "key", key: "back" },
             scroll: { type: "scroll" }, hideKeyboard: { type: "hideKeyboard" },
             waitForAnimationToEnd: { type: "wait" }, pasteText: { type: "paste" },
             stopApp: { type: "stopApp", appId: "" }, killApp: { type: "killApp", appId: "" },
             clearState: { type: "clearState", appId: "" }, stopRecording: { type: "record", action: "stop", name: "" } }[item] || raw;
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
      if (typeof v === "object" && APP_RE.test(String(v.appId || "")) && Object.keys(v).every(x => ["appId", "clearState", "stopApp"].includes(x)))
        return { type: "openApp", appId: String(v.appId), clearState: !!v.clearState, stopApp: v.stopApp !== false };
      if (typeof v === "string" && APP_RE.test(v)) return { type: "openApp", appId: v, clearState: false, stopApp: true };
      return raw;
    case "stopApp": case "killApp": case "clearState":
      return typeof v === "string" && APP_RE.test(v) ? { type: k, appId: v } : raw;
    case "openLink":
      if (typeof v === "string") return { type: "openLink", url: v, browser: false };
      if (v && typeof v === "object" && typeof v.link === "string" && Object.keys(v).every(x => ["link", "browser"].includes(x)))
        return { type: "openLink", url: v.link, browser: !!v.browser };
      return raw;
    case "evalScript": {
      const js = SCRIPT_ONLY(String(v));
      const m = js && js.match(/^output\.([A-Za-z_]\w*)\s*=\s*([\s\S]+?);?$/);
      if (!m || /^_else\d+$/.test(m[1])) return raw;
      const lit = unJsStr(m[2]);
      return lit != null ? { type: "setVar", name: m[1], mode: "text", value: lit } : { type: "setVar", name: m[1], mode: "expr", value: m[2].trim() };
    }
    case "copyTextFrom": { const sel = selFrom(v); return sel ? { type: "copyText", sel, name: "" } : raw; }
    case "assertTrue": { const js = SCRIPT_ONLY(String(v)); return js ? { type: "assertTrue", expr: js } : raw; }
    case "extendedWaitUntil": {
      if (!v || typeof v !== "object") return raw;
      const vis = v.visible !== undefined ? "visible" : v.notVisible !== undefined ? "notVisible" : null;
      if (!vis || Object.keys(v).some(x => ![vis, "timeout"].includes(x))) return raw;
      const sel = selFrom(v[vis]);
      return sel ? { type: "waitUntil", sel, visible: vis === "visible", timeout: parseInt(v.timeout, 10) || 10000 } : raw;
    }
    case "setLocation":
      return v && typeof v === "object" && Object.keys(v).every(x => ["latitude", "longitude"].includes(x))
        ? { type: "setLocation", lat: Number(v.latitude), lon: Number(v.longitude) } : raw;
    case "setAirplaneMode": return { type: "airplane", on: String(v) !== "disabled" };
    case "startRecording": return typeof v === "string" ? { type: "record", action: "start", name: v } : raw;
    case "inputText": {
      if (typeof v !== "string" && typeof v !== "number") return raw;
      const m = String(v).match(/^\$\{output\.([A-Za-z_][A-Za-z0-9_]*)\}$/);
      if (m && (m[1] in ctx.values || ctx.dataRef)) return { type: "input", mode: "data", column: m[1], value: ctx.values[m[1]] || "" };
      const r = String(v).match(/^\$\{([A-Za-z_][\w]*(\.[A-Za-z_]\w*)?)\}$/);
      if (r && (ctx.vars.has(r[1].replace(/^output\./, "")) || !r[1].startsWith("output."))) return { type: "input", mode: "var", ref: r[1], value: "" };
      if (m) return { type: "input", mode: "data", column: m[1], value: ctx.values[m[1]] || "" };
      return { type: "input", mode: "fixed", value: String(v) };
    }
    case "eraseText": return { type: "erase", count: parseInt(v, 10) || 50 };
    case "swipe":
      if (v && PCT_RE.test(String(v.start)) && PCT_RE.test(String(v.end)) && Object.keys(v).length === 2)
        return { type: "swipe", from: String(v.start), to: String(v.end) };
      return raw;
    case "pressKey": {
      const key = Object.keys(KEY_NAMES).find(k => KEY_NAMES[k].toLowerCase() === String(v).toLowerCase());
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
      if (typeof v === "string" && /\.js$/i.test(v)) return { type: "runScriptFile", file: v };
      return raw;
    }
    case "repeat": case "retry": case "runFlow": {
      if (k === "runFlow" && typeof v === "string" && /\.ya?ml$/i.test(v)) return { type: "runFlowFile", file: v };
      if (k === "runFlow" && v && typeof v === "object" && typeof v.file === "string" && !v.commands &&
          Object.keys(v).every(x => ["file", "env"].includes(x))) return { type: "runFlowFile", file: v.file, env: v.env || undefined };
      if (!v || typeof v !== "object" || !Array.isArray(v.commands)) return raw;
      const keys = Object.keys(v).filter(x => x !== "commands");
      const kids = () => fromList(v.commands, ctx);
      if (k === "repeat" && keys.length === 1 && keys[0] === "times") return { type: "block", kind: "repeat", times: parseInt(v.times, 10) || 2, steps: kids() };
      if (k === "retry" && keys.every(x => x === "maxRetries")) return { type: "block", kind: "retry", times: parseInt(v.maxRetries, 10) || 3, steps: kids() };
      if (k === "repeat" && keys.length === 1 && keys[0] === "while") {
        const c = condFrom(v.while); if (c) return { type: "block", kind: "while", visible: c.visible, sel: c.sel, steps: kids() };
      }
      if (k === "runFlow" && keys.length === 1 && keys[0] === "when") {
        const b = ifFrom(v.when, v.commands, ctx); if (b) return b;
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
  const vars = new Set(Object.keys(config.env || {}));
  JSON.stringify(commands).replace(/output\.([A-Za-z_]\w*)\s*=/g, (_, n) => { vars.add(n); return ""; });
  const ctx = { values, dataRef: null, vars };
  const steps = fromList(commands, ctx);

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
  const env = config.env && typeof config.env === "object" ? cleanEnv(config.env) : {};
  return { appId: String(config.appId || ""), name: config.name ? String(config.name) : "", tags, steps, data, env };
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

/* Compact node list for the live inspector (hover outlines in the window). */
function compactNodes(nodes) {
  return nodes.filter(n => n.x2 > n.x1 && n.y2 > n.y1).map(n => {
    const o = { i: n.i, p: n.parent, b: [n.x1, n.y1, n.x2, n.y2], c: n.cls.split(".").pop() };
    if (n.id) o.id = n.id; if (n.text) o.t = n.text.slice(0, 120); if (n.desc) o.d = n.desc.slice(0, 120);
    if (n.hint) o.h = n.hint.slice(0, 80); if (n.clickable) o.k = 1; if (n.editable) o.e = 1;
    if (n.scrollable) o.s = 1; if (n.password) o.pw = 1; if (n.win) o.w = n.win; if (n.layer) o.l = n.layer;
    if (n.pkg) o.pk = n.pkg; if (n.checkable) o.ck = n.checked ? 2 : 1; if (n.enabled === false) o.dis = 1;
    return o;
  });
}

module.exports = { inspect, nodesAt, matches, pointOnly, buildYaml, parseYaml, save, sheets, dataFiles, suggestColumn, normalize, compactNodes, COLUMN_RE };
