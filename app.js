/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Maestro Flow Runner — client
   ============================================================ */

var flows = [];           // [{ path, appId }]
var queue = [];           // ["sub/login.yaml", ...] paths only
var running = false, uid = 0;
var results = {}, resultOrder = [];
var currentReportUrl = null;
var lastFailed = [];      // [{ flow, row }] that failed in the last run
var queueRows = {};       // flow path -> row selection ("", "all", "2,7,13", "2-5")
var jobLabels = {};       // job id -> label shown in Results
var stepsByJob = {};      // job id -> [{ desc, status, t0, ms, depth }]
var live = { job: null, shown: null, start: 0, done: 0, total: 0, timer: null };
var jobInfo = {};         // job id -> { flow, row }
// Hooks filled in by ui/*.js (kept out of this file so it stays manageable)
var hooks = { flowsLoaded: [], showSteps: [], runDone: [], tab: [] };
function fire(name, arg) { (hooks[name] || []).forEach(function (fn) { try { fn(arg); } catch (e) { console.error(e); } }); }

function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function flowPaths() { return flows.map(function (f) { return f.path; }); }
function flowByPath(p) { for (var i = 0; i < flows.length; i++) if (flows[i].path === p) return flows[i]; return null; }

/* ---------- Theme ---------- */
function applyTheme(t) {
  if (t === "dark") document.documentElement.classList.add("theme-dark");
  else document.documentElement.classList.remove("theme-dark");
  var b = $("themeBtn");
  if (b) b.innerHTML = t === "dark" ? "&#9790;" : "&#9788;";
}
function toggleTheme() {
  var cur = document.documentElement.classList.contains("theme-dark") ? "dark" : "light";
  var next = cur === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next);
  applyTheme(next);
}
(function bootTheme() {
  var saved = localStorage.getItem("theme");
  if (!saved) saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(saved);
})();

/* ---------- Toast + modal ---------- */
function toast(msg, kind) {
  var t = el("div", "toast " + (kind || ""), msg);
  $("toasts").appendChild(t);
  requestAnimationFrame(function () { t.classList.add("show"); });
  setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 300); }, 4000);
}

function modal(opts) {
  return new Promise(function (resolve) {
    var ov = el("div", "overlay"), dlg = el("div", "dialog");
    dlg.appendChild(el("h3", "", opts.title));
    if (opts.text) dlg.appendChild(el("p", "dtext", opts.text));
    var inputs = {}, first = null;
    (opts.fields || []).forEach(function (f) {
      var wrap = el("label", "field");
      wrap.appendChild(el("span", "flabel", f.label));
      var i = document.createElement("input");
      i.type = "text"; i.value = f.value || ""; i.placeholder = f.placeholder || "";
      if (f.list && f.list.length) {
        var id = "dl" + (++uid);
        i.setAttribute("list", id);
        var dl = document.createElement("datalist"); dl.id = id;
        f.list.forEach(function (x) { var o = document.createElement("option"); o.value = x; dl.appendChild(o); });
        wrap.appendChild(dl);
      }
      wrap.appendChild(i);
      if (f.hint) wrap.appendChild(el("span", "fhint", f.hint));
      inputs[f.id] = i;
      if (!first) first = i;
      dlg.appendChild(wrap);
    });
    var err = el("div", "derr");
    dlg.appendChild(err);
    var bar = el("div", "dbar");
    var c = el("button", "btn", "Cancel");
    var o = el("button", "btn solid", opts.ok || "OK");
    bar.appendChild(c); bar.appendChild(o);
    dlg.appendChild(bar);
    ov.appendChild(dlg);

    function close(v) {
      document.removeEventListener("keydown", onkey);
      ov.classList.remove("show");
      setTimeout(function () { ov.remove(); }, 200);
      resolve(v);
    }
    function submit() {
      var v = {};
      Object.keys(inputs).forEach(function (k) { v[k] = inputs[k].value.trim(); });
      var m = opts.validate ? opts.validate(v) : "";
      if (m) { err.textContent = m; return; }
      close(v);
    }
    function onkey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(null); }
      if (e.key === "Enter" && document.activeElement && document.activeElement.tagName === "INPUT") {
        e.stopPropagation(); submit();
      }
    }
    c.onclick = function () { close(null); };
    o.onclick = submit;
    ov.onclick = function (e) { if (e.target === ov) close(null); };
    document.addEventListener("keydown", onkey);
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add("show"); if (first) first.focus(); else o.focus(); });
  });
}

function showTab(name) {
  ["run", "data", "editor", "dashboard"].forEach(function (t) {
    $("tab-" + t).hidden = (t !== name);
    $("tabbtn-" + t).className = "tab" + (t === name ? " active" : "");
  });
  if (name === "data" && !xl.loaded) loadExcelFiles();
  if (name === "editor") renderFlowEditorList();
  fire("tab", name);
  window.scrollTo(0, 0);
}

/* ---------- Flows and queue ---------- */
async function loadFlows() {
  try {
    var r = await fetch("/api/flows");
    flows = await r.json();
    if (!Array.isArray(flows)) flows = [];
    flows = flows.map(function (f) {
      return (typeof f === "string") ? { path: f, appId: null, sheets: [] } : f;
    });
  } catch (e) { toast("Could not load flows.", "err"); return; }
  var valid = flowPaths();
  queue = queue.filter(function (f) { return valid.indexOf(f) >= 0; });
  renderAll();
  renderFlowEditorList();
  fire("flowsLoaded");
}

function renderAll() { renderFlows(); renderQueue(); }

function toggle(f, on) { toggle2(f, on); renderQueue(); renderFlows(); }
function toggle2(f, on) {
  var i = queue.indexOf(f);
  if (on && i < 0) queue.push(f);
  if (!on && i >= 0) queue.splice(i, 1);
}

function visibleFlows() {
  var q = $("filter").value.trim().toLowerCase();
  return q ? flows.filter(function (f) { return f.path.toLowerCase().indexOf(q) >= 0; }) : flows;
}

function selAll(on) {
  var pool = visibleFlows();
  if (on) {
    pool.forEach(function (f) { if (queue.indexOf(f.path) < 0) queue.push(f.path); });
  } else {
    var paths = pool.map(function (f) { return f.path; });
    queue = queue.filter(function (f) { return paths.indexOf(f) < 0; });
  }
  renderAll();
}

function toggleFolder(list) {
  var all = list.every(function (f) { return queue.indexOf(f) >= 0; });
  list.forEach(function (f) { toggle2(f, !all); });
  renderAll();
}

function renderFlows() {
  var box = $("flows");
  box.innerHTML = "";
  var shown = visibleFlows();
  if (!shown.length) {
    box.appendChild(el("div", "empty", flows.length ? "No flows match the filter." : "No .yaml files found in Flows/"));
    return;
  }
  var groups = {}, order = [];
  shown.forEach(function (f) {
    var i = f.path.lastIndexOf("/");
    var g = i >= 0 ? f.path.slice(0, i) : "";
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(f);
  });
  order.forEach(function (g) {
    var list = groups[g];
    var h = el("div", "folder");
    h.appendChild(el("span", "", "Flows/" + g));
    var tb = el("button", "btn mini", "toggle");
    tb.disabled = running;
    tb.onclick = function () { toggleFolder(list.map(function (x) { return x.path; })); };
    h.appendChild(tb);
    box.appendChild(h);
    list.forEach(function (f) {
      var row = el("div", "flow");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = queue.indexOf(f.path) >= 0;
      cb.disabled = running;
      cb.onchange = function () { toggle(f.path, cb.checked); };
      var lb = el("label", "fname");
      lb.title = f.path + (f.appId ? "\nappId: " + f.appId : "");
      lb.appendChild(el("span", "fn", f.path.slice(f.path.lastIndexOf("/") + 1)));
      if (f.appId) lb.appendChild(el("small", "fapp", f.appId));
      lb.onclick = function () { cb.click(); };
      row.appendChild(cb);
      row.appendChild(lb);
      var pos = queue.indexOf(f.path);
      if (pos >= 0) row.appendChild(el("span", "pos", String(pos + 1)));
      box.appendChild(row);
    });
  });
}

function move(i, d) {
  var j = i + d;
  if (j < 0 || j >= queue.length) return;
  var t = queue[i]; queue[i] = queue[j]; queue[j] = t;
  renderAll();
}

function directSheets(f) {
  var fl = flowByPath(f);
  return (fl && fl.sheets ? fl.sheets : []).filter(function (x) { return !x.sub; });
}
function subSheets(f) {
  var fl = flowByPath(f);
  return (fl && fl.sheets ? fl.sheets : []).filter(function (x) { return x.sub; });
}

function renderQueue() {
  var box = $("queue");
  box.innerHTML = "";
  if (!queue.length) {
    box.appendChild(el("div", "empty", "Nothing selected yet. Tick flows on the left."));
    return;
  }
  queue.forEach(function (f, i) {
    var item = el("div", "qitem");
    var top = el("div", "qtop");
    top.appendChild(el("span", "n", String(i + 1)));
    var nm = el("span", "nm", f); nm.title = f;
    top.appendChild(nm);
    var runOne = el("button", "btn mini", "\u25B6");
    runOne.title = "Run this flow only (with its row selection)";
    runOne.disabled = running;
    runOne.onclick = function () { runFlows([f]); };
    var up = el("button", "btn mini", "\u25B2");
    var dn = el("button", "btn mini", "\u25BC");
    var rm = el("button", "btn mini", "\u2715");
    up.disabled = dn.disabled = rm.disabled = running;
    up.onclick = function () { move(i, -1); };
    dn.onclick = function () { move(i, 1); };
    rm.onclick = function () { toggle(f, false); };
    top.appendChild(runOne); top.appendChild(up); top.appendChild(dn); top.appendChild(rm);
    item.appendChild(top);

    var sheets = directSheets(f);
    var data = el("div", "qdata");
    if (!sheets.length) {
      data.appendChild(el("span", "qinfo", "No Excel data \u00b7 runs once"));
    } else {
      var total = sheets[0].rows;
      data.appendChild(el("span", "qlbl", "Rows"));
      var inp = document.createElement("input");
      inp.type = "text"; inp.className = "rowsel";
      inp.value = queueRows[f] || "";
      inp.placeholder = "1";
      inp.disabled = running;
      inp.title = "Examples: 1   all   2,7,13   2-5   1,4-6";
      inp.oninput = function () { queueRows[f] = inp.value; updateRowCount(f, inp, cnt, total); };
      data.appendChild(inp);
      ["1", "all"].forEach(function (v) {
        var b = el("button", "btn mini", v === "all" ? "All" : "Row 1");
        b.disabled = running;
        b.onclick = function () { queueRows[f] = v === "1" ? "" : "all"; renderQueue(); };
        data.appendChild(b);
      });
      var cnt = el("span", "qinfo");
      data.appendChild(cnt);
      var pv = el("button", "btn mini", "Preview data");
      pv.title = "Show this flow's Excel rows";
      pv.onclick = function () { if (window.previewData) previewData(f); };
      data.appendChild(pv);
      updateRowCount(f, inp, cnt, total);
      var names = sheets.map(function (x) { return x.excel + " \u203a " + x.sheet; }).join(", ");
      var src = el("div", "qsrc", names + " (" + (total || "?") + " rows)");
      var subs = subSheets(f);
      if (subs.length) src.textContent += "  \u00b7  sub-flows use " +
        subs.map(function (x) { return x.sheet; }).join(", ") + " row 1";
      item.appendChild(data);
      item.appendChild(src);
      box.appendChild(item);
      return;
    }
    item.appendChild(data);
    box.appendChild(item);
  });
}

// Client-side preview of the row selection; the server validates again.
function countRows(spec, total) {
  spec = String(spec || "").trim().toLowerCase();
  if (!spec) return { n: 1 };
  if (spec === "all" || spec === "*") return total ? { n: total } : { err: "run Prepare Data first" };
  var seen = {}, n = 0, parts = spec.split(",");
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim(); if (!p) continue;
    var m = p.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return { err: "\u201c" + p + "\u201d isn\u2019t a row or range" };
    var a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b < a) return { err: "\u201c" + p + "\u201d isn\u2019t a valid range" };
    if (total && b > total) return { err: "row " + b + " doesn\u2019t exist" };
    for (var r = a; r <= b; r++) if (!seen[r]) { seen[r] = 1; n++; }
  }
  return n ? { n: n } : { err: "no rows" };
}
function updateRowCount(f, inp, cnt, total) {
  var c = countRows(inp.value, total);
  inp.classList.toggle("bad", !!c.err);
  cnt.className = "qinfo" + (c.err ? " bad" : "");
  cnt.textContent = c.err ? c.err : (c.n === 1 ? "1 run" : c.n + " runs");
}

function setRunning(b) {
  running = b;
  $("runBtn").disabled = b;
  $("runAllBtn").disabled = b;
  $("prepBtn").disabled = b;
  $("saveBtn").disabled = b;
  $("savePrepBtn").disabled = b;
  $("stopBtn").disabled = !b;
  $("rerunBtn").disabled = b || !lastFailed.length;
  $("edSave").disabled = b || !edDirty();
  $("edRevert").disabled = b || !edDirty();
  $("edRun").disabled = b || !ed.current;
  renderAll();
  renderFlowEditorList();
}

/* ---------- Results ---------- */
function renderResults() {
  var box = $("results");
  box.innerHTML = "";
  if (!resultOrder.length) { box.appendChild(el("div", "empty", "No runs yet.")); return; }
  resultOrder.forEach(function (id) {
    var r = results[id] || { status: "pending" };
    var row = el("div", "res");
    row.appendChild(el("span", "nm", jobLabels[id] || id));
    var labels = { pending: "WAITING", running: "RUNNING", pass: "PASSED", fail: "FAILED", skipped: "SKIPPED", stopped: "STOPPED" };
    row.appendChild(el("span", "badge " + r.status, labels[r.status] || r.status));
    if (r.duration) row.appendChild(el("span", "dur", fmtDur(r.duration)));
    if (stepsByJob[id] && stepsByJob[id].length) {
      var sb = el("button", "btn mini", "Steps");
      sb.onclick = function () {
        showSteps(id);
        $("liveCard").scrollIntoView({ behavior: "smooth", block: "center" });
      };
      row.appendChild(sb);
    }
    if (r.screenshot) {
      var im = document.createElement("img");
      im.className = "shot"; im.src = r.screenshot; im.title = "Screen at failure (click to enlarge)";
      im.onclick = function () { window.open(r.screenshot, "_blank"); };
      row.appendChild(im);
    }
    if (r.reportName) {
      var b = el("button", "btn mini", "View report");
      b.onclick = function () {
        showReport(r.reportName);
        $("reportFrame").scrollIntoView({ behavior: "smooth", block: "center" });
      };
      row.appendChild(b);
    }
    box.appendChild(row);
  });
}

function applyResult(r) {
  var s = r.skipped ? "skipped" : (r.stopped ? "stopped" : (r.ok ? "pass" : "fail"));
  results[r.id] = { status: s, reportName: r.reportName || null,
                    duration: r.duration || 0, screenshot: r.screenshot || null };
}

function summarize() {
  var p = 0, f = 0;
  resultOrder.forEach(function (n) {
    var s = results[n] && results[n].status;
    if (s === "pass") p++;
    if (s === "fail") f++;
  });
  return { p: p, f: f };
}

/* ---------- Actions ---------- */
async function prepareData() {
  $("log").textContent = "";
  setRunning(true);
  $("status").textContent = "Preparing data\u2026";
  try {
    var r = await fetch("/api/setup", { method: "POST" });
    var result = await r.json();
    if (r.status === 409) { toast("Something is already running.", "err"); $("status").textContent = ""; }
    else $("status").innerHTML = '<span class="badge ' + (result.ok ? "pass" : "fail") + '">' + (result.ok ? "DATA READY" : "SETUP FAILED") + "</span>";
    loadFlows();   // refresh row counts shown in the queue
  } catch (e) {
    $("status").innerHTML = '<span class="badge fail">ERROR</span>';
  }
  setRunning(false);
}

function runSelected() { runFlows(queue.slice()); }

async function runAll() {
  if (!flows.length) { toast("No flows found.", "err"); return; }
  var ok = await modal({ title: "Run all flows?", text: "All " + flows.length + " flows will run in the listed order, one report each.", ok: "Run all" });
  if (!ok) return;
  queue = flowPaths();
  renderAll();
  runFlows(queue.slice());
}

function rerunFailed() {
  if (!lastFailed.length) { toast("No failed flows to rerun.", "err"); return; }
  // Rerun exactly the failed (flow, row) pairs
  var byFlow = {}, order = [];
  lastFailed.forEach(function (x) {
    if (!byFlow[x.flow]) { byFlow[x.flow] = []; order.push(x.flow); }
    if (x.row) byFlow[x.flow].push(x.row);
  });
  startRun(order.map(function (f) { return { flow: f, rows: byFlow[f].join(",") }; }));
}

// Run flows using the row selection set for each one in the queue.
function runFlows(list) {
  startRun(list.map(function (f) { return { flow: f, rows: queueRows[f] || "" }; }));
}

async function startRun(items, suiteName) {
  if (!items.length) { toast("Select at least one flow first.", "err"); return; }
  $("log").textContent = "";
  setRunning(true);
  $("status").textContent = "Starting\u2026";
  try {
    var r = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items, stopOnFail: $("stopOnFail").checked, suite: suiteName || null })
    });
    if (r.status === 409) {
      toast("Something is already running.", "err");
      $("status").textContent = "";
      setRunning(false);
      return;
    }
    if (!r.ok) {
      var err = await r.json().catch(function () { return {}; });
      toast(err.error || "Could not start the run.", "err");
      $("status").textContent = "";
      setRunning(false);
      return;
    }
    lastFailed = [];
  } catch (e) {
    toast("Could not reach the server.", "err");
    setRunning(false);
  }
}

async function stopRun() {
  $("stopBtn").disabled = true;
  try { await fetch("/api/stop", { method: "POST" }); } catch (e) {}
}

async function openFolder(kind) {
  try {
    var r = await fetch("/api/open-folder", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: kind })
    });
    if (!r.ok) { var d = await r.json().catch(function () { return {}; }); toast(d.error || "Could not open folder", "err"); }
  } catch (e) { toast("Could not open folder", "err"); }
}

function copyLog() {
  var txt = $("log").textContent || "";
  if (!txt.trim()) { toast("Log is empty.", "err"); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(function () { toast("Log copied.", "ok"); }, function () { fallbackCopy(txt); });
  } else fallbackCopy(txt);
}
function fallbackCopy(txt) {
  var ta = document.createElement("textarea");
  ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); toast("Log copied.", "ok"); }
  catch (e) { toast("Copy failed.", "err"); }
  ta.remove();
}
function clearLog() { $("log").textContent = ""; }

/* ---------- Reports ---------- */
async function loadReports() {
  try {
    var r = await fetch("/api/reports");
    var names = await r.json();
    var sel = $("reportSelect");
    var prev = sel.value;
    sel.innerHTML = "";
    var first = document.createElement("option");
    first.value = "";
    first.textContent = names.length ? "Select a report" : "No reports yet";
    sel.appendChild(first);
    names.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    });
    if (prev && names.indexOf(prev) >= 0) sel.value = prev;
  } catch (e) {}
}

function showReport(name) {
  if (!name) return;
  currentReportUrl = "/reports/" + encodeURIComponent(name);
  $("reportFrame").src = currentReportUrl + "?t=" + Date.now();
  var sel = $("reportSelect");
  if (!Array.prototype.some.call(sel.options, function (o) { return o.value === name; })) {
    var o = document.createElement("option");
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  }
  sel.value = name;
}

function openReport() {
  if (currentReportUrl) window.open(currentReportUrl, "_blank");
  else toast("Run a flow or pick a report first.", "err");
}

function appendLog(text) {
  var e = $("log");
  e.textContent += text;
  e.scrollTop = e.scrollHeight;
}

/* ---------- Live run panel ---------- */
function fmtDur(ms) {
  var sec = Math.round(ms / 1000);
  if (sec < 60) return sec + "s";
  var m = Math.floor(sec / 60), r = sec % 60;
  return m + "m " + (r < 10 ? "0" : "") + r + "s";
}
function liveStart(total) {
  stepsByJob = {};
  live.start = Date.now(); live.done = 0; live.total = total; live.job = null;
  clearInterval(live.timer);
  live.timer = setInterval(liveProgress, 1000);
  $("liveCard").classList.add("active");
  $("steps").innerHTML = "";
  liveProgress();
  $("liveCard").scrollIntoView({ behavior: "smooth", block: "start" });
}
function liveProgress() {
  var s = summarize();
  $("pfill").style.width = (live.total ? Math.round(100 * live.done / live.total) : 0) + "%";
  $("pfill").className = s.f ? "bad" : "";
  $("liveStats").innerHTML = "";
  [[live.done + " / " + live.total + " runs", ""], [s.p + " passed", "ok"], [s.f + " failed", s.f ? "bad" : ""],
   [fmtDur(Date.now() - live.start), ""]].forEach(function (x) {
    $("liveStats").appendChild(el("span", "stat " + x[1], x[0]));
  });
}
function liveFinish(d) {
  clearInterval(live.timer);
  liveProgress();
  $("liveCard").classList.remove("active");
  // After the run, open the first failure so you see where it broke
  var firstFail = (d.results || []).filter(function (r) { return !r.ok && !r.skipped && !r.stopped; })[0];
  if (firstFail && stepsByJob[firstFail.id]) showSteps(firstFail.id);
  var what = d.error ? "Stopped with an error" :
    "Finished \u2014 " + (d.failed ? d.failed + " failed" : "all passed");
  $("liveTitle").textContent = what + (firstFail ? "  \u00b7  showing " + (jobLabels[firstFail.id] || firstFail.id) : "");
}
function addStep(d) {
  var list = stepsByJob[d.id] || (stepsByJob[d.id] = []);
  if (d.status === "RUNNING") {
    // steps still running are parents (e.g. "Run flow Login.yaml"): indent children
    var depth = list.filter(function (x) { return x.status === "RUNNING"; }).length;
    list.push({ desc: d.desc, status: "RUNNING", t0: d.ts != null ? d.ts : Date.now(), useTs: d.ts != null, depth: depth });
  } else {
    var hit = null;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].desc === d.desc && list[i].status === "RUNNING") { hit = list[i]; break; }
    }
    if (hit) {
      hit.status = d.status;
      // prefer Maestro's own log timestamps; fall back to browser time
      hit.ms = (hit.useTs && d.ts != null) ? Math.max(0, d.ts - hit.t0) : Date.now() - hit.t0;
    }
    else list.push({ desc: d.desc, status: d.status, depth: 0 });
  }
  if (live.shown === d.id) showSteps(d.id);
}
function showSteps(id) {
  live.shown = id;
  fire("showSteps", id);
  var list = stepsByJob[id] || [];
  var running = (id === live.job && results[id] && results[id].status === "running");
  $("liveTitle").textContent = (running ? "Running: " : "Steps: ") + (jobLabels[id] || id);
  var box = $("steps");
  box.innerHTML = "";
  if (!list.length) {
    box.appendChild(el("div", "empty", running ? "Starting Maestro and connecting to the device\u2026" : "No step information for this run."));
    return;
  }
  var icons = { RUNNING: "", COMPLETED: "\u2713", FAILED: "\u2717", SKIPPED: "\u21B7", WARNED: "!" };
  list.forEach(function (st, i) {
    var row = el("div", "step " + st.status.toLowerCase());
    row.style.paddingLeft = (10 + st.depth * 18) + "px";
    row.appendChild(el("span", "sn", String(i + 1)));
    row.appendChild(el("span", "si", icons[st.status] || ""));
    row.appendChild(el("span", "sd", st.desc));
    if (st.ms != null) row.appendChild(el("span", "st", st.ms < 1000 ? st.ms + "ms" : (st.ms / 1000).toFixed(1) + "s"));
    box.appendChild(row);
  });
  var failed = box.querySelector(".step.failed");
  var cur = (failed && !running) ? failed : box.lastChild;
  box.scrollTop = cur.offsetTop - box.clientHeight / 2;
}

/* ---------- SSE ---------- */
var es = new EventSource("/api/stream");
es.onmessage = function (e) {
  var d;
  try { d = JSON.parse(e.data); } catch (_) { return; }
  if (d.type === "log") appendLog(d.text);
  else if (d.type === "queue") {
    results = {}; jobLabels = {};
    resultOrder = d.jobs.map(function (j) { jobLabels[j.id] = j.label; jobInfo[j.id] = { flow: j.flow, row: j.row }; return j.id; });
    renderResults();
    liveStart(d.jobs.length);
  }
  else if (d.type === "start") {
    results[d.id] = { status: "running" };
    stepsByJob[d.id] = [];
    live.job = d.id;
    showSteps(d.id);
    $("status").textContent = "Running " + (d.index + 1) + " of " + d.total + ": " + d.label;
    renderResults();
  } else if (d.type === "step") { addStep(d); }
  else if (d.type === "result") {
    applyResult(d); renderResults();
    live.done++;
    // anything still "running" when the flow ended did not finish
    (stepsByJob[d.id] || []).forEach(function (st) { if (st.status === "RUNNING") st.status = d.ok ? "COMPLETED" : "FAILED"; });
    if (live.shown === d.id) showSteps(d.id);
    liveProgress();
  }
  else if (d.type === "skipped") { results[d.id] = { status: "skipped" }; renderResults(); }
  else if (d.type === "done") {
    if (d.results) {
      d.results.forEach(applyResult);
      lastFailed = d.results.filter(function (r) { return !r.ok && !r.skipped && !r.stopped; })
                            .map(function (r) { return { flow: r.flow, row: r.row }; });
      renderResults();
    }
    var s = summarize();
    var label = d.error ? "ERROR" : (s.p + " PASSED, " + s.f + " FAILED");
    var cls = d.error || s.f > 0 ? "fail" : "pass";
    $("status").innerHTML = '<span class="badge ' + cls + '">' + label + "</span>";
    setRunning(false);
    loadReports();
    liveFinish(d);
    fire("runDone", d);
  }
};
es.onerror = function () {
  if (es.readyState === EventSource.CLOSED) {
    appendLog("\n[stream closed]\n");
    toast("Lost connection to the runner. Reload the page.", "err");
  }
};

window.addEventListener("beforeunload", function (e) {
  var dirtyExcel = (typeof xl !== "undefined" && xl.loaded && editCount());
  var dirtyFlow  = edDirty();
  if (dirtyExcel || dirtyFlow) { e.preventDefault(); e.returnValue = ""; }
});

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

/* ============================================================
   Flow Editor tab
   ============================================================ */
var ed = {
  current: null,     // path
  orig: "",          // server content at open
  val: "",           // current textarea value
  cm: null,          // CodeMirror view if upgraded
  cmTried: false
};

function edDirty() { return !!ed.current && ed.val !== ed.orig; }

function renderFlowEditorList() {
  var box = $("edList");
  if (!box) return;
  box.innerHTML = "";
  if (!flows.length) {
    box.appendChild(el("div", "empty", "No flows found."));
    return;
  }
  var q = ($("edFilter").value || "").trim().toLowerCase();
  var shown = q ? flows.filter(function (f) { return f.path.toLowerCase().indexOf(q) >= 0; }) : flows;
  if (!shown.length) { box.appendChild(el("div", "empty", "No flows match the filter.")); return; }

  var groups = {}, order = [];
  shown.forEach(function (f) {
    var i = f.path.lastIndexOf("/");
    var g = i >= 0 ? f.path.slice(0, i) : "";
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(f);
  });

  order.forEach(function (g) {
    var list = groups[g];
    box.appendChild(el("div", "folder", "Flows/" + g));
    list.forEach(function (f) {
      var row = el("div", "flow");
      if (ed.current === f.path) row.className += " sel";
      var nm = el("div", "fname");
      nm.title = f.path + (f.appId ? "\nappId: " + f.appId : "");
      nm.appendChild(el("span", "fn", f.path.slice(f.path.lastIndexOf("/") + 1)));
      if (f.appId) nm.appendChild(el("small", "fapp", f.appId));
      nm.onclick = function () { openFlowForEdit(f.path); };
      row.appendChild(nm);
      var acts = el("div", "flowacts");
      var dup = el("button", "btn mini", "\u29C9"); dup.title = "Duplicate";
      dup.onclick = function () { duplicateFlowDialog(f.path); };
      var ren = el("button", "btn mini", "\u270E"); ren.title = "Rename";
      ren.onclick = function () { renameFlowDialog(f.path); };
      var del = el("button", "btn mini", "\u2715"); del.title = "Delete";
      del.onclick = function () { deleteFlowDialog(f.path); };
      acts.appendChild(dup); acts.appendChild(ren); acts.appendChild(del);
      row.appendChild(acts);
      box.appendChild(row);
    });
  });
}

async function openFlowForEdit(p) {
  if (edDirty()) {
    var go = await modal({ title: "Discard changes?", text: "You have unsaved changes in " + ed.current + ".", ok: "Discard" });
    if (!go) return;
  }
  var r = await fetch("/api/flow/read?path=" + encodeURIComponent(p));
  var d = await r.json();
  if (!r.ok) { toast(d.error || "Could not read flow", "err"); return; }
  ed.current = d.path;
  ed.orig = d.content;
  ed.val = d.content;
  $("edTitle").textContent = p;
  renderFlowEditorList();
  $("edWrap").hidden = false;
  $("edHint").hidden = false;
  var meta = $("edMeta");
  var f = flowByPath(p);
  meta.hidden = !(f && f.appId);
  if (f && f.appId) meta.textContent = "appId: " + f.appId;
  mountEditor();
}

/* Try CodeMirror once. If offline, fall back to textarea silently. */
function mountEditor() {
  var area = $("edArea");
  if (!area) return;
  // Always keep the textarea as the source of truth
  area.value = ed.val;
  if (ed.cm) { ed.cm.destroy(); ed.cm = null; }
  updateEditorButtons();

  if (ed.cmTried) return;
  ed.cmTried = true;

  // Fire-and-forget: try to load CodeMirror 6 from CDN; silently give up on failure.
  tryLoadCodeMirror().then(function (ok) {
    if (!ok) return; // offline -> plain textarea is fine
    // Re-enter: hide textarea, mount CM
    mountCodeMirror();
  }).catch(function () {});
}

async function tryLoadCodeMirror() {
  // Quick reachability probe with a timeout so we don't hang on a dead network.
  return new Promise(function (resolve) {
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; resolve(false); } }, 1500);
    var img = new Image();
    img.onload = img.onerror = function () {
      if (done) return;
      done = true; clearTimeout(t);
      resolve(true); // any response (even error) means we're online enough
    };
    // tiny transparent GIF from jsdelivr
    img.src = "https://cdn.jsdelivr.net/npm/codemirror@6.0.1/package.json?probe=" + Date.now();
  });
}

function mountCodeMirror() {
  // CodeMirror 6 via esm.sh as a single ESM bundle. If this fails, textarea stays.
  var area = $("edArea");
  import("https://esm.sh/codemirror@6.0.1")
    .then(function (CM) {
      import("https://esm.sh/@codemirror/lang-yaml@6.0.0")
        .then(function (YAML) {
          try {
            area.style.display = "none";
            var parent = area.parentElement;
            var host = document.createElement("div");
            host.style.minHeight = "480px";
            parent.appendChild(host);
            ed.cm = new CM.EditorView({
              doc: ed.val,
              extensions: [
                CM.basicSetup,
                YAML.yaml(),
                CM.EditorView.lineWrapping,
                CM.EditorView.updateListener.of(function (u) {
                  if (u.docChanged) {
                    ed.val = u.state.doc.toString();
                    updateEditorButtons();
                  }
                })
              ],
              parent: host
            });
            updateEditorButtons();
          } catch (e) { area.style.display = ""; }
        })
        .catch(function () {});
    })
    .catch(function () {});
}

function updateEditorButtons() {
  var dirty = edDirty();
  $("edSave").disabled = running || !dirty;
  $("edRevert").disabled = running || !dirty;
  $("edRun").disabled = running || !ed.current;
  var w = $("edWrap");
  if (w) w.className = "editorbox" + (dirty ? " dirty" : "");
  var t = $("edTitle");
  if (t && ed.current) t.textContent = ed.current + (dirty ? " *" : "");
}

/* Keep textarea edits synced */
document.addEventListener("input", function (e) {
  if (e.target && e.target.id === "edArea") {
    ed.val = e.target.value;
    updateEditorButtons();
  }
});

async function saveFlow() {
  if (!ed.current || !edDirty()) return;
  try {
    var r = await fetch("/api/flow/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ed.current, content: ed.val })
    });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Save failed", "err"); return; }
    ed.orig = ed.val;
    toast("Saved " + ed.current, "ok");
    updateEditorButtons();
    loadFlows();
  } catch (e) { toast("Save failed", "err"); }
}

async function revertFlow() {
  if (!ed.current || !edDirty()) return;
  var go = await modal({ title: "Revert changes?", text: "Discard unsaved changes to " + ed.current + "?", ok: "Revert" });
  if (!go) return;
  ed.val = ed.orig;
  if (ed.cm) { ed.cm.destroy(); ed.cm = null; }
  var area = $("edArea");
  area.style.display = "";
  // remove CM host if any
  var host = area.parentElement.querySelector("div[style*='min-height']");
  if (host) host.remove();
  area.value = ed.val;
  ed.cmTried = false; // allow re-mount
  mountEditor();
}

function runCurrentFlow() {
  if (!ed.current) return;
  showTab("run");
  runFlows([ed.current]);
}

async function newFlowDialog() {
  var v = await modal({
    title: "New flow",
    text: "Creates a minimal Maestro YAML. Fill appId and steps.",
    fields: [
      { id: "path", label: "Flow path (inside Flows/)", placeholder: "sub/my-flow.yaml" },
      { id: "appId", label: "appId", placeholder: "com.example.app" }
    ],
    ok: "Create",
    validate: function (v) {
      if (!v.path) return "Please enter a path.";
      return "";
    }
  });
  if (!v) return;
  var appId = v.appId || "com.example.app";
  var body = "appId: " + appId + "\n---\n- launchApp\n";
  try {
    var r = await fetch("/api/flow/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: v.path, content: body })
    });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Could not create flow", "err"); return; }
    toast("Created " + v.path, "ok");
    await loadFlows();
    openFlowForEdit(v.path);
  } catch (e) { toast("Could not create flow", "err"); }
}

async function duplicateFlowDialog(from) {
  var v = await modal({
    title: "Duplicate flow",
    text: from,
    fields: [{ id: "to", label: "New path", value: from.replace(/\.ya?ml$/i, "-copy.yaml") }],
    ok: "Duplicate",
    validate: function (v) { return v.to ? "" : "Please enter a new path."; }
  });
  if (!v) return;
  try {
    var r = await fetch("/api/flow/duplicate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: from, to: v.to }) });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Duplicate failed", "err"); return; }
    toast("Duplicated to " + v.to, "ok");
    loadFlows();
  } catch (e) { toast("Duplicate failed", "err"); }
}

async function renameFlowDialog(from) {
  var v = await modal({
    title: "Rename flow",
    text: "Old reports for this flow become orphaned (they keep the old name).",
    fields: [{ id: "to", label: "New path", value: from }],
    ok: "Rename",
    validate: function (v) { return v.to ? "" : "Please enter a new path."; }
  });
  if (!v) return;
  try {
    var r = await fetch("/api/flow/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: from, to: v.to }) });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Rename failed", "err"); return; }
    toast("Renamed to " + v.to, "ok");
    if (ed.current === from) { ed.current = null; ed.orig = ""; ed.val = ""; $("edWrap").hidden = true; $("edTitle").textContent = "Select a flow to begin"; }
    loadFlows();
  } catch (e) { toast("Rename failed", "err"); }
}

async function deleteFlowDialog(p) {
  var go = await modal({ title: "Delete flow?", text: p + " will be backed up to FlowBackups/ then removed.", ok: "Delete" });
  if (!go) return;
  try {
    var r = await fetch("/api/flow/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Delete failed", "err"); return; }
    toast("Deleted " + p, "ok");
    if (ed.current === p) { ed.current = null; ed.orig = ""; ed.val = ""; $("edWrap").hidden = true; $("edTitle").textContent = "Select a flow to begin"; }
    loadFlows();
  } catch (e) { toast("Delete failed", "err"); }
}

/* Boot */
fetch("/app.config.json").then(function (r) { return r.json(); }).then(function (c) {
  document.title = c.name;
  $("brandName").textContent = c.name;
  $("brandLogo").textContent = c.short || c.name.charAt(0);
  $("brandFoot").textContent = c.name + (c.author ? "  \u00b7  by " + c.author : "");
  if (c.tagline) $("brandTag").textContent = c.tagline;
}).catch(function () {});
fetch("/api/project").then(function (r) { return r.text(); })
  .then(function (t) {
    var name = t.split(/[\\/]/).filter(Boolean).pop() || t;
    $("projpath").textContent = name;
    $("projpath").title = t;
  })
  .catch(function () {});
loadFlows();
loadReports();