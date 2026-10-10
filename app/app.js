/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Understudy: shared helpers, theme, toasts, dialogs, tabs.
   Feature screens live in src/<feature>/*.ui.js
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

/* Boot: after every feature script has loaded */
document.addEventListener("DOMContentLoaded", function () {
fetch("/app.config.json").then(function (r) { return r.json(); }).then(function (c) {
  document.title = c.name;
  $("brandName").textContent = c.name;
  $("brandLogo").textContent = c.short || c.name.charAt(0);
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
});
