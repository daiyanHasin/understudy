/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * All Excel logic: scan, read, save, create, add sheet, insert/delete row/col.
 * Uses exceljs if available, falls back to xlsx.
 */

const fs = require("fs");
const path = require("path");

const P = require("../core/paths");
// Project folders are looked up on every call: the open project can change.

// Excel library (uses whichever is already installed)
let ExcelJS = null, XLSX = null;
try { ExcelJS = require("exceljs"); } catch (_) {}
if (!ExcelJS) { try { XLSX = require("xlsx"); } catch (_) {} }
const excelLib = () => (ExcelJS ? "exceljs" : XLSX ? "xlsx" : null);

/* ---------- Path safety ---------- */
const SKIP_DIRS = new Set(["node_modules", "Reports", "Scripts", "JsonData", "ExcelBackups", "Flows"]);

function scanExcel() {
  const out = [];
  const EXCEL_ROOT = P.testData, PROJECT_DIR = P.root;
  if (!fs.existsSync(EXCEL_ROOT)) fs.mkdirSync(EXCEL_ROOT, { recursive: true });
  (function walk(dir, depth) {
    if (depth > 5) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(full, depth + 1);
      } else if (/\.xlsx$/i.test(e.name) && !e.name.startsWith("~$")) {
        const st  = fs.statSync(full);
        const rel = path.relative(PROJECT_DIR, full).split(path.sep).join("/");
        const folder = path.dirname(rel) === "." ? "(project root)" : path.dirname(rel);
        out.push({ path: rel, name: e.name, folder, size: st.size, mtime: st.mtimeMs });
      }
    }
  })(EXCEL_ROOT, 0);
  return out.sort((a, b) => a.folder.localeCompare(b.folder) ||
                            a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// Only .xlsx inside TestData/ can be touched.
function resolveExcel(rel) {
  if (!rel) throw new Error("File path is required");
  let s = String(rel).replace(/\\/g, "/");
  if (!/^TestData(\/|$)/i.test(s)) s = "TestData/" + s;
  const EXCEL_ROOT = P.testData;
  const full = path.resolve(P.root, s);
  const root = EXCEL_ROOT + path.sep;
  if (full !== EXCEL_ROOT && !full.startsWith(root))
    throw new Error("File must be inside TestData/");
  if (!/\.xlsx$/i.test(full)) throw new Error("Only .xlsx files can be opened");
  if (full.split(path.sep).includes("node_modules")) throw new Error("Invalid file path");
  if (!fs.existsSync(full)) throw new Error("File not found");
  return full;
}

const NAME_RE = /^[\p{L}\p{N}_\-. ()]+$/u;

function resolveNewExcel(folder, name) {
  name = String(name || "").trim().replace(/\.xlsx$/i, "");
  if (!name || name.startsWith(".") || !NAME_RE.test(name))
    throw new Error("File name can only contain letters, numbers, spaces, - _ . ( )");
  const segs = ["TestData"];
  const sub = String(folder || "").replace(/\\/g, "/")
    .replace(/^TestData\/?/i, "")
    .split("/").map(x => x.trim()).filter(Boolean);
  for (const seg of sub) {
    if (seg === "." || seg === ".." || seg.startsWith(".") || !NAME_RE.test(seg) ||
        SKIP_DIRS.has(seg) || seg === "node_modules")
      throw new Error("That folder is not allowed: " + seg);
    segs.push(seg);
  }
  const dir  = path.join(P.root, ...segs);
  const full = path.join(dir, name + ".xlsx");
  if (!full.startsWith(P.root + path.sep)) throw new Error("Invalid folder");
  if (fs.existsSync(full)) throw new Error("A file with that name already exists in that folder.");
  return { dir, full };
}

/* ---------- Cell value helpers ---------- */
function exVal(v) {
  if (v === null || v === undefined) return { v: "", locked: false };
  if (v instanceof Date) return { v: v.toISOString().slice(0, 10), locked: true };
  if (typeof v === "object") {
    if (v.formula !== undefined || v.sharedFormula !== undefined) {
      const r = v.result;
      return {
        v: r === null || r === undefined ? "" :
           (typeof r === "object"
              ? (r instanceof Date ? r.toISOString().slice(0, 10) : String(r.error || ""))
              : String(r)),
        locked: true
      };
    }
    if (Array.isArray(v.richText)) return { v: v.richText.map(t => t.text).join(""), locked: false };
    if (v.text !== undefined) return {
      v: String(typeof v.text === "object" ? (v.text.richText || []).map(t => t.text).join("") : v.text),
      locked: false
    };
    if (v.error) return { v: String(v.error), locked: true };
    return { v: "", locked: true };
  }
  return { v: String(v), locked: false };
}

function coerce(orig, s) {
  if (s === "") return null;
  if (typeof orig === "number" && s.trim() !== "" && !isNaN(Number(s))) return Number(s);
  if (typeof orig === "boolean" && /^(true|false)$/i.test(s.trim())) return s.trim().toLowerCase() === "true";
  return s;
}

function friendlyWriteError(err) {
  if (err && (err.code === "EBUSY" || err.code === "EPERM" || err.code === "EACCES"))
    return new Error("Could not write the file. Close it in Excel and try again.");
  return err;
}

function backupFile(file) {
  fs.mkdirSync(P.excelBackups, { recursive: true });
  const rel = path.relative(P.testData, file).replace(/[\\/]/g, "__").replace(/\.xlsx$/i, "");
  fs.copyFileSync(file, path.join(P.excelBackups, rel + ".bak.xlsx"));
}

/* ---------- Sheet name rules ---------- */
function checkSheetName(name, existing) {
  name = String(name || "").trim();
  if (!name) throw new Error("Sheet name is required.");
  if (name.length > 31) throw new Error("Sheet names can be at most 31 characters.");
  if (/[\[\]:*?\/\\]/.test(name)) throw new Error("Sheet names cannot contain [ ] : * ? / \\");
  if (/^'|'$/.test(name)) throw new Error("Sheet names cannot start or end with an apostrophe.");
  if (existing.some(n => n.toLowerCase() === name.toLowerCase()))
    throw new Error("A sheet with that name already exists.");
  return name;
}

function parseHeaders(s) {
  return String(s || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 200);
}

/* ---------- Read ---------- */
const MAX_ROWS_PER_SHEET = 1000;

async function readExcel(file) {
  if (ExcelJS) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    return wb.worksheets.map(ws => {
      const rows = [], locked = [];
      const nr = Math.min(ws.rowCount, MAX_ROWS_PER_SHEET);
      const nc = ws.columnCount;
      for (let r = 1; r <= nr; r++) {
        const row = [];
        for (let c = 1; c <= nc; c++) {
          const x = exVal(ws.getCell(r, c).value);
          row.push(x.v);
          if (x.locked) locked.push([r - 1, c - 1]);
        }
        rows.push(row);
      }
      return { name: ws.name, rows, locked, truncated: ws.rowCount > MAX_ROWS_PER_SHEET };
    });
  }
  if (XLSX) {
    const wb = XLSX.readFile(file, { cellDates: true });
    return wb.SheetNames.map(name => {
      const ws = wb.Sheets[name];
      const rows = [], locked = [];
      let truncated = false;
      if (ws["!ref"]) {
        const rg = XLSX.utils.decode_range(ws["!ref"]);
        const lastR = Math.min(rg.e.r, MAX_ROWS_PER_SHEET - 1);
        truncated = rg.e.r > lastR;
        for (let r = 0; r <= lastR; r++) {
          const row = [];
          for (let c = 0; c <= rg.e.c; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            if (!cell) { row.push(""); continue; }
            if (cell.f || cell.v instanceof Date) locked.push([r, c]);
            row.push(cell.v instanceof Date
              ? cell.v.toISOString().slice(0, 10)
              : (cell.v === undefined || cell.v === null ? "" : String(cell.v)));
          }
          rows.push(row);
        }
      }
      return { name, rows, locked, truncated };
    });
  }
  throw new Error("No Excel library found. Run: npm install exceljs");
}

/* ---------- Save (cell edits + structural ops, one backup, one write) ---------- */
async function applyExcelChanges(file, ops, edits) {
  backupFile(file);
  try {
    if (ExcelJS) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file);

      for (const o of ops) {
        const ws = wb.getWorksheet(o.sheet);
        if (!ws) throw new Error("Sheet not found: " + o.sheet);
        if (o.op === "insertRow") ws.spliceRows(o.at + 1, 0, []);
        else if (o.op === "deleteRow") {
          if (o.at + 1 > ws.rowCount) throw new Error("Row does not exist.");
          ws.spliceRows(o.at + 1, 1);
        }
        else if (o.op === "insertCol") {
          const nr = ws.rowCount || 1;
          ws.spliceColumns(o.at + 1, 0, new Array(nr).fill(null));
        }
        else if (o.op === "deleteCol") ws.spliceColumns(o.at + 1, 1);
      }

      for (const e of edits) {
        const ws = wb.getWorksheet(e.sheet);
        if (!ws) throw new Error("Sheet not found: " + e.sheet);
        const cell = ws.getCell(e.r + 1, e.c + 1);
        const orig = cell.value;
        if (orig && typeof orig === "object" &&
            (orig.formula !== undefined || orig.sharedFormula !== undefined))
          throw new Error("Cell " + cell.address + " contains a formula and cannot be edited here.");
        if (orig instanceof Date)
          throw new Error("Cell " + cell.address + " is a date and cannot be edited here.");
        cell.value = coerce(orig, e.v);
      }
      await wb.xlsx.writeFile(file);
    } else if (XLSX) {
      const wb = XLSX.readFile(file, { cellStyles: true, cellDates: true });
      const aoaCache = {};
      const aoaFor = (name) => {
        if (!aoaCache[name]) {
          const ws = wb.Sheets[name];
          if (!ws) throw new Error("Sheet not found: " + name);
          aoaCache[name] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
        }
        return aoaCache[name];
      };
      for (const o of ops) {
        const aoa = aoaFor(o.sheet);
        if (o.op === "insertRow") {
          const nc = aoa.length ? Math.max(...aoa.map(r => r.length)) : 1;
          aoa.splice(o.at, 0, new Array(nc).fill(""));
        } else if (o.op === "deleteRow") {
          if (o.at >= aoa.length) throw new Error("Row does not exist.");
          aoa.splice(o.at, 1);
        } else if (o.op === "insertCol") {
          for (let r = 0; r < aoa.length; r++) {
            while (aoa[r].length <= o.at) aoa[r].push("");
            aoa[r].splice(o.at, 0, "");
          }
        } else if (o.op === "deleteCol") {
          for (let r = 0; r < aoa.length; r++) if (o.at < aoa[r].length) aoa[r].splice(o.at, 1);
        }
      }
      for (const e of edits) {
        const aoa = aoaFor(e.sheet);
        while (aoa.length <= e.r) aoa.push([]);
        const row = aoa[e.r];
        while (row.length <= e.c) row.push("");
        const orig = row[e.c];
        row[e.c] = e.v === "" ? "" : coerce(orig, e.v);
      }
      Object.keys(aoaCache).forEach(name => {
        wb.Sheets[name] = XLSX.utils.aoa_to_sheet(aoaCache[name].length ? aoaCache[name] : [[]]);
      });
      XLSX.writeFile(wb, file);
    } else {
      throw new Error("No Excel library found. Run: npm install exceljs");
    }
  } catch (err) { throw friendlyWriteError(err); }
}

/* ---------- Create / add sheet ---------- */
async function createExcel(dir, full, sheet, headers) {
  fs.mkdirSync(dir, { recursive: true });
  try {
    if (ExcelJS) {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(sheet);
      if (headers.length) {
        ws.columns = headers.map(h => ({ width: Math.max(14, h.length + 4) }));
        ws.addRow(headers).font = { bold: true };
      }
      await wb.xlsx.writeFile(full);
    } else if (XLSX) {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.aoa_to_sheet(headers.length ? [headers] : [[]]), sheet);
      XLSX.writeFile(wb, full);
    } else {
      throw new Error("No Excel library found. Run: npm install exceljs");
    }
  } catch (err) { throw friendlyWriteError(err); }
}

async function addSheetToExcel(file, name, headers) {
  backupFile(file);
  try {
    if (ExcelJS) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file);
      const sheet = checkSheetName(name, wb.worksheets.map(w => w.name));
      const ws = wb.addWorksheet(sheet);
      if (headers.length) {
        ws.columns = headers.map(h => ({ width: Math.max(14, h.length + 4) }));
        ws.addRow(headers).font = { bold: true };
      }
      await wb.xlsx.writeFile(file);
    } else if (XLSX) {
      const wb = XLSX.readFile(file, { cellStyles: true, cellDates: true });
      const sheet = checkSheetName(name, wb.SheetNames);
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.aoa_to_sheet(headers.length ? [headers] : [[]]), sheet);
      XLSX.writeFile(wb, file);
    } else {
      throw new Error("No Excel library found. Run: npm install exceljs");
    }
  } catch (err) { throw friendlyWriteError(err); }
}

module.exports = {
  get EXCEL_ROOT() { return P.testData; },
  excelLib,
  scanExcel,
  resolveExcel,
  resolveNewExcel,
  checkSheetName,
  parseHeaders,
  readExcel,
  applyExcelChanges,
  createExcel,
  addSheetToExcel
};