/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Run tab extras: tag quick-select, test suites, Excel data
   preview, and the "data used" panel next to live steps.
   Uses helpers from app.js: $, el, toast, modal, flows, queue,
   queueRows, renderAll, startRun, directSheets, countRows, hooks.
   ============================================================ */

/* ---------- Tags: one click selects every flow with that tag ---------- */
function renderTagBar() {
  var bar = $("tagbar");
  var counts = {};
  flows.forEach(function (f) { (f.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
  var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
  bar.innerHTML = "";
  if (!tags.length) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.appendChild(el("span", "qlbl", "Tags"));
  // Shared tags first; one-off tags stay behind "+ more" to keep this tidy
  var shown = showAllTags ? tags : tags.filter(function (t) { return counts[t] > 1; });
  if (!shown.length) shown = tags.slice(0, 6);
  shown.forEach(function (t) {
    var paths = flows.filter(function (f) { return (f.tags || []).indexOf(t) >= 0; })
                     .map(function (f) { return f.path; });
    var all = paths.every(function (p) { return queue.indexOf(p) >= 0; });
    var chip = el("button", "chip" + (all ? " on" : ""), t + " \u00b7 " + counts[t]);
    chip.title = all ? "Remove these flows from the queue" : "Add all '" + t + "' flows to the queue";
    chip.onclick = function () {
      paths.forEach(function (p) {
        var i = queue.indexOf(p);
        if (all && i >= 0) queue.splice(i, 1);
        if (!all && i < 0) queue.push(p);
      });
      renderAll(); renderTagBar();
    };
    bar.appendChild(chip);
  });
  if (tags.length > shown.length || showAllTags) {
    var more = el("button", "chip more", showAllTags ? "show less" : "+ " + (tags.length - shown.length) + " more");
    more.onclick = function () { showAllTags = !showAllTags; renderTagBar(); };
    bar.appendChild(more);
  }
}
var showAllTags = false;

/* ---------- Test suites ---------- */
var suites = [];

async function loadSuites() {
  try { suites = await (await fetch("/api/suites")).json(); } catch (e) { suites = []; }
  var sel = $("suiteSel"), prev = sel.value;
  sel.innerHTML = "";
  var first = document.createElement("option");
  first.value = ""; first.textContent = suites.length ? "Choose a test suite\u2026" : "No suites yet";
  sel.appendChild(first);
  suites.forEach(function (s) {
    var o = document.createElement("option");
    o.value = s.name;
    o.textContent = s.name + "  (" + s.items.length + " flow" + (s.items.length === 1 ? "" : "s") + ")";
    sel.appendChild(o);
  });
  if (prev) sel.value = prev;
}

function selectedSuite() {
  var name = $("suiteSel").value;
  var s = suites.filter(function (x) { return x.name === name; })[0];
  if (!s) toast("Choose a suite first.", "err");
  return s;
}

function applySuite(s) {
  var valid = flows.map(function (f) { return f.path; });
  var missing = s.items.filter(function (it) { return valid.indexOf(it.flow) < 0; });
  queue = []; queueRows = {};
  s.items.forEach(function (it) {
    if (valid.indexOf(it.flow) < 0) return;
    queue.push(it.flow);
    if (it.rows) queueRows[it.flow] = it.rows;
  });
  $("stopOnFail").checked = !!s.stopOnFail;
  renderAll(); renderTagBar();
  if (missing.length) toast(missing.length + " flow(s) in this suite no longer exist.", "err");
}

function suiteLoad() { var s = selectedSuite(); if (s) { applySuite(s); toast("Loaded suite \u201c" + s.name + "\u201d.", "ok"); } }

function suiteRun() {
  var s = selectedSuite(); if (!s) return;
  applySuite(s);
  startRun(queue.map(function (f) { return { flow: f, rows: queueRows[f] || "" }; }), s.name);
}

async function suiteSave() {
  if (!queue.length) { toast("Add flows to the queue first.", "err"); return; }
  var v = await modal({
    title: "Save queue as a test suite",
    text: queue.length + " flow(s) in this order, with their row selections and the stop-on-fail setting.",
    fields: [{ id: "name", label: "Suite name", value: $("suiteSel").value, placeholder: "e.g. Nightly smoke",
               list: suites.map(function (s) { return s.name; }), hint: "Using an existing name replaces that suite." }],
    ok: "Save suite",
    validate: function (x) { return x.name ? "" : "Enter a name."; }
  });
  if (!v) return;
  var r = await fetch("/api/suites/save", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: v.name, stopOnFail: $("stopOnFail").checked,
      items: queue.map(function (f) { return { flow: f, rows: queueRows[f] || "" }; }) })
  });
  var d = await r.json();
  if (!r.ok) { toast(d.error || "Could not save.", "err"); return; }
  await loadSuites(); $("suiteSel").value = v.name;
  toast("Suite saved.", "ok");
}

async function suiteDelete() {
  var s = selectedSuite(); if (!s) return;
  var ok = await modal({ title: "Delete suite \u201c" + s.name + "\u201d?", text: "Only the suite is deleted, not the flows.", ok: "Delete" });
  if (!ok) return;
  await fetch("/api/suites/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: s.name }) });
  $("suiteSel").value = "";
  loadSuites();
}

/* ---------- Excel data (cached per run / prepare) ---------- */
var dataCache = {};
async function sheetData(excel, sheet) {
  var key = excel + "/" + sheet;
  if (!dataCache[key]) {
    dataCache[key] = fetch("/api/data?excel=" + encodeURIComponent(excel) + "&sheet=" + encodeURIComponent(sheet))
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; });
  }
  return dataCache[key];
}

function selectedRowSet(spec, total) {
  spec = String(spec || "").trim().toLowerCase();
  var set = {};
  if (!spec) { set[1] = 1; return set; }
  if (spec === "all" || spec === "*") { for (var i = 1; i <= total; i++) set[i] = 1; return set; }
  spec.split(",").forEach(function (p) {
    var m = p.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return;
    for (var r = +m[1]; r <= +(m[2] || m[1]); r++) set[r] = 1;
  });
  return set;
}

// Big popup with the flow's sheet; the rows that will run are highlighted.
async function previewData(flow) {
  var sh = directSheets(flow)[0];
  if (!sh) return;
  var rows = await sheetData(sh.excel, sh.sheet);
  var picked = selectedRowSet(queueRows[flow], rows.length);
  var cols = [];
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });

  var ov = el("div", "overlay"), dlg = el("div", "dialog wide");
  dlg.appendChild(el("h3", "", sh.excel + " \u203a " + sh.sheet));
  var n = Object.keys(picked).length;
  dlg.appendChild(el("p", "dtext", rows.length + " rows \u00b7 " + n + " selected to run for " + flow +
    (rows.length ? "" : " (no data \u2014 run Prepare Data)")));
  var box = el("div", "previewbox");
  var t = document.createElement("table");
  var hr = document.createElement("tr");
  hr.appendChild(el("th", "", "Row"));
  cols.forEach(function (c) { hr.appendChild(el("th", "", c)); });
  t.appendChild(hr);
  rows.slice(0, 500).forEach(function (r, i) {
    var tr = document.createElement("tr");
    if (picked[i + 1]) tr.className = "picked";
    tr.appendChild(el("td", "rn", String(i + 1)));
    cols.forEach(function (c) { var td = el("td", "", r[c] == null ? "" : String(r[c])); td.title = td.textContent; tr.appendChild(td); });
    t.appendChild(tr);
  });
  box.appendChild(t);
  dlg.appendChild(box);
  var bar = el("div", "dbar");
  var close = el("button", "btn solid", "Close");
  bar.appendChild(close); dlg.appendChild(bar);
  ov.appendChild(dlg);
  function shut() { document.removeEventListener("keydown", onkey); ov.classList.remove("show"); setTimeout(function () { ov.remove(); }, 200); }
  function onkey(e) { if (e.key === "Escape") shut(); }
  close.onclick = shut;
  ov.onclick = function (e) { if (e.target === ov) shut(); };
  document.addEventListener("keydown", onkey);
  document.body.appendChild(ov);
  requestAnimationFrame(function () { ov.classList.add("show"); });
}

/* ---------- "Data used" panel beside the live steps ---------- */
async function renderLiveData(id) {
  var box = $("liveData");
  var info = jobInfo[id];
  box.innerHTML = "";
  if (!info) { box.appendChild(el("div", "empty", "No data information.")); return; }
  var sheets = directSheets(info.flow);
  if (!sheets.length || !info.row) { box.appendChild(el("div", "empty", "This flow does not use Excel data.")); return; }
  var sh = sheets[0];
  var rows = await sheetData(sh.excel, sh.sheet);
  if (live.shown !== id) return;                 // user switched meanwhile
  var row = rows[info.row - 1];
  box.appendChild(el("div", "dphead", "Row " + info.row + "  \u00b7  " + sh.excel + " \u203a " + sh.sheet));
  if (!row) { box.appendChild(el("div", "empty", "Row not found (data changed since the run?).")); return; }
  var t = document.createElement("table");
  Object.keys(row).forEach(function (k) {
    var tr = document.createElement("tr");
    tr.appendChild(el("td", "k", k));
    var v = el("td", "v", row[k] === "" ? "\u2014" : String(row[k]));
    v.title = v.textContent;
    tr.appendChild(v);
    t.appendChild(tr);
  });
  box.appendChild(t);
}

/* ---------- wire up ---------- */
hooks.flowsLoaded.push(renderTagBar);
hooks.flowsLoaded.push(function () { dataCache = {}; });   // re-prepared data -> fresh preview
hooks.showSteps.push(renderLiveData);
var _renderQueue = renderQueue;
renderQueue = function () { _renderQueue(); renderTagBar(); };  // keep chip state in sync
loadSuites();
