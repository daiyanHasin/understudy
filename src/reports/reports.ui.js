/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Reports tab: every run from History, shown inside the app.
   Also: "Run from step..." (data scripts before the step are reloaded,
   see src/run/partial.js) and routing report picks from the Run tab here.
   ============================================================ */

var Reports = (function () {
  var R = { runs: [], current: null, filter: "all" };

  function api(url, body) {
    var o = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || "Request failed"); return d; });
    });
  }
  function dur(ms) {
    ms = Math.max(0, +ms || 0);
    if (ms < 1000) return ms + " ms";
    var s = ms / 1000; if (s < 60) return s.toFixed(1) + " s";
    return Math.floor(s / 60) + "m " + ("0" + Math.round(s % 60)).slice(-2) + "s";
  }
  function when(t) {
    var d = new Date(t), now = new Date();
    var time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return "Today " + time;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday " + time;
    return d.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + time;
  }
  function title(r) {
    if (r.suite) return "Suite: " + r.suite;
    var flowsIn = []; (r.jobs || []).forEach(function (j) { if (flowsIn.indexOf(j.flow) < 0) flowsIn.push(j.flow); });
    return flowsIn.length === 1 ? flowsIn[0].split("/").pop() : flowsIn.length + " flows";
  }

  function load(openId) {
    return api("/api/history").then(function (list) {
      R.runs = list.slice().reverse();
      renderList();
      var id = openId || (R.current && R.current.id) || (R.runs[0] && R.runs[0].id);
      if (id) open(id);
      else $("repView").innerHTML = '<div class="card"><div class="empty">No runs yet. Run a flow and its report appears here.</div></div>';
    }).catch(function (e) { $("repRuns").textContent = e.message; });
  }

  function renderList() {
    var box = $("repRuns"); box.innerHTML = "";
    var q = ($("repFilter").value || "").trim().toLowerCase();
    var shown = R.runs.filter(function (r) {
      return !q || title(r).toLowerCase().indexOf(q) >= 0 || (r.jobs || []).some(function (j) { return j.flow.toLowerCase().indexOf(q) >= 0; });
    });
    if (!shown.length) { box.appendChild(el("div", "empty", R.runs.length ? "No run matches." : "No runs yet.")); return; }
    shown.slice(0, 200).forEach(function (r) {
      var b = el("button", "reprun" + (R.current && R.current.id === r.id ? " on" : ""));
      var ok = !r.failed;
      b.appendChild(el("span", "rdot " + (ok ? "pass" : "fail"), ok ? "\u2713" : "\u2717"));
      var t = el("span", "rtxt");
      t.appendChild(el("b", "", title(r)));
      t.appendChild(el("small", "", when(r.started) + "  \u00b7  " + (r.passed || 0) + " passed" + (r.failed ? ", " + r.failed + " failed" : "")));
      b.appendChild(t);
      b.onclick = function () { open(r.id); };
      box.appendChild(b);
    });
  }

  function donut(p, f, s) {
    var tot = Math.max(1, p + f + s), r = 42, c = 2 * Math.PI * r, off = 0;
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 110 110"); svg.setAttribute("class", "rdonut");
    function circ(stroke, n) {
      var e = document.createElementNS(NS, "circle");
      e.setAttribute("cx", 55); e.setAttribute("cy", 55); e.setAttribute("r", r); e.setAttribute("fill", "none");
      e.setAttribute("stroke-width", 11); e.setAttribute("class", stroke);
      if (n != null) {
        var len = c * n / tot;
        e.setAttribute("stroke-dasharray", len + " " + (c - len)); e.setAttribute("stroke-dashoffset", -off);
        e.setAttribute("transform", "rotate(-90 55 55)"); off += len;
      }
      svg.appendChild(e);
    }
    circ("trk", null);
    if (p) circ("okc", p); if (f) circ("badc", f); if (s) circ("skc", s);
    var t = document.createElementNS(NS, "text"); t.setAttribute("x", 55); t.setAttribute("y", 56); t.setAttribute("text-anchor", "middle"); t.setAttribute("class", "dv");
    t.textContent = Math.round(100 * p / Math.max(1, p + f)) + "%"; svg.appendChild(t);
    var l = document.createElementNS(NS, "text"); l.setAttribute("x", 55); l.setAttribute("y", 72); l.setAttribute("text-anchor", "middle"); l.setAttribute("class", "dl");
    l.textContent = "pass rate"; svg.appendChild(l);
    return svg;
  }

  function open(id) {
    return api("/api/history/run?id=" + encodeURIComponent(id)).then(function (run) {
      R.current = run; renderList(); renderRun(run);
    }).catch(function (e) { toast(e.message, "err"); });
  }

  function renderRun(run) {
    var v = $("repView"); v.innerHTML = "";
    var jobs = run.jobs || [];
    var hero = el("div", "rhero");
    var left = el("div", "");
    left.appendChild(el("div", "rbrand", "Test report"));
    left.appendChild(el("h2", "", title(run)));
    left.appendChild(el("div", "rsub", new Date(run.started).toLocaleString() + "  \u00b7  " + dur((run.finished || run.started) - run.started) +
      (run.device ? "  \u00b7  " + run.device : "")));
    left.appendChild(el("span", "rverdict " + (run.failed ? "fail" : "pass"), run.failed ? run.failed + " of " + jobs.length + " failed" : "All tests passed"));
    var acts = el("div", "racts");
    var file = el("button", "btn mini", "Open as a file"); file.title = "The self-contained HTML in Reports/ (share it, print it)";
    file.onclick = function () { openFile(run); };
    acts.appendChild(file);
    var failedJobs = jobs.filter(function (j) { return j.status === "fail"; });
    if (failedJobs.length) {
      var rf = el("button", "btn mini solid", "Rerun failed (" + failedJobs.length + ")");
      rf.onclick = function () { showTab("run"); startRun(failedJobs.map(function (j) { return { flow: j.flow, rows: j.row ? String(j.row) : "" }; })); };
      acts.appendChild(rf);
    }
    left.appendChild(acts);
    hero.appendChild(left);
    hero.appendChild(donut(run.passed || 0, run.failed || 0, run.skipped || 0));
    v.appendChild(hero);

    var k = el("div", "rkpis");
    [[jobs.length, "Tests", ""], [run.passed || 0, "Passed", "ok"], [run.failed || 0, "Failed", "bad"], [run.skipped || 0, "Skipped", ""],
     [dur((run.finished || run.started) - run.started), "Duration", ""]].forEach(function (x) {
      var c = el("div", "rkpi " + x[2]); c.appendChild(el("b", "", String(x[0]))); c.appendChild(el("span", "", x[1])); k.appendChild(c);
    });
    v.appendChild(k);

    var bar = el("div", "rfilters");
    [["all", "All"], ["fail", "Failed"], ["pass", "Passed"]].forEach(function (f) {
      var b = el("button", R.filter === f[0] ? "on" : "", f[1]);
      b.onclick = function () { R.filter = f[0]; renderRun(run); };
      bar.appendChild(b);
    });
    v.appendChild(bar);

    jobs.filter(function (j) { return R.filter === "all" || j.status === R.filter; }).forEach(function (j) {
      var d = document.createElement("details"); d.className = "rjob " + j.status;
      if (j.status === "fail") d.open = true;
      var sm = document.createElement("summary");
      sm.appendChild(el("span", "rst " + j.status, { pass: "\u2713", fail: "\u2717", skipped: "\u21B7", stopped: "\u25A0" }[j.status] || "\u2022"));
      var nm = el("span", "rnm"); nm.appendChild(el("b", "", j.flow));
      nm.appendChild(el("small", "", (j.row ? "Excel row " + j.row : "No test data") + (j.fromStep ? "  \u00b7  from step " + j.fromStep : "")));
      sm.appendChild(nm);
      sm.appendChild(el("span", "rchip", { pass: "Passed", fail: "Failed", skipped: "Skipped", stopped: "Stopped" }[j.status] || j.status));
      sm.appendChild(el("span", "rchip", dur(j.duration)));
      d.appendChild(sm);
      var body = el("div", "rbody" + (j.screenshot && j.status === "fail" ? "" : " noshot"));
      var main = el("div", "");
      if (j.failedStep) { var why = el("div", "rwhy"); why.appendChild(el("b", "", "Failed at: ")); why.appendChild(document.createTextNode(j.failedStep)); main.appendChild(why); }
      if (j.steps && j.steps.length) {
        var ol = el("ol", "rsteps");
        j.steps.forEach(function (st) {
          var li = el("li", st.status);
          li.style.paddingLeft = (6 + (st.depth || 0) * 14) + "px";
          li.appendChild(el("span", "i", { COMPLETED: "\u2713", FAILED: "\u2717", SKIPPED: "\u21B7", WARNED: "!" }[st.status] || "\u2022"));
          li.appendChild(el("span", "", st.desc));
          li.appendChild(el("span", "t", st.ms != null ? dur(st.ms) : ""));
          ol.appendChild(li);
        });
        main.appendChild(ol);
      } else main.appendChild(el("div", "empty", "No step details for this test (runs older than Understudy 1.2, or it never started)."));
      var ja = el("div", "racts");
      if (j.report) { var mr = el("button", "btn mini", "Maestro report"); mr.onclick = function () { window.open(j.report, "_blank"); }; ja.appendChild(mr); }
      var again = el("button", "btn mini", "Run again");
      again.onclick = function () { showTab("run"); startRun([{ flow: j.flow, rows: j.row ? String(j.row) : "" }]); };
      ja.appendChild(again);
      if (j.status === "fail") {
        var fromF = el("button", "btn mini solid", "Run from the failed step\u2026");
        fromF.onclick = function () { runFromStepDialog(j.flow, j.failedStep, j.row); };
        ja.appendChild(fromF);
      }
      main.appendChild(ja);
      body.appendChild(main);
      if (j.screenshot && j.status === "fail") {
        var shot = el("div", "rshot");
        var img = document.createElement("img"); img.src = j.screenshot; img.alt = "Screen when the test failed"; img.loading = "lazy";
        img.onclick = function () { window.open(j.screenshot, "_blank"); };
        img.onerror = function () { shot.remove(); body.classList.add("noshot"); };
        shot.appendChild(img); shot.appendChild(el("span", "", "Screen at the failure"));
        body.appendChild(shot);
      }
      d.appendChild(body);
      v.appendChild(d);
    });
  }

  function openFile(run) {
    var go = function (name) { window.open("/reports/" + encodeURIComponent(name), "_blank"); };
    if (run.summary) return go(run.summary);
    api("/api/report/write", { id: run.id }).then(function (d) { run.summary = d.name; go(d.name); }).catch(function (e) { toast(e.message, "err"); });
  }

  /* ---------- Run from a step ---------- */
  function runFromStepDialog(flow, hint, row) {
    if (!flow) { toast("Open a flow first.", "err"); return; }
    api("/api/flow/commands?path=" + encodeURIComponent(flow)).then(function (d) {
      var steps = d.steps || [];
      if (!steps.length) { toast("This flow has no steps.", "err"); return; }
      // Best guess for the failed step: most words in common with Maestro's description
      var pick = 1;
      if (hint) {
        var words = String(hint).toLowerCase().match(/[a-z0-9]+/g) || [], best = 0;
        steps.forEach(function (s) {
          var l = s.label.toLowerCase(), sc = 0;
          words.forEach(function (w) { if (w.length > 2 && l.indexOf(w) >= 0) sc++; });
          if (sc > best) { best = sc; pick = s.n; }
        });
      }
      var ov = el("div", "overlay"), dlg = el("div", "dialog valuedlg");
      dlg.appendChild(el("h3", "", "Run " + flow.split("/").pop() + " from a step"));
      dlg.appendChild(el("p", "datanote", "Steps before the one you choose are skipped, except data scripts and variables (marked \u201Cdata\u201D): they run first, so ${output.\u2026} values are never undefined."));
      var list = el("div", "steppick");
      steps.forEach(function (s) {
        var lb = el("label", "spick" + (s.setup ? " setup" : ""));
        var rb = document.createElement("input"); rb.type = "radio"; rb.name = "fromstep"; rb.value = s.n; rb.checked = s.n === pick;
        lb.appendChild(rb); lb.appendChild(el("span", "n", String(s.n))); lb.appendChild(el("span", "l", s.label));
        if (s.setup) lb.appendChild(el("span", "tag", "data"));
        list.appendChild(lb);
      });
      dlg.appendChild(list);
      var rowsW = el("label", "field"); rowsW.appendChild(el("span", "flabel", "Excel rows (empty = row 1)"));
      var rows = document.createElement("input"); rows.type = "text"; rows.value = row ? String(row) : ((typeof queueRows !== "undefined" && queueRows[flow]) || "");
      rowsW.appendChild(rows); dlg.appendChild(rowsW);
      var bar = el("div", "dbar"), c = el("button", "btn", "Cancel"), o = el("button", "btn solid", "Run from this step");
      bar.appendChild(c); bar.appendChild(o); dlg.appendChild(bar); ov.appendChild(dlg);
      var close = function () { ov.classList.remove("show"); setTimeout(function () { ov.remove(); }, 200); };
      c.onclick = close; ov.onclick = function (e) { if (e.target === ov) close(); };
      o.onclick = function () {
        var sel = dlg.querySelector("input[name=fromstep]:checked");
        close();
        showTab("run");
        startRun([{ flow: flow, rows: rows.value.trim(), fromStep: sel ? +sel.value : 1 }]);
      };
      document.body.appendChild(ov);
      requestAnimationFrame(function () {
        ov.classList.add("show");
        var cur = list.querySelector("input:checked"); if (cur) cur.parentNode.scrollIntoView({ block: "center" });
      });
    }).catch(function (e) { toast(e.message, "err"); });
  }

  /* ---------- Report picks from the Run tab open here ---------- */
  function openByReport(name) {
    var url = "/reports/" + encodeURIComponent(name);
    var hit = null;
    return api("/api/history").then(function (list) {
      for (var i = list.length - 1; i >= 0 && !hit; i--) {
        var r = list[i];
        if (r.summary === name || (r.jobs || []).some(function (j) { return j.report === url; })) hit = r;
      }
      if (!hit) return false;
      showTab("reports"); load(hit.id);
      return true;
    }).catch(function () { return false; });
  }
  var baseShowReport = window.showReport;
  window.showReport = function (name) {
    if (!name) return;
    openByReport(name).then(function (ok) { if (!ok && baseShowReport) baseShowReport(name); });
  };

  hooks.tab.push(function (name) { if (name === "reports") load(); });
  hooks.runDone.push(function (d) {
    if (!d || !d.runId) return;
    var t = el("div", "toast act " + (d.failed ? "err" : "ok"));
    t.appendChild(el("span", "", d.failed ? d.failed + " failed. The report shows where." : "All passed."));
    var b = el("button", "btn mini solid", "View report");
    b.onclick = function () { t.remove(); showTab("reports"); load(d.runId); };
    t.appendChild(b);
    $("toasts").appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 300); }, 10000);
  });

  return { load: load, open: open, renderList: renderList, runFromStepDialog: runFromStepDialog, openByReport: openByReport };
})();
