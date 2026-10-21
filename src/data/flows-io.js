/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Flow file I/O: read, save, duplicate, delete, rename, plus the small
 * YAML peek used to show appId next to each flow in the list.
 * Every write backs up into FlowBackups/ first.
 */

const fs   = require("fs");
const path = require("path");

const P = require("../core/paths");

/* ---------- Path safety: only files under Flows/ ---------- */
function resolveFlow(rel) {
  if (!rel) throw new Error("Flow path is required");
  let s = String(rel).replace(/\\/g, "/");
  s = s.replace(/^Flows\//i, "");           // tolerate "Flows/x.yaml"
  const full = path.resolve(P.flows, s);
  const root = P.flows + path.sep;
  if (!full.startsWith(root)) throw new Error("Flow must be inside Flows/");
  if (!/\.ya?ml$/i.test(full)) throw new Error("Only .yaml or .yml files");
  return full;
}

function resolveFlowForWrite(rel) {
  return resolveFlow(rel); // same rules; file may or may not exist for save
}

/* ---------- Read / save ---------- */
function readFlow(rel) {
  const full = resolveFlow(rel);
  if (!fs.existsSync(full)) throw new Error("Flow not found");
  return fs.readFileSync(full, "utf8");
}

function backupFlow(full) {
  fs.mkdirSync(P.flowBackups, { recursive: true });
  const rel = path.relative(P.flows, full).replace(/[\\/]/g, "__");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(full, path.join(P.flowBackups, rel + "." + stamp + ".bak"));
}

function saveFlow(rel, content) {
  if (typeof content !== "string") throw new Error("Content must be a string");
  const full = resolveFlowForWrite(rel);
  if (fs.existsSync(full)) backupFlow(full);
  else fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  return true;
}

/* ---------- Duplicate / delete / rename ---------- */
function sanitizeName(name) {
  const n = String(name || "").trim();
  if (!n) throw new Error("Name is required");
  if (!/^[A-Za-z0-9._\-/ ]+$/.test(n))
    throw new Error("Name can only contain letters, numbers, space, . _ - /");
  if (n.includes("..")) throw new Error("Name cannot contain ..");
  return n;
}

function withYamlExt(name) {
  return /\.ya?ml$/i.test(name) ? name : name + ".yaml";
}

function duplicateFlow(fromRel, toRel) {
  const from = resolveFlow(fromRel);
  if (!fs.existsSync(from)) throw new Error("Source flow not found");
  const to = resolveFlowForWrite(sanitizeName(withYamlExt(toRel)));
  if (fs.existsSync(to)) throw new Error("Target already exists");
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

function deleteFlow(rel) {
  const full = resolveFlow(rel);
  if (!fs.existsSync(full)) throw new Error("Flow not found");
  backupFlow(full);
  fs.unlinkSync(full);
  return true;
}

function renameFlow(fromRel, toRel) {
  const from = resolveFlow(fromRel);
  if (!fs.existsSync(from)) throw new Error("Source flow not found");
  const to = resolveFlowForWrite(sanitizeName(withYamlExt(toRel)));
  if (fs.existsSync(to)) throw new Error("Target already exists");
  backupFlow(from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  return true;
}

/* ---------- YAML peek: appId ---------- */
function peekAppId(rel) {
  try {
    const full = resolveFlow(rel);
    if (!fs.existsSync(full)) return null;
    // Read a small chunk so we don't load 100KB files for one field
    const buf = Buffer.alloc(4096);
    const fd  = fs.openSync(full, "r");
    const n   = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, n).toString("utf8");
    const m = head.match(/^\s*appId\s*:\s*([^\r\n#]+)/m);
    return m ? m[1].trim() : null;
  } catch (_) { return null; }
}

/* ---------- YAML peek: tags (properties.tags "a,b" or a tags: list) ---------- */
function peekTags(rel) {
  try {
    const full = resolveFlow(rel);
    const buf = Buffer.alloc(8192);
    const fd  = fs.openSync(full, "r");
    const n   = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, n).toString("utf8").split(/^---\s*$/m)[0];  // config part only
    const m = head.match(/^([ \t]*)tags:[ \t]*(.*)$/m);
    if (!m) return [];
    let items = [];
    if (m[2].trim()) {
      items = m[2].replace(/^[\["']+|[\]"']+$/g, "").split(",");
    } else {
      const after = head.slice(m.index + m[0].length).split(/\r?\n/);
      for (const line of after) {
        const li = line.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*$/);
        if (li) items.push(li[1]); else if (line.trim()) break;
      }
    }
    return [...new Set(items.map(t => t.trim().toLowerCase()).filter(Boolean))];
  } catch (_) { return []; }
}

module.exports = {
  peekTags,
  get FLOWS_DIR() { return P.flows; },
  resolveFlow,
  readFlow,
  saveFlow,
  duplicateFlow,
  deleteFlow,
  renameFlow,
  peekAppId
};