/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Motion and style (2.3). No other script depends on this file: remove its
   <script> tag and the app works the same, without the three effects below.

   1. Numbers count to their new value instead of jumping.
   2. A list pulled past its first or last row gives a little, resists, and
      springs back (the wheel or touchpad keeps pushing at the end of a list).
   3. The two looks, Bench and Studio (sidebar footer).

   The press-and-spring of buttons and the eased-in screens, panels and menus
   are plain CSS: see "Motion" at the end of app/styles.src.css.
   All of it is off when the PC asks for reduced motion.
   ============================================================ */
var Motion = (function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  function still() { return !!(reduce && reduce.matches); }

  /* ---------- 1. Numbers ---------- */
  // Elements whose whole text is one number, with words around it at most ("12", "83%", "4.2 s", "3 failed")
  var NUM_SEL = ".kv, .count, .stat, .hv, .pos, .livestats b, .livestats span, [data-num]";
  var ONE_NUMBER = /^(\D*?)(-?\d+(?:\.\d+)?)(\D*)$/;
  var last = new WeakMap();        // element -> the text it showed before
  var slots = {};                  // "container#index" -> last number, for lists that are rebuilt from scratch
  var running = new WeakMap();     // element -> { raf, final }

  function slotKey(elm) {
    var box = elm.closest("[id]");
    if (!box) return null;
    var all = box.querySelectorAll(NUM_SEL);
    return box.id + "#" + Array.prototype.indexOf.call(all, elm);
  }
  function tween(elm, fromText, toText) {
    var a = ONE_NUMBER.exec(fromText || ""), b = ONE_NUMBER.exec(toText);
    if (!b) return;
    var to = parseFloat(b[2]), from = a && a[1] === b[1] && a[3] === b[3] ? parseFloat(a[2]) : NaN;
    if (isNaN(from)) {
      var k = slotKey(elm);
      from = k && slots[k] != null ? slots[k] : 0;
    }
    if (from === to) return;
    var decimals = (b[2].split(".")[1] || "").length;
    var span = Math.abs(to - from);
    if (decimals === 0 && span < 2) return;                 // 11 -> 12: nothing to count
    var ms = Math.min(900, 320 + Math.log(1 + span) * 90), t0 = performance.now();
    var old = running.get(elm); if (old) cancelAnimationFrame(old.raf);
    var st = { raf: 0, final: toText };
    running.set(elm, st);
    function frame(now) {
      var p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);       // ease out
      if (p >= 1 || !elm.isConnected) { write(st.final); running.delete(elm); last.set(elm, st.final); return; }
      write(b[1] + (from + (to - from) * e).toFixed(decimals) + b[3]);
      st.raf = requestAnimationFrame(frame);
    }
    // the observer sees our own writes one tick later: mark them so they are not taken for a new value
    function write(t) { st.writing = true; elm.textContent = t; Promise.resolve().then(function () { st.writing = false; }); }
    write(b[1] + from.toFixed(decimals) + b[3]);
    st.raf = requestAnimationFrame(frame);
  }
  function look(elm) {
    if (!elm || elm.nodeType !== 1 || !elm.matches || !elm.matches(NUM_SEL) || elm.children.length) return;
    var st = running.get(elm), text = elm.textContent;
    if (st) {
      if (st.writing || text === st.final) return;           // our own frame
      cancelAnimationFrame(st.raf); running.delete(elm);     // the app wrote a newer value: count on from here
    }
    var before = last.get(elm);
    if (before === text) return;
    last.set(elm, text);
    var m = ONE_NUMBER.exec(text);
    if (m) { var k = slotKey(elm); if (!still()) tween(elm, before, text); if (k) slots[k] = parseFloat(m[2]); }
  }
  function watchNumbers() {
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === "characterData") { look(m.target.parentNode); continue; }
        look(m.target);
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 3) look(n.parentNode);
          else if (n.nodeType === 1) {
            look(n);
            if (n.querySelectorAll) { var inner = n.querySelectorAll(NUM_SEL); for (var q = 0; q < inner.length && q < 60; q++) look(inner[q]); }
          }
        }
      }
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  /* ---------- 2. Pull past the end of a list ---------- */
  var MAX_PULL = 34;               // px a list can be pulled
  var pulled = null, pull = 0, letGo = 0;

  function scroller(from) {
    for (var n = from; n && n !== document.body && n.nodeType === 1; n = n.parentNode) {
      if (n.id === "recStage" || n.tagName === "TEXTAREA" || n.tagName === "CANVAS") return null;
      if (n.scrollHeight - n.clientHeight > 1) {
        var o = getComputedStyle(n).overflowY;
        if (o === "auto" || o === "scroll") return n;
      }
    }
    return null;
  }
  function release() {
    if (!pulled) return;
    var n = pulled; pulled = null; pull = 0;
    n.style.transition = "transform .55s cubic-bezier(.3,1.6,.5,1)";
    n.style.transform = "";
    setTimeout(function () { if (pulled !== n) { n.style.transition = ""; n.removeAttribute("data-rubber"); } }, 560);
  }
  function onWheel(e) {
    if (still() || e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    var n = scroller(e.target);
    if (!n) return;
    var atTop = n.scrollTop <= 0, atEnd = n.scrollTop + n.clientHeight >= n.scrollHeight - 1;
    var past = (e.deltaY < 0 && atTop) || (e.deltaY > 0 && atEnd);
    if (!past) { if (pulled === n && pull) release(); return; }
    if (pulled && pulled !== n) release();
    pulled = n;
    // The further it is pulled, the less each push moves it: that is the resistance
    var room = 1 - Math.min(1, Math.abs(pull) / MAX_PULL);
    pull += -e.deltaY * 0.18 * room * room;
    pull = Math.max(-MAX_PULL, Math.min(MAX_PULL, pull));
    n.setAttribute("data-rubber", "");
    n.style.transition = "transform .08s linear";
    n.style.transform = "translateY(" + pull.toFixed(1) + "px)";
    clearTimeout(letGo);
    letGo = setTimeout(release, 110);
  }

  /* ---------- 3. Bench / Studio ---------- */
  function styleName() { return document.documentElement.classList.contains("style-studio") ? "studio" : "bench"; }
  function showStyle() { var s = document.getElementById("styleName"); if (s) s.textContent = styleName() === "studio" ? "Studio" : "Bench"; }
  function setStyle(name) {
    document.documentElement.classList.toggle("style-studio", name === "studio");
    try { localStorage.setItem("us.style", name === "studio" ? "studio" : "bench"); } catch (_) {}
    showStyle();
    // the device screen and its outlines are sized from the layout
    setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 60);
  }
  function toggleStyle() { setStyle(styleName() === "studio" ? "bench" : "studio"); }

  function start() {
    showStyle();
    watchNumbers();
    document.addEventListener("wheel", onWheel, { passive: true, capture: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  return { toggleStyle: toggleStyle, setStyle: setStyle };
})();
