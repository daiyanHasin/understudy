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
    (d.checks || []).forEach(function (c) {
      if (!c.ok && !c.optional) missing++;
      var row = el("div", "check " + (c.ok ? "ok" : c.optional ? "opt" : "bad"));
      var mark = el("span", "mark", c.ok ? "\u2713" : c.optional ? "\u2013" : "\u2717");
      mark.setAttribute("aria-label", c.ok ? "Ready" : c.optional ? "Optional" : "Needs attention");
      row.appendChild(mark);
      var body = el("div", "cbody");
      var head = el("div", "chead2");
      head.appendChild(el("b", "", c.label));
      if (c.detail) head.appendChild(el("span", "dim", c.detail));
      body.appendChild(head);
      if (c.fix) body.appendChild(el("div", "fix", c.fix));
      if (c.action === "adb") {
        var ab = el("button", "btn solid", "Install phone tools");
        var msg = el("span", "fhint", "");
        ab.onclick = function () { installPhoneTools(ab, msg); };
        body.appendChild(ab); body.appendChild(msg);
      }
      if (c.action === "android") {
        var ib = el("button", "btn", "Install virtual-device tools\u2026");
        ib.onclick = installAndroid;
        body.appendChild(ib);
      }
      if (c.action === "connect") {
        var cb = el("button", "btn", "Connect device");
        cb.onclick = function () { Connect.open(); };
        body.appendChild(cb);
      }
      if (c.link) {
        var a = el("a", "", "Open instructions");
        a.href = c.link; a.target = "_blank"; a.rel = "noopener noreferrer";
        body.appendChild(a);
      }
      row.appendChild(body);
      box.appendChild(row);
    });
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
