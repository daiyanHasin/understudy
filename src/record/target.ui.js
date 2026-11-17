/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Record tab, two small pieces of the 2.3 layout. Loaded after recorder.ui.js,
   which is unchanged: both pieces only read what it already keeps up to date.

   1. Target control: the phone and the app shown as one button in the top bar.
      The device list, app field, Fresh data and Launch app live in its popover.
   2. Add a step: a search field over the list of steps.
   ============================================================ */
(function () {
  function $(id) { return document.getElementById(id); }

  /* ---------- 1. Target control ---------- */
  function syncTarget() {
    var sel = $("recDevice"), dev = $("tgDev"), conn = $("tgConn"), app = $("tgApp"), dot = $("tgDot");
    if (!sel || !dev) return;
    var opt = sel.options[sel.selectedIndex];
    // Options read "SM_M325F · USB": the name is the button's text, the connection a quiet word after it
    var parts = (opt ? opt.textContent : "").split(/\s+[·|-]\s+/);
    var name = (parts[0] || "").trim() || "Phone", how = parts.slice(1).join(" · ").trim();
    if (dev.textContent !== name) dev.textContent = name;
    if (conn.textContent !== how) conn.textContent = how;
    var pkg = ($("recApp").value || "").trim() || "no app chosen";
    if (app.textContent !== pkg) app.textContent = pkg;
    var cls = ($("recDot") || {}).className || "ldot";
    if (dot.className !== cls) dot.className = cls;
  }
  setInterval(syncTarget, 400);
  document.addEventListener("change", syncTarget, true);
  document.addEventListener("input", syncTarget, true);
  document.addEventListener("DOMContentLoaded", syncTarget);

  /* ---------- 2. Add a step: type to filter, arrows to move, Enter to add ---------- */
  var menu = $("insMenu"), find = $("insFind"), list = $("insList"), foot = $("insFoot");
  if (!menu || !find || !list) return;
  var items = Array.prototype.slice.call(list.querySelectorAll("button"));
  items.forEach(function (b) {
    b.setAttribute("role", "option");
    b.dataset.label = b.textContent;
    // also found by the step's own name: Rec.insert('waitUntil') -> "waituntil"
    var m = /Rec\.insert\('([^']+)'\)/.exec(b.getAttribute("onclick") || "");
    b.dataset.key = (b.textContent + " " + (m ? m[1] : "")).toLowerCase();
  });
  var none = document.createElement("div"); none.className = "insnone"; none.hidden = true; list.appendChild(none);
  var cur = -1;

  function visible() { return items.filter(function (b) { return !b.hidden; }); }
  function mark(i) {
    var v = visible();
    cur = v.length ? Math.max(0, Math.min(v.length - 1, i)) : -1;
    items.forEach(function (b) { b.classList.remove("on"); b.setAttribute("aria-selected", "false"); });
    if (cur >= 0) { v[cur].classList.add("on"); v[cur].setAttribute("aria-selected", "true"); v[cur].scrollIntoView({ block: "nearest" }); }
  }
  function esc(t) { return t.replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function filter() {
    var q = find.value.trim().toLowerCase(), shown = 0;
    items.forEach(function (b) {
      var hit = !q || b.dataset.key.indexOf(q) >= 0;
      b.hidden = !hit;
      if (hit) shown++;
      var label = b.dataset.label, at = q ? label.toLowerCase().indexOf(q) : -1;
      b.innerHTML = at < 0 ? esc(label) : esc(label.slice(0, at)) + "<mark>" + esc(label.slice(at, at + q.length)) + "</mark>" + esc(label.slice(at + q.length));
    });
    // a group name stays only while one of its steps is shown
    Array.prototype.forEach.call(list.querySelectorAll(".mhead"), function (h) {
      var any = false;
      for (var n = h.nextElementSibling; n && !n.classList.contains("mhead"); n = n.nextElementSibling) if (n.tagName === "BUTTON" && !n.hidden) any = true;
      h.hidden = !any;
    });
    none.hidden = shown > 0;
    none.textContent = "No step matches “" + find.value.trim() + "”. Any Maestro command can be typed on the YAML tab.";
    foot.textContent = (q ? shown + " of " + items.length : items.length) + " steps · ↑ ↓ to move · Enter to add";
    mark(q ? 0 : -1);
  }
  find.addEventListener("input", filter);
  find.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); mark(cur + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); mark(cur - 1); }
    else if (e.key === "Enter") { e.preventDefault(); var v = visible(); if (v.length) v[cur < 0 ? 0 : cur].click(); }
    else if (e.key === "Escape") { menu.open = false; }
  });
  menu.addEventListener("toggle", function () {
    if (!menu.open) return;
    find.value = ""; filter(); list.scrollTop = 0;
    setTimeout(function () { find.focus(); }, 0);
  });
  // choosing a step closes the list (the dialogs some steps open come next)
  list.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("button")) menu.open = false; });
  filter();
})();
