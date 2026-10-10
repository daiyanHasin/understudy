/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Run a flow from step N, with its data still loaded.
 *
 * The problem (also in Maestro Studio): when a flow is started from step 12,
 * steps 1-11 never run. If step 3 was `runScript: ../Scripts/Login/Valid.js`
 * (the Excel row) or `evalScript: ${output.x = ...}` (a variable), then step 15
 * that uses ${output.Email} gets "undefined".
 *
 * Fix: build a temporary copy of the flow that keeps every *setup* command
 * that comes before step N (data scripts, evalScript, variable setters,
 * clipboard-free env setup) and then continues from step N. The copy sits
 * next to the original (so relative paths like ../Scripts/... still work),
 * starts with a dot (so it is never listed as a flow) and is deleted after
 * the run.
 */

const fs   = require("fs");
const path = require("path");
const flowIo = require("../data/flows-io");
let YAML = null;
try { YAML = require("yaml"); } catch (_) {}

// Commands that only prepare data or variables: safe to replay, no UI needed.
const SETUP = new Set(["runScript", "evalScript", "setLocation", "setAirplaneMode", "setPermissions"]);

function splitFlow(text) {
  const m = text.match(/^---[ \t]*$/m);
  if (!m) return { config: "", body: text };
  return { config: text.slice(0, m.index), body: text.slice(m.index + m[0].length) };
}

/** Top-level commands of a flow, each with a one-line label (for the step picker). */
function commands(flowRel) {
  if (!YAML) throw new Error("This needs one more component. Close Understudy and run: npm install");
  const text = flowIo.readFlow(flowRel);
  const { body } = splitFlow(text);
  const list = YAML.parse(body) || [];
  if (!Array.isArray(list)) throw new Error("The part after --- must be a list of steps");
  return list.map((c, i) => ({ n: i + 1, label: label(c), setup: isSetup(c) }));
}

function isSetup(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  const k = Object.keys(c)[0];
  return SETUP.has(k);
}

function label(c) {
  if (typeof c === "string") return c;
  if (!c || typeof c !== "object") return String(c);
  const k = Object.keys(c)[0], v = c[k];
  let t = v == null ? "" : typeof v === "object"
    ? (v.text || v.id || v.file || v.point || (v.element && (v.element.text || v.element.id)) || "")
    : String(v);
  t = String(t).replace(/\s+/g, " ");
  return k + (t ? ": " + (t.length > 60 ? t.slice(0, 57) + "\u2026" : t) : "");
}

/**
 * Write the temporary flow that starts at `fromStep` (1-based).
 * Returns { rel, full, replayed: [labels] }.
 */
function create(flowRel, fromStep) {
  if (!YAML) throw new Error("This needs one more component. Close Understudy and run: npm install");
  const full = flowIo.resolveFlow(flowRel);
  const text = fs.readFileSync(full, "utf8");
  const { config, body } = splitFlow(text);
  if (!config.trim()) throw new Error(flowRel + ": the flow has no appId header, so it can't start from a step");
  const list = YAML.parse(body) || [];
  if (!Array.isArray(list)) throw new Error(flowRel + ": the part after --- must be a list of steps");
  const n = Math.round(Number(fromStep));
  if (!Number.isFinite(n) || n < 1 || n > list.length) throw new Error(flowRel + ": step " + fromStep + " does not exist (" + list.length + " steps)");

  const replay = list.slice(0, n - 1).filter(isSetup);
  const steps  = replay.concat(list.slice(n - 1));
  const out = config.replace(/\s*$/, "\n") + "---\n" +
              "# Temporary copy made by Understudy: starts at step " + n + " of " + path.basename(full) + ".\n" +
              (replay.length ? "# Replayed first so data and variables are loaded: " + replay.map(label).join(" | ") + "\n" : "") +
              YAML.stringify(steps, { lineWidth: 0 });
  const tmpFull = path.join(path.dirname(full), ".us-from-" + n + "-" + path.basename(full));
  fs.writeFileSync(tmpFull, out, "utf8");
  const rel = path.relative(flowIo.FLOWS_DIR, tmpFull).split(path.sep).join("/");
  return { rel, full: tmpFull, replayed: replay.map(label) };
}

function remove(p) { try { if (p && path.basename(p).startsWith(".us-from-")) fs.unlinkSync(p); } catch (_) {} }

module.exports = { create, remove, commands, splitFlow, label };
