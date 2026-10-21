/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Excel editor — unchanged from previous drop
   ============================================================ */
var xl = {
  loaded: false, files: [], file: null, sheets: [], active: 0,
  edits: {}, struct: {}, extra: {}, extraCols: {}
};

function colName(i) {
  var s = ""; i++;
  while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function editCount() {
  var n = 0;
  Object.keys(xl.edits).forEach(function (k) { n += Object.keys(xl.edits[k]).length; });
  Object.keys(xl.struct).forEach(function (k) { n += (xl.struct[k] || []).length; });
  return n;
}
function activeSheet() { return xl.sheets[xl.active]; }
function colCount() { var s = activeSheet(); return s && s.rows.length ? s.rows[0].length : 5; }

function shiftEdits(kind, at, delta) {
  var map = xl.edits[xl.active];
  if (!map) return;
  var next = {};
  Object.keys(map).forEach(function (k) {
    var p = k.split(",").map(Number);
    var r = p[0], c = p[1];
    if (kind === "row" && delta > 0 && r >= at) r += 1;
    if (kind === "row" && delta < 0 && r >  at) r -= 1;
    if (kind === "row" && delta < 0 && r === at) return;
    if (kind === "col" && delta > 0 && c >= at) c += 1;
    if (kind === "col" && delta < 0 && c >  at) c -= 1;
    if (kind === "col" && delta < 0 && c === at) return;
    next[r + "," + c] = map[k];
  });
  xl.edits[xl.active] = next;
}
function recordStruct(op, at) {
  if (!xl.struct[xl.active]) xl.struct[xl.active] = [];
  xl.struct[xl.active].push({ op: op, at: at });
}

async function loadExcelFiles() {
  try {
    var r = await fetch("/api/excel/files");
    var d = await r.json();
    xl.loaded = true;
    xl.files = d.files || [];
    $("xwarn").innerHTML = "";
    if (!d.lib) {
      $("xwarn").appendChild(el("div", "warn", "No Excel library found. Open a command prompt in the project folder and run: npm install exceljs"));
    }
    var box = $("xfiles");
    box.innerHTML = "";
    if (!xl.files.length) {
      box.appendChild(el("div", "empty", "No .xlsx files yet. Use New file to create one inside TestData/."));
      return;
    }
    var last = null;
    xl.files.forEach(function (f) {
      if (f.folder !== last) { box.appendChild(el("div", "folder", f.folder + "/")); last = f.folder; }
      var b = el("button", "xfile" + (xl.file === f.path ? " sel" : ""));
      b.appendChild(document.createTextNode(f.name));
      b.appendChild(el("small", "", Math.max(1, Math.round(f.size / 1024)) + " KB \u00B7 " + new Date(f.mtime).toLocaleString()));
      b.onclick = function () { openExcel(f.path); };
      box.appendChild(b);
    });
  } catch (e) { toast("Could not list Excel files.", "err"); }
}

async function openExcel(p) {
  if (editCount()) {
    var go = await modal({ title: "Discard changes?", text: "You have unsaved changes in " + xl.file + ".", ok: "Discard" });
    if (!go) return;
  }
  $("xstatus").textContent = "";
  var r = await fetch("/api/excel/read?file=" + encodeURIComponent(p));
  var d = await r.json();
  if (!r.ok) { toast(d.error || "Could not open the file", "err"); return; }
  xl.file = p; xl.sheets = d.sheets; xl.active = 0;
  xl.edits = {}; xl.struct = {}; xl.extra = {}; xl.extraCols = {};
  xl.sheets.forEach(function (s) {
    s.lockSet = {};
    (s.locked || []).forEach(function (x) { s.lockSet[x[0] + "," + x[1]] = 1; });
  });
  $("xtitle").textContent = p;
  loadExcelFiles();
  renderSheet();
}

function renderSheet() {
  var tabs = $("stabs"); tabs.innerHTML = "";
  xl.sheets.forEach(function (s, i) {
    var b = el("button", "stab" + (i === xl.active ? " active" : ""), s.name);
    b.onclick = function () { xl.active = i; renderSheet(); };
    tabs.appendChild(b);
  });
  var add = el("button", "stab add", "+ Add sheet");
  add.onclick = addSheet;
  tabs.appendChild(add);

  var s = activeSheet();
  if (!s) return;

  var meta = $("xmeta");
  if (s.truncated) {
    meta.hidden = false;
    meta.innerHTML = 'Showing the first ' + s.rows.length + ' rows (file is larger).';
  } else { meta.hidden = true; meta.textContent = ""; }

  if (!s.rows.length && !xl.extra[xl.active]) xl.extra[xl.active] = 1;
  var box = $("xtable");
  box.hidden = false; $("xactions").hidden = false; $("xhint").hidden = false;
  box.innerHTML = "";

  // Show only columns that hold data (the file's used range often extends
  // far past the real data), plus any column that has an unsaved edit.
  var nc = 0;
  s.rows.forEach(function (row) {
    for (var k = row.length - 1; k >= nc; k--) if (String(row[k]).trim() !== "") { nc = k + 1; break; }
  });
  if (!s.rows.length) nc = 5;
  if (nc < 1) nc = 1;
  xl.dataCols = nc;                               // columns that hold saved data
  nc += (xl.extraCols[xl.active] || 0);           // + blank columns added at the end
  Object.keys(xl.edits[xl.active] || {}).forEach(function (key) {
    nc = Math.max(nc, parseInt(key.split(",")[1], 10) + 1);   // never hide typed cells
  });
  var nr = s.rows.length + (xl.extra[xl.active] || 0);
  // One width per column, fitted to its longest value (10..40 characters)
  var colW = [];
  for (var cw = 0; cw < nc; cw++) {
    var longest = 0;
    s.rows.forEach(function (row) { longest = Math.max(longest, String(row[cw] == null ? "" : row[cw]).length); });
    colW.push(Math.min(40, Math.max(10, longest + 3)));
  }
  var ed = xl.edits[xl.active] || {};
  var t = document.createElement("table");

  var hr = document.createElement("tr");
  hr.appendChild(el("th", "", ""));
  for (var c = 0; c < nc; c++) {
    var th = el("th", "");
    th.appendChild(el("span", "colname", colName(c)));
    var cl = el("button", "colop", "+\u2190"); cl.title = "Insert column left of " + colName(c);
    cl.onclick = (function (cc) { return function () { insertColAt(cc); }; })(c);
    var cr = el("button", "colop", "+\u2192"); cr.title = "Insert column right of " + colName(c);
    cr.onclick = (function (cc) { return function () { insertColAt(cc + 1); }; })(c);
    var cdel = el("button", "colop", "\u2212"); cdel.title = "Delete column " + colName(c);
    cdel.onclick = (function (cc) { return function () { deleteColAt(cc); }; })(c);
    th.appendChild(cl); th.appendChild(cr); th.appendChild(cdel);
    hr.appendChild(th);
  }
  var thEnd = el("th", "");
  var cEndAdd = el("button", "colop", "+"); cEndAdd.title = "Add column at the end";
  cEndAdd.onclick = function () { addColEnd(); };
  thEnd.appendChild(cEndAdd);
  hr.appendChild(thEnd);
  t.appendChild(hr);

  for (var r = 0; r < nr; r++) {
    var tr = document.createElement("tr");
    var isPlaceholder = r >= s.rows.length;
    if (isPlaceholder) tr.className = "placeholder";
    else if (r === 0) tr.className = "hdr";
    var rn = el("td", "rn");
    rn.appendChild(el("span", "n", String(r + 1)));
    var rup = el("button", "rowop", "+\u2191"); rup.title = "Insert row above";
    rup.onclick = (function (rr) { return function () { insertRowAt(rr); }; })(r);
    var rdn = el("button", "rowop", "+\u2193"); rdn.title = "Insert row below";
    rdn.onclick = (function (rr) { return function () { insertRowAt(rr + 1); }; })(r);
    var rdel = el("button", "rowop", "\u2212"); rdel.title = "Delete this row";
    rdel.onclick = (function (rr, isPh) { return function () { deleteRowAt(rr, isPh); }; })(r, isPlaceholder);
    rn.appendChild(rup); rn.appendChild(rdn); rn.appendChild(rdel);
    tr.appendChild(rn);
    for (var c2 = 0; c2 < nc; c2++) {
      var key = r + "," + c2;
      var td = document.createElement("td");
      var inp = document.createElement("input");
      inp.type = "text";
      var orig = (s.rows[r] && s.rows[r][c2] !== undefined) ? s.rows[r][c2] : "";
      inp.value = ed[key] !== undefined ? ed[key] : orig;
      inp.style.width = colW[c2] + "ch";
      if (ed[key] !== undefined) inp.className = "mod";
      if (s.lockSet[key]) { inp.disabled = true; inp.title = "Formula or date cell (read-only)"; }
      inp.setAttribute("data-r", r);
      inp.setAttribute("data-c", c2);
      td.appendChild(inp);
      tr.appendChild(td);
    }
    t.appendChild(tr);
  }

  t.addEventListener("input", function (ev) {
    var i = ev.target;
    if (!i || i.tagName !== "INPUT") return;
    var rr = parseInt(i.getAttribute("data-r"), 10), cc = parseInt(i.getAttribute("data-c"), 10);
    var o = (s.rows[rr] && s.rows[rr][cc] !== undefined) ? s.rows[rr][cc] : "";
    if (!xl.edits[xl.active]) xl.edits[xl.active] = {};
    if (i.value === o) { delete xl.edits[xl.active][rr + "," + cc]; i.className = ""; }
    else { xl.edits[xl.active][rr + "," + cc] = i.value; i.className = "mod"; }
    var n = editCount();
    $("xstatus").textContent = n ? n + " unsaved change(s)" : "";
  });

  box.appendChild(t);
}

async function insertRowAt(r) {
  var s = activeSheet(); if (!s) return;
  if (r >= s.rows.length) { addRowEnd(); return; }          // below the last row
  s.rows.splice(r, 0, new Array(colCount()).fill(""));
  shiftEdits("row", r, +1); recordStruct("insertRow", r); renderSheet();
}
function addRowEnd() {
  xl.extra[xl.active] = (xl.extra[xl.active] || 0) + 1;
  renderSheet();
  var box = $("xtable"); box.scrollTop = box.scrollHeight;  // show the new row
}
async function deleteRowAt(r, isPlaceholder) {
  if (isPlaceholder) { xl.extra[xl.active] = Math.max(0, (xl.extra[xl.active] || 0) - 1); renderSheet(); return; }
  var go = await modal({ title: "Remove row " + (r + 1) + "?", text: "Applied when you click Save. A backup is kept.", ok: "Remove" });
  if (!go) return;
  activeSheet().rows.splice(r, 1);
  shiftEdits("row", r, -1); recordStruct("deleteRow", r); renderSheet();
}
async function insertColAt(c) {
  var s = activeSheet(); if (!s) return;
  if (c >= xl.dataCols) { addColEnd(); return; }             // right of the last data column
  s.rows.forEach(function (row) { row.splice(c, 0, ""); });
  shiftEdits("col", c, +1); recordStruct("insertCol", c); renderSheet();
}
// A blank column at the end needs no change in the file until you type in it,
// so it is only shown (it used to be hidden again because it was empty).
function addColEnd() {
  xl.extraCols[xl.active] = (xl.extraCols[xl.active] || 0) + 1;
  renderSheet();
  var box = $("xtable"); box.scrollLeft = box.scrollWidth;  // show the new column
}
async function deleteColAt(c) {
  if (c >= xl.dataCols) {                                    // a blank added column
    shiftEdits("col", c, -1);
    xl.extraCols[xl.active] = Math.max(0, (xl.extraCols[xl.active] || 0) - 1);
    renderSheet(); return;
  }
  var go = await modal({ title: "Remove column " + colName(c) + "?", text: "Applied when you click Save. A backup is kept.", ok: "Remove" });
  if (!go) return;
  activeSheet().rows.forEach(function (row) { row.splice(c, 1); });
  shiftEdits("col", c, -1); recordStruct("deleteCol", c); renderSheet();
}

function dirOf(p) { var i = p.lastIndexOf("/"); return i >= 0 ? p.slice(0, i) : ""; }

async function newFile() {
  var folders = [];
  xl.files.forEach(function (f) {
    if (f.folder !== "(project root)" && f.folder && folders.indexOf(f.folder) < 0) folders.push(f.folder);
  });
  var defaultFolder = xl.file ? dirOf(xl.file) : (folders[0] || "");
  var v = await modal({
    title: "New Excel file",
    text: "All files live under TestData/.",
    fields: [
      { id: "name", label: "File name", placeholder: "e.g. checkout-data" },
      { id: "folder", label: "Subfolder (inside TestData)", value: defaultFolder, list: folders, placeholder: "Leave empty to use TestData/ root" },
      { id: "sheet", label: "First sheet name", value: "Sheet1" },
      { id: "headers", label: "Column headers (optional)", placeholder: "username, password, expected" }
    ],
    ok: "Create file",
    validate: function (v) {
      if (!v.name) return "Please enter a file name.";
      if (!v.sheet) return "Please enter a sheet name.";
      return "";
    }
  });
  if (!v) return;
  try {
    var r = await fetch("/api/excel/newfile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Could not create the file", "err"); return; }
    toast("Created " + d.path, "ok");
    await loadExcelFiles(); openExcel(d.path);
  } catch (e) { toast("Could not create the file", "err"); }
}

async function addSheet() {
  if (!xl.file) { toast("Open an Excel file first.", "err"); return; }
  if (editCount()) { toast("Save your changes first, then add a sheet.", "err"); return; }
  var names = xl.sheets.map(function (s) { return s.name.toLowerCase(); });
  var v = await modal({
    title: "Add sheet", text: xl.file,
    fields: [
      { id: "name", label: "Sheet name", placeholder: "e.g. Checkout" },
      { id: "headers", label: "Column headers (optional)", placeholder: "username, password, expected" }
    ],
    ok: "Add sheet",
    validate: function (v) {
      if (!v.name) return "Please enter a sheet name.";
      if (v.name.length > 31) return "Sheet names can be at most 31 characters.";
      if (/[\[\]:*?\/\\]/.test(v.name)) return "Sheet names cannot contain  [ ] : * ? / \\";
      if (/^'|'$/.test(v.name)) return "Sheet names cannot start or end with an apostrophe.";
      if (names.indexOf(v.name.toLowerCase()) >= 0) return "A sheet with that name already exists.";
      return "";
    }
  });
  if (!v) return;
  try {
    var r = await fetch("/api/excel/newsheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: xl.file, name: v.name, headers: v.headers }) });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Could not add the sheet", "err"); return; }
    toast("Sheet added", "ok");
    var keep = xl.file; await openExcel(keep);
    xl.active = xl.sheets.length - 1; renderSheet();
  } catch (e) { toast("Could not add the sheet", "err"); }
}

async function saveExcel(thenPrepare) {
  var edits = [];
  Object.keys(xl.edits).forEach(function (si) {
    var name = xl.sheets[parseInt(si, 10)].name;
    Object.keys(xl.edits[si]).forEach(function (k) {
      var p = k.split(",");
      edits.push({ sheet: name, r: parseInt(p[0], 10), c: parseInt(p[1], 10), v: xl.edits[si][k] });
    });
  });
  var ops = [];
  Object.keys(xl.struct).forEach(function (si) {
    var name = xl.sheets[parseInt(si, 10)].name;
    (xl.struct[si] || []).forEach(function (o) { ops.push({ sheet: name, op: o.op, at: o.at }); });
  });
  if (!edits.length && !ops.length) {
    if (thenPrepare) { showTab("run"); prepareData(); }
    else { $("xstatus").textContent = "Nothing to save."; }
    return;
  }
  $("xstatus").textContent = "Saving\u2026";
  try {
    var r = await fetch("/api/excel/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: xl.file, edits: edits, ops: ops }) });
    var d = await r.json();
    if (!r.ok) { $("xstatus").textContent = ""; toast(d.error || "Save failed", "err"); return; }
  } catch (e) { $("xstatus").textContent = ""; toast("Save failed", "err"); return; }
  xl.struct = {}; xl.edits = {};   // saved: reload without the "Discard changes?" prompt
  var keep = xl.file, act = xl.active;
  await openExcel(keep); xl.active = act; renderSheet();
  $("xstatus").innerHTML = '<span class="badge pass">SAVED</span> Run Prepare Data to apply.';
  if (thenPrepare) { showTab("run"); prepareData(); }
}

