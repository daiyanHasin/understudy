/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Extra tabs (Record, Setup) without changing app.js, the Setup
   checklist, and Quit.
   Must load after app.js and before ui/recorder.js.
   ============================================================ */

(function () {
  var BASE  = ["run", "data", "editor", "dashboard"];
  var EXTRA = ["record", "setup", "reports"];
  var baseShowTab = window.showTab;

  window.showTab = function (name) {
    var extra = EXTRA.indexOf(name) >= 0;
    EXTRA.forEach(function (t) {
      $("tab-" + t).hidden = t !== name;
      $("tabbtn-" + t).className = "tab" + (t === name ? " active" : "");
    });
    document.body.classList.toggle("wide", name === "record");
    if (!extra) return baseShowTab(name);
    BASE.forEach(function (t) {
      $("tab-" + t).hidden = true;
      $("tabbtn-" + t).className = "tab";
    });
    fire("tab", name);
    window.scrollTo(0, 0);
  };
})();

/* ---------- Setup checklist ---------- */
function runDoctor() {
  var box = $("doctor");
  box.innerHTML = "";
  box.appendChild(el("div", "empty", "Checking this computer\u2026"));
  $("doctorBtn").disabled = true;
  fetch("/api/doctor").then(function (r) { return r.json(); }).then(function (d) {
    box.innerHTML = "";
    var missing = 0;
    var list = el("div", "checks");
    var ICON = {
      ok:  '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
      bad: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
      opt: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>'
    };
    var firstMissing = true;
    (d.checks || []).forEach(function (c) {
      var kind = c.ok ? "ok" : c.optional ? "opt" : "bad";
      if (kind === "bad") missing++;
      // One line: state, name, version or reason, the word. Everything else opens on click.
      var row = el("div", "check2 " + kind);
      var mark = el("span", "cmark"); mark.innerHTML = ICON[kind];
      row.appendChild(mark);
      row.appendChild(el("span", "cname", c.label));
      row.appendChild(el("span", "cdet", c.ok ? (c.detail || "") : ""));
      row.appendChild(el("span", "cstate", c.ok ? "Ready" : c.optional ? "Optional" : (c.detail || "Missing")));
      var chev = el("span", "cchev"); chev.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>';
      var more = el("div", "cmore"), inner = el("div", "");
      if (c.fix) inner.appendChild(el("p", "", c.fix));
      var acts = el("div", "cacts");
      // The first thing that is missing gets the screen's one gold button; the others are ordinary buttons
      var lead = kind === "bad" && firstMissing && (c.action === "adb" || c.action === "connect");
      if (c.action === "adb") {
        var ab = el("button", "btn" + (lead ? " solid" : ""), "Install phone tools");
        var msg = el("span", "fhint", "");
        ab.onclick = function () { installPhoneTools(ab, msg); };
        acts.appendChild(ab); acts.appendChild(msg);
      }
      if (c.action === "android") {
        var ib = el("button", "btn", "Install virtual-device tools\u2026");
        ib.onclick = installAndroid;
        acts.appendChild(ib);
      }
      if (c.action === "connect") {
        var cb = el("button", "btn" + (lead ? " solid" : ""), "Connect device");
        cb.onclick = function () { Connect.open(); };
        acts.appendChild(cb);
      }
      if (c.link) {
        var a = el("a", "", "Open instructions");
        a.href = c.link; a.target = "_blank"; a.rel = "noopener noreferrer";
        acts.appendChild(a);
      }
      if (acts.childNodes.length) inner.appendChild(acts);
      var hasMore = inner.childNodes.length > 0;
      if (hasMore) { more.appendChild(inner); row.appendChild(chev); row.appendChild(more); }
      else { row.appendChild(el("span", "")); row.style.cursor = "default"; }
      if (lead) firstMissing = false;
      if (kind === "bad" && hasMore) row.classList.add("open");        // what is missing explains itself; the rest stays one line
      row.setAttribute("role", "button"); row.tabIndex = hasMore ? 0 : -1;
      row.setAttribute("aria-expanded", row.classList.contains("open") ? "true" : "false");
      function toggle(e) {
        if (!hasMore || (e.target.closest && e.target.closest("button, a"))) return;
        row.classList.toggle("open");
        row.setAttribute("aria-expanded", row.classList.contains("open") ? "true" : "false");
      }
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target === row) { e.preventDefault(); toggle(e); } });
      list.appendChild(row);
    });
    box.appendChild(list);
    $("doctorSum").textContent = missing ? missing + " item(s) need attention before you can record." : "Everything needed is ready.";
    $("doctorSum").className = "status " + (missing ? "bad" : "good");
  }).catch(function () {
    box.innerHTML = "";
    box.appendChild(el("div", "empty", "Could not run the checks. Reload Understudy."));
  }).finally(function () { $("doctorBtn").disabled = false; });
}

hooks.tab.push(function (name) { if (name === "setup" && !runDoctor.done) { runDoctor.done = true; runDoctor(); } });

/* ---------- Phone tools (adb, ~8 MB, into Understudy's folder) ---------- */
function installPhoneTools(btn, msg) {
  btn.disabled = true; msg.textContent = " Downloading\u2026";
  fetch("/api/adb/install", { method: "POST" }).then(function (r) { return r.json(); }).then(function () {
    var t = setInterval(function () {
      fetch("/api/adb/status").then(function (r) { return r.json(); }).then(function (s) {
        if (s.state === "downloading") msg.textContent = " Downloading\u2026 " + (s.got / 1048576).toFixed(1) + (s.total ? " of " + (s.total / 1048576).toFixed(1) : "") + " MB";
        else if (s.state === "unpacking") msg.textContent = " Unpacking\u2026";
        else if (s.state === "done") { clearInterval(t); toast("Phone tools installed.", "ok"); runDoctor(); }
        else if (s.state === "error") { clearInterval(t); btn.disabled = false; msg.textContent = " " + s.error; }
      }).catch(function () {});
    }, 600);
  }).catch(function () { btn.disabled = false; msg.textContent = " Could not start the download."; });
}

/* ---------- Virtual-device tools installer (optional, ~1.5 GB) ---------- */
function installAndroid() {
  modal({ title: "Install virtual-device tools?", text: "Only needed to test without a phone. A PowerShell window opens and downloads about 1.5 GB from Google's official server: the emulator and one system image. It then creates a light virtual device called Understudy_Pixel. Keep that window open until it says Finished, then restart Understudy.", ok: "Install" })
    .then(function (v) {
      if (!v) return;
      fetch("/api/setup/android", { method: "POST" }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.error) toast(d.error, "err"); else toast("The installer window is open.", "ok");
      }).catch(function () { toast("Could not open the installer.", "err"); });
    });
}

/* ---------- Quit ---------- */
function quitApp() {
  modal({ title: "Quit Understudy?", text: "Running virtual devices stay open. You can close them from Android Studio or start Understudy again later.", ok: "Quit" })
    .then(function (v) {
      if (!v) return;
      fetch("/api/shutdown", { method: "POST" }).then(function (r) {
        if (r.status === 409) { toast("A run is in progress. Stop it first.", "err"); return; }
        document.body.innerHTML = "";
        var bye = el("div", "bye");
        bye.appendChild(el("h2", "", "Understudy has stopped."));
        bye.appendChild(el("p", "", "You can close this window. Open Understudy from its shortcut to start again."));
        document.body.appendChild(bye);
        setTimeout(function () { window.close(); }, 800);
      }).catch(function () {});
    });
}
