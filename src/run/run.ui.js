/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* Run flows tab: flow list, queue, run control, live steps, results, SSE. */

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
      // the device chosen on the Record tab; the server ignores it if it is not connected
      body: JSON.stringify({ items: items, stopOnFail: $("stopOnFail").checked, suite: suiteName || null,
                             device: localStorage.getItem("us.serial") || null })
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

