/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * The step model: what a recorded step may look like, and checks that turn
 * anything the window sends into clean, safe steps (normalize).
 * The full list of step types is at the top of recorder.js.
 */
const path  = require("path");
const excel = require("../data/excel");

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

/* "Next to another element" (sel.rel), see the step model at the top of recorder.js */
const REL_DIRS = ["below", "above", "leftOf", "rightOf"];
function checkRel(r) {
  if (!r || typeof r !== "object") throw new Error("\u201CNext to\u201D needs the other element");
  if (!REL_DIRS.includes(r.dir)) throw new Error("Next to: choose below, above, left of or right of");
  if (r.kind !== "id" && r.kind !== "text") throw new Error("Next to: find the other element by its text or ID");
  const v = String(r.value == null ? "" : r.value);
  if (!v.trim() || v.length > 300) throw new Error("Next to: enter the other element's text or ID");
  return { dir: r.dir, kind: r.kind, value: v, exact: !!r.exact };
}

function checkSel(sel) {
  if (!sel || typeof sel !== "object") throw new Error("A step is missing its target");
  if (sel.kind === "rel") {
    const rel = checkRel(sel.rel);
    const out = { kind: "rel", value: rel.value, exact: rel.exact, rel };
    if (sel.index != null && sel.index !== "") {
      const k = parseInt(sel.index, 10);
      if (!(k >= 0 && k <= 500)) throw new Error("Invalid target index: " + sel.index);
      out.index = k;
    }
    return out;
  }
  const v = String(sel.value == null ? "" : sel.value);
  if (!v || v.length > 300) throw new Error("A step has an empty or too long target");
  if (sel.kind === "point") { if (!PCT_RE.test(v)) throw new Error("Invalid screen position: " + v); return { kind: "point", value: v, exact: false }; }
  if (sel.kind !== "id" && sel.kind !== "text") throw new Error("Invalid target type");
  const out = { kind: sel.kind, value: v, exact: !!sel.exact };
  if (sel.rel && sel.rel.dir) out.rel = checkRel(sel.rel);
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

module.exports = {
  COLUMN_RE, BOOK_RE, SHEET_RE, FLOWNAME_RE, PCT_RE, MAX_STEPS, VAR_RE, REF_RE, APP_RE, KEY_NAMES,
  safe, area, contains, reEscape, SEL_TYPES,
  REL_DIRS, checkRel, checkSel, normStep, cleanEnv, walk, dataSteps, normalize, checkData
};
