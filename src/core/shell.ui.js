/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Window shell: collapsible sidebar, opening curtain, first-run guide.
   Loaded last.
   ============================================================ */

var Shell = (function () {
  function toggleSide(force) {
    var root = document.documentElement;
    var collapsed = force !== undefined ? force : !root.classList.contains("side-collapsed");
    root.classList.toggle("side-collapsed", collapsed);
    try { localStorage.setItem("us.side", collapsed ? "collapsed" : "open"); } catch (_) {}
    // the device screen and its outlines are sized from the layout
    setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 260);
  }
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) { e.preventDefault(); toggleSide(); }
  });

  /* Opening curtain: once per window, skipped for reduced motion */
  (function splash() {
    var root = document.documentElement, sp = $("splash");
    if (!root.classList.contains("splashing")) { if (sp) sp.remove(); return; }
    try { sessionStorage.setItem("us.splash", "1"); } catch (_) {}
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(function () { root.classList.add("splash-open"); }, reduce ? 0 : 650);
    setTimeout(function () { root.classList.remove("splashing", "splash-open"); if (sp) sp.remove(); }, reduce ? 50 : 1700);
  })();

  /* First start: four steps that explain the whole app */
  function welcome(force) {
    try { if (!force && localStorage.getItem("us.welcomed")) return; localStorage.setItem("us.welcomed", "1"); } catch (_) {}
    var ov = el("div", "overlay"), dlg = el("div", "dialog welcome");
    dlg.appendChild(el("h3", "", "Welcome to Understudy"));
    dlg.appendChild(el("p", "dtext", "Record a test once, feed it Excel data, run it as often as you like. Four steps:"));
    var grid = el("div", "wsteps");
    [["1", "Connect", "Plug in a phone with USB debugging on (lightest), or start a virtual device on the Record tab."],
     ["2", "Record", "Launch your app and use it on the screen. Every tap and value becomes a step. Choose per value: fixed text or test data."],
     ["3", "Run", "Pick flows and Excel rows on Run flows and press Run. Watch every step live."],
     ["4", "Read the report", "Reports shows each step, the data row and the screen where it failed. Fix, then run from the failed step."]
    ].forEach(function (s) {
      var c = el("div", "wstep"); c.appendChild(el("span", "wn", s[0])); var b = el("div", "");
      b.appendChild(el("b", "", s[1])); b.appendChild(el("p", "", s[2])); c.appendChild(b); grid.appendChild(c);
    });
    dlg.appendChild(grid);
    dlg.appendChild(el("p", "fhint", "Missing something? The Setup tab checks this PC and tells you exactly what to install. Projects (top left) keep separate apps apart."));
    var bar = el("div", "dbar");
    var setup = el("button", "btn", "Check this PC"), go = el("button", "btn solid", "Start recording");
    bar.appendChild(setup); bar.appendChild(go); dlg.appendChild(bar); ov.appendChild(dlg);
    var close = function () { ov.classList.remove("show"); setTimeout(function () { ov.remove(); }, 200); };
    setup.onclick = function () { close(); showTab("setup"); };
    go.onclick = function () { close(); showTab("record"); };
    ov.onclick = function (e) { if (e.target === ov) close(); };
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add("show"); });
  }
  setTimeout(welcome, 1900);

  return { toggleSide: toggleSide, welcome: welcome };
})();
