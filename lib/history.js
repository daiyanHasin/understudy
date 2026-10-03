/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Run history: every finished run is appended to History/history.json
 * (newest last, capped). Powers the Dashboard charts and run comparison.
 */

const fs   = require("fs");
const path = require("path");

const DIR  = path.join(__dirname, "..", "History");
const FILE = path.join(DIR, "history.json");
const MAX_RUNS = 300;

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (_) { return []; }
}

function add(run) {
  const all = load();
  all.push(run);
  while (all.length > MAX_RUNS) all.shift();
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + ".tmp";                      // write-then-rename: never a half file
  fs.writeFileSync(tmp, JSON.stringify(all));
  fs.renameSync(tmp, FILE);
}

function list() { return load(); }

module.exports = { add, list };
