/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Steps -> Maestro YAML (the preview and the saved flow).
 */
let YAML = null;
try { YAML = require("yaml"); } catch (_) {}
const path    = require("path");
const prepare = require("../data/prepare");
const flowIo  = require("../data/flows-io");
const { KEY_NAMES, safe, reEscape, normalize } = require("./steps");

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

module.exports = {
  buildYaml, stepLines, selLines, scriptRef, q, jsStr
};
