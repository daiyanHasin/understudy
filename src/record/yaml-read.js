/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Maestro YAML -> steps (when the tester edits the YAML by hand, the step list
 * follows). Commands Understudy has no step for are kept as "raw" steps, word
 * for word, so nothing the tester wrote is lost.
 */
let YAML = null;
try { YAML = require("yaml"); } catch (_) {}
const excel = require("../data/excel");
const { PCT_RE, APP_RE, KEY_NAMES, safe, cleanEnv, dataSteps } = require("./steps");

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

module.exports = {
  parseYaml
};
