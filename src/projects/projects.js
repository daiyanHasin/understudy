/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Projects: install Understudy once, keep any number of projects.
 *
 * A project is an ordinary folder with Flows/, TestData/, Reports/ ... in it.
 * The list of known projects lives in the user's profile, NOT in the install
 * folder, so it survives updating or reinstalling Understudy:
 *     Windows:  %APPDATA%\Understudy\projects.json
 *     others:   ~/.understudy/projects.json
 *
 * Removing a project from the list never deletes its folder.
 * The install folder itself is registered as "Default project" the first time,
 * so setups from Understudy 1.0/1.1 keep working without moving anything.
 */

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const P    = require("../core/paths");

const CONFIG_DIR = process.env.APPDATA ? path.join(process.env.APPDATA, "Understudy")
                                        : path.join(os.homedir(), ".understudy");
const FILE = path.join(CONFIG_DIR, "projects.json");
const NAME_RE = /^[\p{L}\p{N} _\-.()]{1,60}$/u;
const SUBDIRS = ["Flows", "TestData", "Reports"];

function defaultHome() {
  const docs = path.join(os.homedir(), "Documents");
  return path.join(fs.existsSync(docs) ? docs : os.homedir(), "Understudy Projects");
}

function load() {
  let d = null;
  try { d = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (_) {}
  if (!d || !Array.isArray(d.projects)) d = { current: "", projects: [] };
  // First start (or old install): the install folder is the default project
  if (!d.projects.length) {
    d.projects.push({ name: "Default project", path: P.APP_DIR, created: Date.now(), lastOpened: Date.now() });
    d.current = P.APP_DIR;
  }
  d.projects = d.projects.filter(p => p && typeof p.path === "string" && typeof p.name === "string");
  return d;
}
function save(d) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, FILE);
}

function scaffold(dir, withExamples) {
  SUBDIRS.forEach(s => fs.mkdirSync(path.join(dir, s), { recursive: true }));
  const readme = path.join(dir, "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, "# " + path.basename(dir) + "\n\nAn Understudy project.\n\n" +
      "- `Flows/`     Maestro flows (.yaml)\n- `TestData/`  Excel test data\n- `Reports/`   test reports\n\n" +
      "Open it from Understudy: Projects menu (top left).\n");
  }
  if (withExamples) {
    const copy = (from, to) => {
      if (!fs.existsSync(from)) return;
      const st = fs.statSync(from);
      if (st.isDirectory()) { fs.mkdirSync(to, { recursive: true }); fs.readdirSync(from).forEach(f => copy(path.join(from, f), path.join(to, f))); }
      else if (!fs.existsSync(to)) fs.copyFileSync(from, to);
    };
    copy(path.join(P.APP_DIR, "Flows", "examples"), path.join(dir, "Flows", "examples"));
    copy(path.join(P.APP_DIR, "TestData", "ExampleData.xlsx"), path.join(dir, "TestData", "ExampleData.xlsx"));
  }
}

function describe(p, current) {
  let ok = false, flows = 0;
  try { ok = fs.statSync(p.path).isDirectory(); } catch (_) {}
  if (ok) {
    try {
      (function walk(d, depth) {
        if (depth > 4) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory() && !e.name.startsWith(".")) walk(path.join(d, e.name), depth + 1);
          else if (/\.ya?ml$/i.test(e.name) && !e.name.startsWith(".")) flows++;
        }
      })(path.join(p.path, "Flows"), 0);
    } catch (_) {}
  }
  return { name: p.name, path: p.path, current: path.resolve(p.path) === path.resolve(current),
           missing: !ok, flows, lastOpened: p.lastOpened || 0, isDefault: path.resolve(p.path) === path.resolve(P.APP_DIR) };
}

function list() {
  const d = load();
  return { current: d.current, home: defaultHome(),
           projects: d.projects.map(p => describe(p, d.current)).sort((a, b) => b.lastOpened - a.lastOpened) };
}

/** Called once at start: open the last project (or the install folder). */
function init(override) {
  const d = load();
  let dir = override || d.current || P.APP_DIR;
  try { if (!fs.statSync(dir).isDirectory()) dir = P.APP_DIR; } catch (_) { dir = P.APP_DIR; }
  P.setRoot(dir);
  if (!override) { d.current = dir; try { save(d); } catch (_) {} }
  return dir;
}

function open(dir) {
  const full = path.resolve(String(dir || ""));
  const d = load();
  const p = d.projects.find(x => path.resolve(x.path) === full);
  if (!p) throw new Error("That project is not in the list");
  if (!fs.existsSync(full)) throw new Error("The project folder no longer exists: " + full);
  SUBDIRS.forEach(s => fs.mkdirSync(path.join(full, s), { recursive: true }));
  p.lastOpened = Date.now();
  d.current = full;
  save(d);
  P.setRoot(full);
  return describe(p, full);
}

function create(name, folder, withExamples) {
  name = String(name || "").trim();
  if (!NAME_RE.test(name)) throw new Error("Project name: letters, numbers, spaces, - _ . ( ) (60 max)");
  const parent = path.resolve(String(folder || "").trim() || defaultHome());
  const dir = path.join(parent, name);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error("That folder already exists and is not empty. Use Add existing instead.");
  fs.mkdirSync(dir, { recursive: true });
  scaffold(dir, withExamples !== false);
  const d = load();
  d.projects = d.projects.filter(x => path.resolve(x.path) !== dir);
  d.projects.push({ name, path: dir, created: Date.now(), lastOpened: 0 });
  save(d);
  return open(dir);
}

function addExisting(folder, name) {
  const dir = path.resolve(String(folder || "").trim());
  if (!folder || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error("Folder not found: " + dir);
  const d = load();
  if (!d.projects.some(x => path.resolve(x.path) === dir)) {
    const nm = String(name || "").trim() || path.basename(dir);
    d.projects.push({ name: NAME_RE.test(nm) ? nm : "Project", path: dir, created: Date.now(), lastOpened: 0 });
    save(d);
  }
  return open(dir);
}

function rename(dir, name) {
  name = String(name || "").trim();
  if (!NAME_RE.test(name)) throw new Error("Project name: letters, numbers, spaces, - _ . ( ) (60 max)");
  const d = load();
  const p = d.projects.find(x => path.resolve(x.path) === path.resolve(String(dir)));
  if (!p) throw new Error("Project not found");
  p.name = name; save(d);
  return { ok: true };
}

function forget(dir) {
  const full = path.resolve(String(dir));
  const d = load();
  if (path.resolve(d.current) === full) throw new Error("Switch to another project before removing this one from the list");
  d.projects = d.projects.filter(x => path.resolve(x.path) !== full);
  save(d);
  return { ok: true };
}

module.exports = { list, init, open, create, addExisting, rename, forget, CONFIG_DIR, defaultHome };
