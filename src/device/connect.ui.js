/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Connect a device.
   - Phone tools (adb) missing: one button installs them (about 8 MB)
   - Every device adb sees is listed with what to do next, including
     phones waiting for "Allow USB debugging?" (they used to be hidden)
   - USB: watches for a phone and picks it as soon as it is ready
   - Wi-Fi: pair by scanning a QR code (lib/pairing.js), or with a
     6-digit code; "Check connection" says in plain words why a phone
     can't be reached (lib/wifi.js)
   - Phone animations off while recording (checkbox, lib/animations.js)
   - Virtual device: start / clean state / free memory
   Device text is always set with textContent.
   ============================================================ */

var Connect = (function () {
  var C = { open: false, timer: null, seen: null, qrTimer: null, toolsTimer: null, which: "usb", last: null };

  function api(url, body) {
    var o = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || "Request failed"); return d; });
    });
  }

  var STATES = {
    device:       { label: "Ready",                    cls: "ok" },
    unauthorized: { label: "Waiting for permission",   cls: "warn", tip: "Unlock the phone and tap Allow on \u201CAllow USB debugging?\u201D" },
    authorizing:  { label: "Waiting for permission",   cls: "warn", tip: "Unlock the phone and tap Allow on \u201CAllow USB debugging?\u201D" },
    offline:      { label: "Offline",                  cls: "bad",  tip: "Unplug the cable and plug it in again. For Wi-Fi, turn Wireless debugging off and on." },
    nopermission: { label: "No permission",            cls: "bad",  tip: "This PC can't open the USB device. On Linux, add a udev rule for the phone." },
    connecting:   { label: "Connecting\u2026",         cls: "warn" },
    booting:      { label: "Starting\u2026",           cls: "warn" }
  };

  function deviceName(d) { return d.avd ? d.avd.replace(/_/g, " ") : (d.model || d.serial); }
  function transport(d) { return d.emulator ? "Virtual device" : d.wifi ? "Wi-Fi" : "USB"; }

  /* ---------- Open / close ---------- */
  function open(which) {
    var ov = $("connectOv");
    ov.hidden = false;
    requestAnimationFrame(function () { ov.classList.add("show"); });
    C.open = true; C.seen = null;
    tab(which || C.which);
    var anim = $("cdAnimOff"); if (anim && window.Rec && Rec.animPref) anim.checked = Rec.animPref();
    var addr = $("recAddr"); if (addr && !addr.value) addr.value = localStorage.getItem("us.wifiAddr") || "";
    poll();
    clearInterval(C.timer);
    C.timer = setInterval(poll, 1500);
    document.addEventListener("keydown", onKey);
  }
  function close() {
    var ov = $("connectOv");
    ov.classList.remove("show");
    setTimeout(function () { ov.hidden = true; }, 160);
    C.open = false;
    clearInterval(C.timer); C.timer = null;
    stopQr();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(); }

  function tab(which) {
    C.which = which;
    ["usb", "wifi", "avd"].forEach(function (k) {
      $("cdp-" + k).hidden = k !== which;
      var b = $("cdt-" + k); b.classList.toggle("active", k === which); b.setAttribute("aria-selected", k === which);
    });
    if (which !== "wifi") stopQr();
  }

  /* ---------- Device list ---------- */
  function poll() {
    if (!C.open) return;
    api("/api/device/list").then(function (d) {
      if (!C.open) return;
      C.last = d;
      $("cdTools").hidden = !(d.adb && d.adb.ok === false);
      render(d);
      // Virtual devices
      var hasAvd = (d.avds || []).length > 0;
      $("cdAvdBox").hidden = !hasAvd; $("cdNoAvd").hidden = hasAvd;
      // A device that became ready while the dialog is open: use it right away
      var ready = (d.devices || []).filter(function (x) { return x.state === "device" && (x.booted || !x.emulator); });
      if (C.seen === null) { C.seen = {}; ready.forEach(function (x) { C.seen[x.serial] = true; }); return; }
      var fresh = ready.filter(function (x) { return !C.seen[x.serial]; })[0];
      ready.forEach(function (x) { C.seen[x.serial] = true; });
      if (fresh) use(fresh.serial, deviceName(fresh));
    }).catch(function () {});
  }

  function render(d) {
    var box = $("cdDevices"); box.innerHTML = "";
    var list = d.devices || [];
    var watch = $("cdUsbWatch");
    var waiting = list.filter(function (x) { return !x.wifi && (x.state === "unauthorized" || x.state === "authorizing"); });
    watch.className = "cd-watch" + (waiting.length ? " warn" : list.some(function (x) { return x.state === "device" && !x.emulator && !x.wifi; }) ? " ok" : "");
    watch.querySelector("span").textContent = waiting.length ? "A phone is connected. Unlock it and tap Allow on the screen."
      : list.some(function (x) { return x.state === "device" && !x.emulator && !x.wifi; }) ? "Phone connected by USB."
      : "Watching for a phone\u2026 plug it in now.";
    if (!list.length) return;
    box.appendChild(el("div", "cd-label", "Devices this PC can see"));
    var cur = window.Rec ? Rec.serial() : "";
    list.forEach(function (x) {
      var st = x.state === "device" && x.emulator && !x.booted ? STATES.booting : (STATES[x.state] || { label: x.state, cls: "bad" });
      var row = el("div", "cd-dev" + (x.serial === cur ? " cur" : ""));
      var info = el("div", "cd-devinfo");
      info.appendChild(el("b", "", deviceName(x)));
      info.appendChild(el("span", "", transport(x) + "  \u00b7  " + x.serial));
      var tip = x.wifi && (x.state === "unauthorized" || x.state === "authorizing") ? "Pair this phone first: Wi-Fi tab \u203a Show pairing code" : st.tip;
      if (tip) info.appendChild(el("em", "", tip));
      row.appendChild(info);
      row.appendChild(el("span", "badge " + st.cls, st.label));
      if (x.state === "device" && (x.booted || !x.emulator)) {
        var b = el("button", "btn" + (x.serial === cur ? "" : " solid"), x.serial === cur ? "In use" : "Use");
        b.disabled = x.serial === cur;
        b.onclick = function () { use(x.serial, deviceName(x)); };
        row.appendChild(b);
      }
      box.appendChild(row);
    });
  }

  function use(serial, name) {
    if (window.Rec) Rec.useDevice(serial);
    toast((name || serial) + " is connected.", "ok");
    setTimeout(close, 500);
  }

  /* ---------- Phone tools (adb) ---------- */
  function installTools(onDone) {
    var bar = $("cdToolsBar"), msg = $("cdToolsMsg"), btn = $("cdToolsBtn");
    btn.disabled = true; bar.hidden = false; msg.textContent = "Downloading from dl.google.com\u2026";
    return api("/api/adb/install", {}).then(function () {
      return new Promise(function (resolve, reject) {
        clearInterval(C.toolsTimer);
        C.toolsTimer = setInterval(function () {
          api("/api/adb/status").then(function (s) {
            var pct = s.total ? Math.round(s.got / s.total * 100) : 0;
            bar.firstElementChild.style.width = (s.state === "unpacking" || s.state === "done" ? 100 : pct) + "%";
            if (s.state === "downloading") msg.textContent = "Downloading\u2026 " + (s.got / 1048576).toFixed(1) + (s.total ? " of " + (s.total / 1048576).toFixed(1) : "") + " MB";
            else if (s.state === "unpacking") msg.textContent = "Unpacking\u2026";
            else if (s.state === "done") {
              clearInterval(C.toolsTimer); msg.textContent = "Phone tools installed."; btn.disabled = false;
              toast("Phone tools installed. Plug in a phone or pair one over Wi-Fi.", "ok");
              poll(); if (window.Rec) Rec.refreshDevices(); resolve(s); if (onDone) onDone(s);
            } else if (s.state === "error") {
              clearInterval(C.toolsTimer); btn.disabled = false; bar.hidden = true;
              msg.textContent = s.error + ". Check the internet connection and try again.";
              reject(new Error(s.error));
            }
          }).catch(function () {});
        }, 600);
      });
    }).catch(function (e) { btn.disabled = false; msg.textContent = e.message; throw e; });
  }

  /* ---------- Wi-Fi: QR pairing ---------- */
  function startQr() {
    var box = $("cdQr"), st = $("cdQrState");
    box.innerHTML = ""; box.appendChild(el("div", "qrwait", "Making a code\u2026"));
    api("/api/pair/start", {}).then(function (d) {
      box.innerHTML = d.svg;                        // generated on this PC by lib/qr.js: only <rect>/<path>
      var again = el("button", "btn quiet qragain", "New code"); again.onclick = startQr; box.appendChild(again);
      st.hidden = false; setQrState("wait", "Waiting for the phone to scan\u2026");
      clearInterval(C.qrTimer);
      C.qrTimer = setInterval(pollQr, 1000);
    }).catch(function (e) {
      box.innerHTML = ""; var b = el("button", "btn solid", "Show pairing code"); b.onclick = startQr; box.appendChild(b);
      toast(e.message, "err");
    });
  }
  function pollQr() {
    api("/api/pair/status").then(function (s) {
      if (s.state === "idle") { clearInterval(C.qrTimer); return; }
      if (s.state === "waiting") {
        setQrState(s.hint ? "warn" : "wait", (s.hint ? s.hint + "  " : "Waiting for the phone to scan\u2026 ") +
          "(" + Math.floor(s.left / 60) + ":" + ("0" + s.left % 60).slice(-2) + ")");
        if (s.hint) $("cdManual").open = true;
      }
      else if (s.state === "pairing" || s.state === "connecting") setQrState("wait", s.message);
      else if (s.state === "connected") { clearInterval(C.qrTimer); setQrState("ok", "Connected."); use(s.serial, "Phone"); }
      else if (s.state === "error") {
        clearInterval(C.qrTimer); setQrState("bad", s.message);
        $("cdManual").open = true;
      }
    }).catch(function () {});
  }
  function setQrState(kind, text) {
    var st = $("cdQrState"); st.className = "cd-watch " + (kind === "wait" ? "" : kind); st.querySelector("span").textContent = text;
  }
  function stopQr() {
    if (!C.qrTimer && $("cdQrState").hidden) return;
    clearInterval(C.qrTimer); C.qrTimer = null;
    api("/api/pair/stop", {}).catch(function () {});
    var box = $("cdQr"); box.innerHTML = "";
    var b = el("button", "btn solid", "Show pairing code"); b.onclick = startQr; box.appendChild(b);
    $("cdQrState").hidden = true;
  }

  /* ---------- Wi-Fi: why can't this PC reach the phone? ---------- */
  function checkWifi() {
    var addr = $("recAddr").value.trim(), what = "connect";
    if (!addr && $("recPairAddr").value.trim()) { addr = $("recPairAddr").value.trim(); what = "pair"; }
    var box = $("cdWifiMsg");
    function show(kind, text) { box.hidden = false; box.className = "cd-watch" + (kind ? " " + kind : ""); box.querySelector("span").textContent = text; }
    if (!addr) { show("bad", "Enter the IP address and port shown on the phone first."); return; }
    show("", "Checking " + addr + "\u2026");
    api("/api/device/wifi-check", { address: addr, what: what }).then(function (d) {
      var pcs = (d.networks || []).filter(function (n) { return !n.virtual; }).map(function (n) { return n.address; }).join(", ");
      show(d.ok ? "ok" : "bad", d.message + (d.ok ? (what === "pair" ? " Enter the code and press Connect." : " Press Connect.") : "") +
           (pcs ? "  (This PC: " + pcs + ")" : ""));
    }).catch(function (e) { show("bad", e.message); });
  }
  function setAnimPref(on) { if (window.Rec && Rec.setAnimPref) Rec.setAnimPref(on); }

  return { open: open, close: close, tab: tab, installTools: installTools, startQr: startQr, refresh: poll,
           checkWifi: checkWifi, setAnimPref: setAnimPref,
           isOpen: function () { return C.open; } };
})();
