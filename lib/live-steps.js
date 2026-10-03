/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Live step progress.
 *
 * When `maestro test` writes an HTML report it runs in "suite" mode and
 * prints almost nothing per step to the console. It does, however, write
 * one line per command to maestro.log in the --debug-output folder, e.g.
 *   ... Tap on "Sign In" RUNNING
 *   ... Tap on "Sign In" COMPLETED
 * This module tails that file while the flow runs and reports each line.
 */

const fs   = require("fs");
const path = require("path");

const STATUS_RE = /\s(RUNNING|COMPLETED|FAILED|SKIPPED|WARNED)\s*$/;

function findFile(dir, name, depth) {
  depth = depth || 0;
  if (depth > 4) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return null; }
  for (const e of entries) if (e.isFile() && e.name === name) return path.join(dir, e.name);
  for (const e of entries) {
    if (e.isDirectory()) {
      const f = findFile(path.join(dir, e.name), name, depth + 1);
      if (f) return f;
    }
  }
  return null;
}

// "12:01:02.345 [ INFO] m.c.r.TestSuiteInteractor: Tap on "Sign In" COMPLETED"
//   -> { desc: 'Tap on "Sign In"', status: "COMPLETED" }
function parseLine(line) {
  const m = line.match(STATUS_RE);
  if (!m) {
    const f = line.match(/Running flow (.+)$/);
    return f ? { flow: f[1].trim() } : null;
  }
  let text = line.slice(0, m.index);
  const br = text.indexOf("]");
  const colon = text.indexOf(": ", br >= 0 ? br : 0);
  if (colon >= 0) text = text.slice(colon + 2);
  text = text.trim();
  if (!text || /generated output$/.test(text)) return null;
  // Log time of day ("12:01:02.345") -> ms, for accurate step durations
  const t = line.match(/^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
  const ts = t ? ((+t[1] * 60 + +t[2]) * 60 + +t[3]) * 1000 + +t[4] : null;
  return { desc: text, status: m[1], ts };
}

/** Tail <dir>/**\/maestro.log; calls onStep({desc,status}) / onStep({flow}). */
function tail(dir, onStep) {
  let file = null, offset = 0, partial = "";

  function poll() {
    if (!file) file = findFile(dir, "maestro.log");
    if (!file) return;
    let size;
    try { size = fs.statSync(file).size; } catch (_) { return; }
    if (size <= offset) return;
    const buf = Buffer.alloc(size - offset);
    try {
      const fd = fs.openSync(file, "r");
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
    } catch (_) { return; }
    offset = size;
    const lines = (partial + buf.toString("utf8")).split(/\r?\n/);
    partial = lines.pop();
    for (const l of lines) {
      const s = parseLine(l);
      if (s) onStep(s);
    }
  }

  const timer = setInterval(poll, 400);
  return {
    stop() {
      clearInterval(timer);
      poll();
      if (partial) { const s = parseLine(partial); if (s) onStep(s); partial = ""; }
    }
  };
}

/** First failure screenshot Maestro saved in the debug folder, if any. */
function failureScreenshot(dir) {
  const pngs = [];
  (function walk(d, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.png$/i.test(e.name)) pngs.push(full);
    }
  })(dir, 0);
  return pngs.find(p => /❌|fail/i.test(path.basename(p))) || null;
}

module.exports = { tail, parseLine, failureScreenshot };
