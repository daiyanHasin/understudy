/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Dashboard: KPIs, charts (plain SVG, works offline),
   flaky tests, and "compare two runs".
   Data: GET /api/history -> [{ id, started, finished, suite,
     passed, failed, skipped, jobs:[{ id, label, status, duration, failedStep }] }]
   ============================================================ */

var hist = [];

async function loadDashboard() {
  try { hist = await (await fetch("/api/history")).json(); } catch (e) { hist = []; }
  if (!Array.isArray(hist)) hist = [];
  renderKpis();
  if (!hist.length) {
    ["chRuns", "chRate", "chFail", "chSlow"].forEach(function (id) {
      $(id).innerHTML = '<div class="empty">No runs recorded yet. Run some flows and come back.</div>';
    });
    $("flaky").innerHTML = '<div class="empty">Nothing yet.</div>';
    $("cmpOut").innerHTML = '<div class="empty">Needs at least two runs.</div>';
    $("cmpA").innerHTML = $("cmpB").innerHTML = "";
    return;
  }
  var recent = hist.slice(-30);
  $("chRuns").innerHTML = stackedBars(recent);
  $("chRate").innerHTML = rateLine(recent);
  $("chFail").innerHTML = hbars(topFailures(), "bad", function (v) { return v + "\u00d7"; }, "No failures recorded.");
  $("chSlow").innerHTML = hbars(slowest(), "", fmtDur);
  renderFlaky();
  fillCompareSelects();
  renderCompare();
}

/* ---------- helpers ---------- */
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function when(ts) {
  var d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " +
         d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function runName(r) { return when(r.started) + (r.suite ? "  \u00b7  " + r.suite : "") + "  \u00b7  " + r.passed + "\u2713 " + r.failed + "\u2717"; }
function testsOf(r) { return r.jobs.filter(function (j) { return j.status === "pass" || j.status === "fail"; }); }

/* ---------- KPIs ---------- */
function renderKpis() {
  var box = $("kpis"); box.innerHTML = "";
  var recent = hist.slice(-30), tests = 0, pass = 0, dur = 0;
  recent.forEach(function (r) {
    testsOf(r).forEach(function (j) { tests++; if (j.status === "pass") pass++; });
    dur += (r.finished - r.started);
  });
  var last = hist[hist.length - 1];
  [
    ["Runs recorded", String(hist.length), ""],
    ["Tests executed (last 30 runs)", String(tests), ""],
    ["Pass rate (last 30 runs)", tests ? Math.round(100 * pass / tests) + "%" : "\u2014", tests && pass / tests >= 0.9 ? "ok" : tests ? "bad" : ""],
    ["Average run time", recent.length ? fmtDur(dur / recent.length) : "\u2014", ""],
    ["Last run", last ? (last.failed ? last.failed + " failed" : "All passed") : "\u2014", last ? (last.failed ? "bad" : "ok") : ""]
  ].forEach(function (k) {
    var c = el("div", "kpi " + k[2]);
    c.appendChild(el("div", "kv", k[1]));
    c.appendChild(el("div", "kl", k[0]));
    box.appendChild(c);
  });
}

/* ---------- Charts (SVG) ---------- */
var W = 560, H = 220, PAD = { l: 34, r: 10, t: 12, b: 26 };

function axisY(max, fmt) {
  var out = "", steps = 4;
  for (var i = 0; i <= steps; i++) {
    var v = max * i / steps, y = PAD.t + (H - PAD.t - PAD.b) * (1 - i / steps);
    out += '<line x1="' + PAD.l + '" x2="' + (W - PAD.r) + '" y1="' + y + '" y2="' + y + '" style="stroke:var(--line)"/>' +
           '<text x="' + (PAD.l - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="ax">' + fmt(v) + "</text>";
  }
  return out;
}

// Passed / failed / skipped per run, stacked
function stackedBars(runs) {
  var max = Math.max.apply(null, runs.map(function (r) { return r.jobs.length; }).concat([1]));
  var iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, bw = iw / runs.length;
  var svg = axisY(max, function (v) { return Math.round(v); });
  runs.forEach(function (r, i) {
    var x = PAD.l + i * bw + bw * 0.15, w = Math.max(2, bw * 0.7), y = PAD.t + ih;
    var skipped = r.jobs.length - r.passed - r.failed;
    [["ok", r.passed], ["bad", r.failed], ["skip", skipped]].forEach(function (seg) {
      if (!seg[1]) return;
      var h = ih * seg[1] / max; y -= h;
      svg += '<rect class="' + seg[0] + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="2">' +
             "<title>" + esc(runName(r)) + "</title></rect>";
    });
  });
  svg += '<text x="' + PAD.l + '" y="' + (H - 6) + '" class="ax">' + esc(when(runs[0].started)) + "</text>" +
         '<text x="' + (W - PAD.r) + '" y="' + (H - 6) + '" text-anchor="end" class="ax">' + esc(when(runs[runs.length - 1].started)) + "</text>";
  return legend([["ok", "Passed"], ["bad", "Failed"], ["skip", "Skipped / stopped"]]) +
         '<svg viewBox="0 0 ' + W + " " + H + '" class="svgc">' + svg + "</svg>";
}

// Pass % per run, as a line with dots
function rateLine(runs) {
  var iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  var pts = runs.map(function (r, i) {
    var t = testsOf(r).length, p = t ? r.passed / t : 0;
    return { x: PAD.l + (runs.length === 1 ? iw / 2 : iw * i / (runs.length - 1)), y: PAD.t + ih * (1 - p), p: p, r: r };
  });
  var svg = axisY(100, function (v) { return Math.round(v) + "%"; });
  var d = pts.map(function (p, i) { return (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1); }).join(" ");
  svg += '<path d="' + d + ' L' + pts[pts.length - 1].x + " " + (PAD.t + ih) + " L" + pts[0].x + " " + (PAD.t + ih) + ' Z" class="area"/>';
  svg += '<path d="' + d + '" class="line"/>';
  pts.forEach(function (p) {
    svg += '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.5" class="' + (p.p === 1 ? "ok" : "bad") + '"><title>' +
           esc(runName(p.r)) + " \u2014 " + Math.round(p.p * 100) + "%</title></circle>";
  });
  return '<svg viewBox="0 0 ' + W + " " + H + '" class="svgc">' + svg + "</svg>";
}

// Horizontal bars: [{ label, value }]
function hbars(items, cls, fmt, emptyMsg) {
  if (!items.length) return '<div class="empty">' + (emptyMsg || "Nothing to show yet.") + "</div>";
  var max = Math.max.apply(null, items.map(function (x) { return x.value; }));
  return '<div class="hbars">' + items.map(function (x) {
    return '<div class="hb" title="' + esc(x.label) + '"><span class="hl">' + esc(x.label) + '</span>' +
           '<span class="ht"><span class="hf ' + cls + '" style="width:' + Math.max(2, 100 * x.value / max) + '%"></span></span>' +
           '<span class="hv">' + fmt(x.value) + "</span></div>";
  }).join("") + "</div>";
}

function topFailures() {
  var c = {};
  hist.forEach(function (r) { r.jobs.forEach(function (j) { if (j.status === "fail") c[j.label] = (c[j.label] || 0) + 1; }); });
  return Object.keys(c).map(function (k) { return { label: k, value: c[k] }; })
    .sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
}

function slowest() {
  var sum = {}, n = {};
  hist.slice(-30).forEach(function (r) {
    testsOf(r).forEach(function (j) { sum[j.label] = (sum[j.label] || 0) + j.duration; n[j.label] = (n[j.label] || 0) + 1; });
  });
  return Object.keys(sum).map(function (k) { return { label: k, value: sum[k] / n[k] }; })
    .sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
}

function legend(items) {
  return '<div class="legend">' + items.map(function (x) {
    return '<span><i class="' + x[0] + '"></i>' + x[1] + "</span>";
  }).join("") + "</div>";
}

/* ---------- Flaky tests ---------- */
function renderFlaky() {
  var seq = {};
  hist.slice(-10).forEach(function (r) {
    testsOf(r).forEach(function (j) { (seq[j.label] = seq[j.label] || []).push(j.status); });
  });
  var flaky = Object.keys(seq).filter(function (k) {
    return seq[k].indexOf("pass") >= 0 && seq[k].indexOf("fail") >= 0;
  });
  var box = $("flaky"); box.innerHTML = "";
  if (!flaky.length) { box.appendChild(el("div", "empty", "No flaky tests in the last 10 runs.")); return; }
  flaky.forEach(function (k) {
    var row = el("div", "res");
    row.appendChild(el("span", "nm", k));
    var dots = el("span", "dots");
    seq[k].forEach(function (s) { var d = el("i", s === "pass" ? "ok" : "bad"); d.title = s; dots.appendChild(d); });
    row.appendChild(dots);
    var fails = seq[k].filter(function (s) { return s === "fail"; }).length;
    row.appendChild(el("span", "dur", fails + " of " + seq[k].length + " failed"));
    box.appendChild(row);
  });
}

/* ---------- Compare two runs ---------- */
function fillCompareSelects() {
  var a = $("cmpA"), b = $("cmpB"), pa = a.value, pb = b.value;
  a.innerHTML = b.innerHTML = "";
  hist.slice().reverse().forEach(function (r) {
    [a, b].forEach(function (s) {
      var o = document.createElement("option");
      o.value = r.id; o.textContent = runName(r);
      s.appendChild(o);
    });
  });
  var ids = hist.map(function (r) { return r.id; });
  b.value = ids.indexOf(pb) >= 0 ? pb : ids[ids.length - 1];
  a.value = ids.indexOf(pa) >= 0 ? pa : (ids[ids.length - 2] || ids[0]);
}

function renderCompare() {
  var out = $("cmpOut");
  var A = hist.filter(function (r) { return r.id === $("cmpA").value; })[0];
  var B = hist.filter(function (r) { return r.id === $("cmpB").value; })[0];
  if (!A || !B) { out.innerHTML = '<div class="empty">Choose two runs.</div>'; return; }
  if (A === B) { out.innerHTML = '<div class="empty">Pick two different runs.</div>'; return; }
  var mapA = {}, mapB = {}, keys = [];
  A.jobs.forEach(function (j) { mapA[j.id] = j; keys.push(j.id); });
  B.jobs.forEach(function (j) { mapB[j.id] = j; if (!mapA[j.id]) keys.push(j.id); });

  var kinds = {
    broke:  ["Newly failing", "bad"],  fixed: ["Fixed", "ok"],
    still:  ["Still failing", "bad"],  same:  ["Still passing", ""],
    added:  ["Only in \u201cAfter\u201d", ""], removed: ["Only in \u201cBefore\u201d", ""]
  };
  var rows = keys.map(function (k) {
    var a = mapA[k], b = mapB[k], kind;
    if (!a) kind = "added"; else if (!b) kind = "removed";
    else if (a.status === "pass" && b.status === "fail") kind = "broke";
    else if (a.status === "fail" && b.status === "pass") kind = "fixed";
    else if (b.status === "fail") kind = "still";
    else kind = "same";
    return { k: k, a: a, b: b, kind: kind };
  });
  var order = ["broke", "fixed", "still", "added", "removed", "same"];
  rows.sort(function (x, y) { return order.indexOf(x.kind) - order.indexOf(y.kind); });

  var counts = {};
  rows.forEach(function (r) { counts[r.kind] = (counts[r.kind] || 0) + 1; });
  var html = '<div class="cmpsum">' + order.filter(function (k) { return counts[k]; }).map(function (k) {
    return '<span class="stat ' + kinds[k][1] + '">' + counts[k] + " " + kinds[k][0].toLowerCase() + "</span>";
  }).join("") + "</div>";

  html += '<div class="tablebox cmp"><table><tr><th>Test</th><th>Change</th><th>Before</th><th>After</th><th>Time</th><th>Failed at (After)</th></tr>';
  rows.forEach(function (r) {
    var da = r.a ? r.a.duration : null, db = r.b ? r.b.duration : null, delta = "";
    if (da && db) {
      var diff = db - da, pct = Math.round(100 * diff / da);
      delta = fmtDur(db) + (Math.abs(diff) < 1000 ? ' <span class="dim">(same)</span>' :
        ' <span class="' + (pct > 20 ? "bad" : pct < -20 ? "ok" : "") + '">(' + (diff >= 0 ? "+" : "\u2212") + fmtDur(Math.abs(diff)) + ")</span>");
    } else if (db) delta = fmtDur(db);
    html += "<tr class=\"k-" + r.kind + "\"><td>" + esc((r.b || r.a).label) + "</td>" +
      '<td><span class="stat ' + kinds[r.kind][1] + '">' + kinds[r.kind][0] + "</span></td>" +
      "<td>" + badge(r.a) + "</td><td>" + badge(r.b) + "</td><td>" + delta + "</td>" +
      '<td class="fs">' + esc(r.b && r.b.failedStep ? r.b.failedStep : "") + "</td></tr>";
  });
  out.innerHTML = html + "</table></div>";
}

function badge(j) {
  if (!j) return '<span class="dim">\u2014</span>';
  var lbl = { pass: "PASSED", fail: "FAILED", skipped: "SKIPPED", stopped: "STOPPED" }[j.status] || j.status;
  var b = '<span class="badge ' + j.status + '">' + lbl + "</span>";
  return j.report ? '<a href="' + j.report + '" target="_blank" title="Open report">' + b + "</a>" : b;
}

/* ---------- wire up ---------- */
hooks.tab.push(function (name) { if (name === "dashboard") loadDashboard(); });
hooks.runDone.push(function () { if (!$("tab-dashboard").hidden) loadDashboard(); });
