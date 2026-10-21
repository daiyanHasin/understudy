/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Test suites: named, ordered lists of { flow, rows } saved in Suites/suites.json.
 * Tag suites (smoke, regression, ...) are built on the fly from the flows' tags.
 */

const fs   = require("fs");
const path = require("path");

const P = require("../core/paths");
const DIR  = () => P.suites;
const FILE = () => path.join(P.suites, "suites.json");

function list() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    return Array.isArray(data) ? data : [];
  } catch (_) { return []; }
}

function write(all) {
  fs.mkdirSync(DIR(), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(all, null, 2));
}

function save(suite, validFlows) {
  const name = String(suite.name || "").trim();
  if (!name) throw new Error("Suite name is required");
  if (name.length > 60) throw new Error("Suite name is too long (max 60)");
  const items = (suite.items || [])
    .filter(it => it && validFlows.has(it.flow))
    .map(it => ({ flow: it.flow, rows: String(it.rows || "") }));
  if (!items.length) throw new Error("A suite needs at least one flow");
  const all = list().filter(s => s.name.toLowerCase() !== name.toLowerCase());
  all.push({ name, items, stopOnFail: !!suite.stopOnFail, updated: Date.now() });
  all.sort((a, b) => a.name.localeCompare(b.name));
  write(all);
}

function remove(name) {
  write(list().filter(s => s.name !== name));
}

module.exports = { list, save, remove };
