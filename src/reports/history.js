/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Run history: every finished run is appended to History/history.json
 * (newest last, capped). Powers the Dashboard charts, run comparison and
 * the Reports tab. Step-by-step details are kept for the newest runs only,
 * so the file (and the Dashboard) stays fast.
 */

const fs   = require("fs");
const path = require("path");
const P    = require("../core/paths");

const FILE = () => path.join(P.history, "history.json");
const MAX_RUNS = 300;
const KEEP_STEPS = 40;           // newest runs that keep their step lists

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (_) { return []; }
}

function add(run) {
  const all = load();
  all.push(run);
  while (all.length > MAX_RUNS) all.shift();
  all.slice(0, Math.max(0, all.length - KEEP_STEPS)).forEach(r => (r.jobs || []).forEach(j => { delete j.steps; }));
  fs.mkdirSync(P.history, { recursive: true });
  const tmp = FILE() + ".tmp";                      // write-then-rename: never a half file
  fs.writeFileSync(tmp, JSON.stringify(all));
  fs.renameSync(tmp, FILE());
}

/** All runs without step lists (small: used by the Dashboard and the Reports list). */
function list() {
  return load().map(r => Object.assign({}, r, {
    jobs: (r.jobs || []).map(j => { const c = Object.assign({}, j); delete c.steps; c.hasSteps = !!(j.steps && j.steps.length); return c; })
  }));
}

/** One run with everything (Reports tab). */
function get(id) { return load().find(r => String(r.id) === String(id)) || null; }

module.exports = { add, list, get };
