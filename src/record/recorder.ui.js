/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Record tab.
   - Device: choose, start, connect over Wi-Fi, disconnect, clean state
   - Modes: Record (click the screen here), From device (tap on the
     phone or emulator window itself), Add check, Just use
   - Steps: change type and target, nested Repeat / If / Retry blocks
   - Flow panel: YAML is editable and syncs back into the steps
   - Typed values: exact text, or test data in a chosen Excel file/sheet
   Uses helpers from app.js: $, el, toast, modal, hooks, loadFlows,
   startRun, showTab. Device text is always set with textContent.
   ============================================================ */

var Rec = (function () {
  var S = {
    serial: localStorage.getItem("us.serial") || "",
    mode: "record", steps: [], picked: {}, data: null,
    dirty: false, previewTimer: null, busy: false,
    streaming: false, dw: 0, dh: 0, streamErr: 0, ctx: null,
    field: null, bootPoll: null, capTimer: null, capQueue: [], capBusy: false,
    lastChoice: localStorage.getItem("us.valueMode") || "data",
    frameGen: 0, frames: 0, fpsAt: 0, watch: null, pinned: null, layout: null, screenSeq: 0, layoutTimer: null, env: {},
    hoverNode: null, lastPoll: 0, animDone: {}, menu: null
  };

  /* ---------- helpers ---------- */
  function api(url, body) {
    var o = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || ("Request failed (" + r.status + ")")); e.status = r.status; e.code = d.code; throw e; }
        return d;
      });
    });
  }
  function opt(sel, value, label) { var o = document.createElement("option"); o.value = value; o.textContent = label; sel.appendChild(o); return o; }
  function appId() { return $("recApp").value.trim(); }
  function safeName(s, fb) { var v = String(s || "").replace(/[^A-Za-z0-9_-]/g, ""); return v || fb; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function closeMenus() { document.querySelectorAll("details.menu[open]").forEach(function (d) { d.open = false; }); }
  function flowBase() { return $("recFlow").value.trim().split("/").pop().replace(/\.ya?ml$/i, "").replace(/[^A-Za-z0-9_-]/g, "_"); }
  function defaultBook() { return safeName(cap(appId().split(".").pop()), "App") + "Data"; }

  /* ---------- steps tree helpers ---------- */
  // Paths: "2" = third step, "2.0" = first step inside it, "2.e0" = first step of its else part
  function listAtPath(parent, elsePart) {   // the list a row lives in
    var list = S.steps;
    if (!parent) return list;
    parent.split(".").forEach(function (seg) {
      var isElse = seg.charAt(0) === "e", blk = list[+seg.replace("e", "")];
      list = isElse ? blk.elseSteps : blk.steps;
    });
    return list;
  }
  function parentPath(p) { var a = p.split("."); a.pop(); return a.join("."); }
  function lastIndex(p) { return +p.split(".").pop().replace("e", ""); }
  function walk(list, fn) { list.forEach(function (s) { fn(s); if (s.type === "block") { walk(s.steps, fn); walk(s.elseSteps || [], fn); } }); }
  function dataSteps() { var out = []; walk(S.steps, function (s) { if (s.type === "input" && s.mode === "data") out.push(s); }); return out; }
  function addStep(step) { S.steps.push(step); renderSteps(); }

  /* ======================= Devices ======================= */
  var WAIT_TEXT = {
    unauthorized: "Unlock the phone and tap Allow on \u201CAllow USB debugging?\u201D",
    authorizing:  "Unlock the phone and tap Allow on \u201CAllow USB debugging?\u201D",
    offline:      "The phone is offline. Unplug the cable and plug it in again.",
    nopermission: "This PC has no permission to open the phone over USB."
  };
  function devLabel(x) {
    var name = x.avd ? x.avd.replace(/_/g, " ") : (x.model || x.serial);
    return name + "  \u00b7  " + (x.emulator ? "virtual" : x.wifi ? "Wi-Fi" : "USB");
  }
  function refreshDevices() {
    return api("/api/device/list").then(function (d) {
      var sel = $("recDevice"); sel.innerHTML = "";
      var ready = d.devices.filter(function (x) { return x.state === "device"; });
      var waiting = d.devices.filter(function (x) { return x.state !== "device"; });
      if (!ready.length) opt(sel, "", waiting.length ? "Phone needs attention" : "No device");
      ready.forEach(function (x) { opt(sel, x.serial, devLabel(x) + (x.booted ? "" : "  (starting\u2026)")); });
      waiting.forEach(function (x) { var o = opt(sel, "", devLabel(x) + "  (" + (x.state === "unauthorized" ? "tap Allow on the phone" : x.state) + ")"); o.disabled = true; });
      if (!ready.some(function (x) { return x.serial === S.serial; })) S.serial = ready.length ? ready[0].serial : "";
      sel.value = S.serial;
      var avd = $("recAvd"), keep = avd.value; avd.innerHTML = "";
      if (!d.avds.length) opt(avd, "", "None installed");
      d.avds.forEach(function (a) { opt(avd, a, a.replace(/_/g, " ")); });
      if (keep) avd.value = keep;

      var cur = ready.filter(function (x) { return x.serial === S.serial; })[0];
      $("recDisconnect").disabled = !cur;
      $("recDisconnect").hidden = !cur || (!cur.emulator && !cur.wifi);      // USB phones: unplug the cable
      $("recDisconnect").textContent = cur && cur.emulator ? "Stop" : "Disconnect";
      $("recDot").className = "ldot" + (cur ? (cur.booted ? " on" : " boot") : waiting.length ? " warn" : "");
      showProblem(d.problems || {});
      if (cur) setStage(cur.booted ? "live" : "booting");
      else if (d.adb && d.adb.ok === false) setStage("empty", "Install the phone tools to connect a device (about 8 MB, no Android Studio).");
      else if (waiting.length) setStage("waiting", WAIT_TEXT[waiting[0].state] || "The device is not ready yet.");
      else setStage("empty");
      if (cur && cur.booted) { loadPackages(); startStream(); }
      watchDevices(!cur || !cur.booted);
      return d;
    }).catch(function (e) { setStage("empty", e.message); watchDevices(true); });
  }
  // While no device is ready, keep looking: plugging in a phone (or tapping Allow) is picked up by itself
  function watchDevices(on) {
    clearTimeout(S.watch);
    if (!on || $("tab-record").hidden) return;
    S.watch = setTimeout(function () {
      if ($("tab-record").hidden || (window.Connect && Connect.isOpen())) return watchDevices(true);
      refreshDevices();
    }, 2500);
  }
  function useDevice(serial) {
    if (!serial) return;
    stopStream(); S.layout = null; closeMenu();
    S.serial = serial; localStorage.setItem("us.serial", serial);
    if (S.mode === "device") setMode("record");
    refreshDevices();
  }

  function showProblem(problems) {
    var box = $("recProblemDev"), name = $("recAvd").value, p = problems[name];
    if (!p || S.serial) { box.hidden = true; return; }
    box.innerHTML = "";
    box.appendChild(el("b", "", name.replace(/_/g, " ") + " closed while starting."));
    box.appendChild(el("div", "", " Try Graphics: compatible in Add device, or turn on virtualization (see Setup). Full log: " + p.log));
    box.appendChild(el("pre", "", p.lines));
    box.hidden = false;
  }

  function chooseDevice() {
    stopStream(); S.layout = null; closeMenu();
    S.serial = $("recDevice").value;
    localStorage.setItem("us.serial", S.serial);
    if (S.mode === "device") setMode("record");
    refreshDevices();
  }

  function startAvd() {
    var name = $("recAvd").value;
    if (!name) { toast("No virtual device installed. Use Install virtual-device tools.", "err"); return; }
    closeMenus(); if (window.Connect) Connect.close();
    $("recStartAvd").disabled = true;
    api("/api/device/start", { avd: name, headless: !$("recWindow").checked, graphics: $("recGfx").value, light: $("recLight").checked }).then(function () {
      setStage("booting");
      $("recDot").className = "ldot boot";
      toast("Starting " + name.replace(/_/g, " ") + ". The first start can take a minute or two.");
      var tries = 0;
      clearInterval(S.bootPoll);
      S.bootPoll = setInterval(function () {
        tries++;
        api("/api/device/list").then(function (d) {
          var up = d.devices.filter(function (x) { return x.emulator && x.state === "device" && x.avd === name; })[0];
          var prob = (d.problems || {})[name];
          if (up && up.booted) {
            stopBoot(); S.serial = up.serial; localStorage.setItem("us.serial", S.serial);
            toast(name.replace(/_/g, " ") + " is ready.", "ok"); refreshDevices();
          } else if (prob && !up) {
            stopBoot(); setStage("empty", "The virtual device closed while starting.");
            S.serial = ""; showProblem(d.problems);
          } else if (tries > 120) {
            stopBoot(); setStage("empty", "The virtual device did not start in 4 minutes. Check Setup.");
          }
        }).catch(function () {});
      }, 2000);
    }).catch(function (e) { $("recStartAvd").disabled = false; toast(e.message, "err"); });
  }
  function stopBoot() { clearInterval(S.bootPoll); $("recStartAvd").disabled = false; }

  function disconnect() {
    if (!S.serial) return;
    stopCapture();
    stopStream();
    delete S.animDone[S.serial];
    api("/api/device/stop", { serial: S.serial }).then(function (d) {
      S.streaming = false; toast(d && d.freed ? "Virtual device stopped and its memory freed." : "Device disconnected.");
      S.serial = ""; setTimeout(refreshDevices, 1200);
    }).catch(function (e) { toast(e.message, "err"); });
  }

  function connectWifi() {
    var body = { address: $("recAddr").value.trim() };
    var code = $("recPairCode").value.trim();
    if (code) { body.code = code; body.pairAddress = $("recPairAddr").value.trim(); }
    if (!body.address && !code) { wifiMsg("bad", "Enter the connection IP:port, or the pairing IP:port and code."); return; }
    wifiMsg("", code ? "Pairing\u2026 keep the pairing window open on the phone." : "Connecting\u2026");
    api("/api/device/connect", body).then(function (d) {
      closeMenus(); $("recPairCode").value = "";
      var addr = d.address || body.address;
      if (addr) { $("recAddr").value = addr; localStorage.setItem("us.wifiAddr", addr); }
      wifiMsg("ok", "Connected" + (addr ? " to " + addr : "") + ".");
      toast("Phone connected over Wi-Fi.", "ok");
      if (window.Connect) Connect.close();
      setTimeout(function () { useDevice(addr); }, 300);
    }).catch(function (e) {
      // Paired but the connection address is still needed: keep the dialog open on that field
      wifiMsg("bad", e.message);
      if (/^Paired/.test(e.message)) { $("recPairCode").value = ""; $("recAddr").focus(); }
    });
  }
  function wifiMsg(kind, text) {
    var box = $("cdWifiMsg"); if (!box) { if (kind === "bad") toast(text, "err"); return; }
    box.hidden = !text; box.className = "cd-watch" + (kind ? " " + kind : "");
    box.querySelector("span").textContent = text;
  }

  function snapshot(action) {
    if (!S.serial || !/^emulator-/.test(S.serial)) { toast("Start a virtual device first. Clean state works on virtual devices only.", "err"); return; }
    closeMenus();
    toast(action === "save" ? "Saving clean state\u2026" : "Going back to the clean state\u2026");
    api("/api/device/snapshot", { serial: S.serial, action: action }).then(function () {
      toast(action === "save" ? "Clean state saved." : "Back to the clean state.", "ok");
    }).catch(function (e) { toast(e.message, "err"); });
  }

  function loadPackages() {
    if (!S.serial) return;
    api("/api/device/apps?serial=" + encodeURIComponent(S.serial)).then(function (d) {
      S.apps = d.apps;
      var dl = $("recPkgs"); dl.innerHTML = "";
      d.apps.forEach(function (a) { opt(dl, a.id, a.user ? a.id : a.id + "  (system)"); });
    }).catch(function () {});
  }

  /* Apps installed on the device: pick one for this flow, or switch to it inside the flow */
  function pickApp(asStep) {
    if (!S.serial) { toast("Connect a device first.", "err"); return; }
    var sh = dialogShell(asStep ? "Switch to another app" : "Apps on the device");
    sh.okText = asStep ? "Add step and open it" : "Use this app";
    sh.dlg.appendChild(el("p", "datanote", asStep ? "Adds an \u201COpen app\u201D step (the current app keeps running) and opens the app now, so you can keep recording in it."
                                                : "Apps already on the phone. No APK needed."));
    var q = document.createElement("input"); q.type = "text"; q.placeholder = "Search apps\u2026"; q.className = "valueinput";
    var box = el("div", "applist"); var picked = null;
    var sys = el("label", "opt inline"); var sysb = document.createElement("input"); sysb.type = "checkbox";
    sys.appendChild(sysb); sys.appendChild(document.createTextNode(" Show system apps (Chrome, Settings, Camera \u2026)"));
    sh.dlg.appendChild(q); sh.dlg.appendChild(sys); sh.dlg.appendChild(box);
    function paint() {
      box.innerHTML = "";
      var t = q.value.trim().toLowerCase();
      (S.apps || []).filter(function (a) { return (sysb.checked || a.user || asStep) && (!t || a.id.toLowerCase().indexOf(t) >= 0); }).slice(0, 300).forEach(function (a) {
        var b = el("button", "appitem" + (picked === a.id ? " on" : ""));
        b.appendChild(el("b", "", a.id.split(".").slice(-1)[0])); b.appendChild(el("span", "", a.id + (a.user ? "" : "  \u00b7 system")));
        b.onclick = function (e) { e.preventDefault(); picked = a.id; paint(); };
        box.appendChild(b);
      });
      if (!box.children.length) box.appendChild(el("div", "empty", S.apps ? "No app matches." : "Reading the app list\u2026"));
    }
    q.oninput = paint; sysb.onchange = paint;
    if (!S.apps) api("/api/device/apps?serial=" + encodeURIComponent(S.serial)).then(function (d) { S.apps = d.apps; paint(); }).catch(function (e) { box.textContent = e.message; });
    paint();
    openDialog(sh, function () {
      if (!picked) throw new Error("Choose an app");
      return picked;
    }, function (id) {
      if (!id) return;
      if (asStep) {
        addStep({ type: "openApp", appId: id, clearState: false, stopApp: false });
        api("/api/app/launch", { serial: S.serial, package: id, clearState: false }).catch(function (e) { toast(e.message, "err"); });
      } else { $("recApp").value = id; schedulePreview(); }
    }, q);
  }

  function usbToWifi() {
    closeMenus();
    if (!S.serial || /:|^emulator-/.test(S.serial)) { toast("Choose a phone connected by USB first.", "err"); return; }
    toast("Switching to Wi-Fi\u2026 keep the cable in until it says connected.");
    stopStream();
    wifiMsg("", "Switching to Wi-Fi\u2026 keep the cable in.");
    api("/api/device/wifi", { serial: S.serial }).then(function (d) {
      wifiMsg("ok", "Connected over Wi-Fi at " + d.address + ".");
      toast("Connected over Wi-Fi at " + d.address + ". You can unplug the cable now.", "ok");
      if (window.Connect) Connect.close();
      useDevice(d.address);
    }).catch(function (e) { wifiMsg("bad", e.message); toast(e.message, "err"); refreshDevices(); });
  }

  function freeMemory() {
    closeMenus();
    api("/api/system/processes").then(function (d) {
      var sh = dialogShell("Free memory");
      sh.okText = "End selected";
      if (!d.groups.length) sh.dlg.appendChild(el("p", "datanote", "No emulator, adb or Android Studio is running. Nothing to free."));
      var boxes = {};
      d.groups.forEach(function (g) {
        var row = el("label", "opt memrow"); var cb = document.createElement("input"); cb.type = "checkbox";
        cb.checked = g.kind === "emulator"; boxes[g.kind] = cb;
        row.appendChild(cb);
        row.appendChild(el("b", "", g.label));
        row.appendChild(el("span", "dim", g.count + " process" + (g.count > 1 ? "es" : "") + " \u00b7 " + (g.mem / 1073741824).toFixed(2) + " GB"));
        sh.dlg.appendChild(row);
      });
      sh.dlg.appendChild(el("p", "datanote", "Android Studio: save your work there first. Virtual devices lose unsaved state. Phones are not affected."));
      openDialog(sh, function () { return Object.keys(boxes).filter(function (k) { return boxes[k].checked; }); }, function (kinds) {
        if (!kinds || !kinds.length) return;
        stopStream();
        api("/api/system/free", { kinds: kinds }).then(function (r) {
          toast(r.ended.length ? "Ended " + r.ended.length + " program(s)." : "Nothing needed ending.", "ok");
          setTimeout(refreshDevices, 1000);
        }).catch(function (e) { toast(e.message, "err"); });
      });
    }).catch(function (e) { toast(e.message, "err"); });
  }

  // Flow variables: the env: block of the flow, used as ${NAME}
  function editVars() {
    var sh = dialogShell("Flow variables");
    sh.okText = "Save";
    sh.dlg.appendChild(el("p", "datanote", "One per line as NAME=value. Use them in any step as ${NAME}. Maestro can also override them when running."));
    var ta = document.createElement("textarea"); ta.className = "yaml small"; ta.rows = 6; ta.spellcheck = false;
    ta.value = Object.keys(S.env || {}).map(function (k) { return k + "=" + S.env[k]; }).join("\n");
    sh.dlg.appendChild(ta);
    openDialog(sh, function () {
      var out = {};
      ta.value.split(/\r?\n/).forEach(function (line) {
        if (!line.trim()) return;
        var i = line.indexOf("=");
        var k = (i < 0 ? line : line.slice(0, i)).trim(), v = i < 0 ? "" : line.slice(i + 1).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k)) throw new Error("Bad name: " + k + " (letters, numbers and _)");
        out[k] = v;
      });
      return out;
    }, function (v) { if (v) { S.env = v; renderSteps(); } }, ta);
  }

  /* ---------- APKs (copied into the local Apps/ folder only) ---------- */
  function loadApks(select) {
    return api("/api/apk/list").then(function (d) {
      var sel = $("recApk"); sel.innerHTML = "";
      if (!d.apks.length) opt(sel, "", "No APK added");
      d.apks.forEach(function (a) { var o = opt(sel, a.name, a.name); o.title = (a.size / 1048576).toFixed(1) + " MB"; });
      if (select) sel.value = select;
      sel.classList.toggle("empty", !d.apks.length);
      $("recApkDel").disabled = $("recInstall").disabled = !d.apks.length;
    }).catch(function () {});
  }
  function pickApk() { $("recApkFile").click(); }
  function uploadApk(file) {
    if (!file) return;
    if (!/\.apk$/i.test(file.name)) { toast("Choose an .apk file.", "err"); return; }
    toast("Adding " + file.name + "\u2026");
    fetch("/api/apk/upload?name=" + encodeURIComponent(file.name), {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Could not add the APK"); return d; }); })
      .then(function (d) {
        if (d.package) $("recApp").value = d.package;
        toast("Added " + d.name + (d.package ? ". App ID: " + d.package : "") + ". Press Install.", "ok");
        return loadApks(d.name);
      })
      .catch(function (e) { toast(e.message, "err"); })
      .finally(function () { $("recApkFile").value = ""; });
  }
  function installApk() {
    var name = $("recApk").value;
    if (!name) { toast("Add an APK first.", "err"); return; }
    if (!S.serial) { toast("Connect a device first.", "err"); return; }
    $("recInstall").disabled = true;
    toast("Installing " + name + "\u2026");
    api("/api/apk/install", { serial: S.serial, name: name }).then(function (d) {
      if (d.package) $("recApp").value = d.package;
      loadPackages(); schedulePreview();
      toast("Installed" + (d.package ? ". App ID: " + d.package : ". Pick the app ID from the list."), "ok");
    }).catch(function (e) { toast(e.message, "err"); })
      .finally(function () { $("recInstall").disabled = false; });
  }
  function deleteApk() {
    var name = $("recApk").value;
    if (!name) return;
    api("/api/apk/delete", { name: name }).then(function () {
      toast("Removed " + name + ".");
      loadApks();
    }).catch(function (e) { toast(e.message, "err"); });
  }

  function launch() {
    var id = appId();
    if (!S.serial) { toast("Connect a device first.", "err"); return; }
    if (!/^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/.test(id)) { toast("Enter the app ID, for example com.example.app", "err"); $("recApp").focus(); return; }
    var clear = $("recClear").checked;
    api("/api/app/launch", { serial: S.serial, package: id, clearState: clear }).then(function () {
      if (S.mode !== "interact") {
        S.steps = S.steps.filter(function (s) { return s.type !== "launch"; });
        S.steps.unshift({ type: "launch", clearState: clear });
        renderSteps();
      }
      if (S.mode === "device") startCapture();
    }).catch(function (e) { toast(e.message, "err"); });
  }

  /* ======================= Screen ======================= */
  function setStage(st, msg) {
    $("recStage").setAttribute("data-state", st);
    $("recEmpty").textContent = msg || (st === "booting" ? "Starting the device\u2026" : "No device connected.");
    $("recEmptyCta").textContent = st === "waiting" ? "Connection help" : "Connect a device";
  }
  /* Screen: one screenshot after another (compressed on the phone, see device/android.js). */
  function liveLabel(txt, kind) {
    $("recLiveText").textContent = txt;
    $("recLive").className = "live" + (kind ? " " + kind : "");
  }
  /* Phone animations off while recording (Add device > the checkbox at the bottom).
     The server saves the phone's own values first and puts them back on
     Disconnect and on Quit (device/animations.js). */
  function animPref() { return localStorage.getItem("us.animOff") !== "0"; }
  function applyAnimations(serial) {
    if (!serial || S.animDone[serial] || !animPref()) return;
    S.animDone[serial] = true;
    api("/api/device/animations", { serial: serial, off: true }).catch(function () { delete S.animDone[serial]; });
  }
  function setAnimPref(on) {
    localStorage.setItem("us.animOff", on ? "1" : "0");
    if (!S.serial) return;
    S.animDone = {};
    api("/api/device/animations", { serial: S.serial, off: !!on }).then(function () {
      if (on) S.animDone[S.serial] = true;
      toast(on ? "Phone animations are off while recording." : "Phone animations are back on.", "ok");
    }).catch(function (e) { toast(e.message, "err"); });
  }
  function startStream() {
    if (S.streaming || !S.serial) return;
    applyAnimations(S.serial);
    S.streaming = true; S.frames = 0; S.fpsAt = Date.now();
    liveLabel("Connecting\u2026", "wait");
    frame(++S.frameGen);
  }
  function stopStream() { S.streaming = false; S.frameGen++; liveLabel("Not connected", ""); }

  function frame(gen) {
    if (gen !== S.frameGen || !S.streaming) return;
    if (document.hidden || $("tab-record").hidden || !S.serial) { S.streaming = false; return; }
    var serial = S.serial;
    fetch("/api/device/frame?prefetch=1&serial=" + encodeURIComponent(serial), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || "No screen"); });
        var w = +r.headers.get("X-Frame-W"), h = +r.headers.get("X-Frame-H");
        S.dw = +r.headers.get("X-Device-W"); S.dh = +r.headers.get("X-Device-H");
        return r.arrayBuffer().then(function (buf) { return { w: w, h: h, buf: buf }; });
      })
      .then(function (f) {
        if (serial !== S.serial) return;
        var c = $("recScreen");
        if (c.width !== f.w || c.height !== f.h) { c.width = f.w; c.height = f.h; S.ctx = null; }
        S.ctx = S.ctx || c.getContext("2d");
        S.ctx.putImageData(new ImageData(new Uint8ClampedArray(f.buf), f.w, f.h), 0, 0);
        S.streamErr = 0; setStage("live");
        S.frames++;
        if (Date.now() - S.fpsAt > 2000) { liveLabel("Connected \u00b7 " + (S.frames * 1000 / (Date.now() - S.fpsAt)).toFixed(1) + " fps", "on"); S.frames = 0; S.fpsAt = Date.now(); }
        // No change events from screenshots: look for a new layout now and then
        if (Date.now() - S.lastPoll > 1200) { S.lastPoll = Date.now(); fetchLayout(); }
        frame(gen);
      })
      .catch(function (e) {
        S.streamErr++;
        if (S.streamErr > 3) { setStage("empty", e.message); liveLabel("No picture", "warn"); }
        setTimeout(function () { frame(gen); }, 1500);
      });
  }

  /* ---------- Every element on the screen (hover outlines) ---------- */
  function fetchLayout() {
    if (!S.serial || S.layoutBusy) return;
    S.layoutBusy = true;
    var serial = S.serial;
    api("/api/device/layout?serial=" + encodeURIComponent(serial)).then(function (d) {
      if (serial !== S.serial) return;
      if (d.seq) S.layout = { seq: d.seq, nodes: d.nodes };
      S.screenSeq = d.screenSeq;
      drawAll(); if (S.hoverAt) hoverAt(S.hoverAt.x, S.hoverAt.y);
    }).catch(function () {}).finally(function () { S.layoutBusy = false; });
  }
  function layoutFresh() { return !!(S.layout && S.layout.seq && S.layout.seq === S.screenSeq); }
  function topAt(x, y) {
    if (!S.layout) return null;
    var hit = S.layout.nodes.filter(function (n) { return x >= n.b[0] && x < n.b[2] && y >= n.b[1] && y < n.b[3]; });
    if (!hit.length) return null;
    var top = hit.reduce(function (a, n) { return (n.l || 0) > (a.l || 0) ? n : a; }, hit[0]);
    hit = hit.filter(function (n) { return (n.w || 0) === (top.w || 0); });
    hit.sort(function (a, b) { return (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]) - (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]); });
    // Prefer something with a name, as the recorder does
    for (var i = 0; i < Math.min(hit.length, 5); i++) if (hit[i].id || hit[i].t || hit[i].d || hit[i].e || hit[i].k) return hit[i];
    return hit[0];
  }
  function placeBox(elm, b) {
    var c = $("recScreen"), k = c.clientWidth / (S.dw || 1);
    elm.style.left = b[0] * k + "px"; elm.style.top = b[1] * k + "px";
    elm.style.width = Math.max(2, (b[2] - b[0]) * k) + "px"; elm.style.height = Math.max(2, (b[3] - b[1]) * k) + "px";
  }
  function hoverAt(x, y) {
    S.hoverAt = { x: x, y: y };
    var box = $("recHover"), tip = $("recTip");
    if (!$("recInspectOn").checked || !S.layout || !S.dw || S.menu) { box.hidden = tip.hidden = true; return; }
    var n = topAt(x, y);
    if (!n) { box.hidden = tip.hidden = true; return; }
    placeBox(box, n.b);
    box.classList.toggle("stale", !layoutFresh());
    box.hidden = false;
    tip.textContent = "";
    var best = selectorsFor(n)[0];
    if (best && best.kind !== "point") {
      tip.appendChild(el("b", "", best.kind === "id" ? "id" : "text"));
      tip.appendChild(el("span", "", best.kind === "id" ? best.value.split(":id/").pop() : "\u201C" + (best.value.length > 34 ? best.value.slice(0, 32) + "\u2026" : best.value) + "\u201D"));
      tip.appendChild(el("em", best.unique ? "u" : "m", best.unique ? "unique" : "\u00d7" + best.count));
    } else tip.appendChild(el("b", "", n.c));
    if (!layoutFresh()) tip.appendChild(el("i", "", "reading\u2026"));
    var c = $("recScreen"), k = c.clientWidth / S.dw;
    tip.style.left = Math.min(c.clientWidth - 10, Math.max(0, n.b[0] * k)) + "px";
    tip.style.top = Math.max(0, n.b[1] * k - 30) + "px";
    tip.hidden = false;
    if (S.hoverNode !== n) { S.hoverNode = n; showHovered(n); }
  }
  function drawAll() {
    var o = $("recOverlay"), c = $("recScreen");
    if (!c.clientWidth) return;
    o.width = c.clientWidth; o.height = c.clientHeight;
    var g = o.getContext("2d"); g.clearRect(0, 0, o.width, o.height);
    if (!$("recAllOn").checked || !S.layout || !S.dw) return;
    var k = c.clientWidth / S.dw;
    g.lineWidth = 1;
    S.layout.nodes.forEach(function (n) {
      if (!(n.k || n.e || n.id || n.t || n.d)) return;
      g.strokeStyle = n.e ? "rgba(76,195,138,.85)" : n.k ? "rgba(233,162,59,.85)" : "rgba(160,170,190,.55)";
      g.strokeRect(n.b[0] * k + .5, n.b[1] * k + .5, (n.b[2] - n.b[0]) * k - 1, (n.b[3] - n.b[1]) * k - 1);
    });
  }
  /* ---------- Inspector (Maestro Studio style) ----------
     For any element: the selectors Maestro can use, whether each one is
     unique on this screen, and the command ready to copy or add as a step. */
  function reEsc(v) { return String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function q(v) { return "\"" + String(v).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\""; }
  function selectorsFor(n) {
    if (!S.layout || !n) return [];
    var same = S.layout.nodes.filter(function (o) { return (o.w || 0) === (n.w || 0); });
    var byI = {}; same.forEach(function (o) { byI[o.i] = o; });
    function hasText(o, v) { return o.t === v || o.d === v || o.h === v; }
    // Same rules as lib/recorder.js: the deepest match counts, ordered top to bottom
    function hits(kind, value) {
      var h = same.filter(function (o) { return kind === "id" ? o.id === value : hasText(o, value); });
      var set = {}; h.forEach(function (o) { set[o.i] = true; });
      var anc = {};
      h.forEach(function (o) { var p = o.p, g = 0; while (p !== undefined && p >= 0 && g++ < 200) { if (set[p]) anc[p] = true; p = byI[p] ? byI[p].p : -1; } });
      return h.filter(function (o) { return !anc[o.i]; }).sort(function (a, b) { return a.b[1] - b.b[1] || a.b[0] - b.b[0]; });
    }
    function inside(o) { var p = o.i, g = 0; while (p !== undefined && p >= 0 && g++ < 200) { if (p === n.i) return true; p = byI[p] ? byI[p].p : -1; } return false; }
    var out = [];
    function add(kind, value, label) {
      if (!value || value.length > 120 || out.some(function (o) { return o.kind === kind && o.value === value; })) return;
      var h = hits(kind, value);
      var o = { kind: kind, value: value, unique: h.length <= 1, count: Math.max(h.length, 1), label: label };
      if (h.length > 1) { var k = -1; h.forEach(function (x, j) { if (k < 0 && inside(x)) k = j; }); if (k >= 0) o.pos = k; }
      out.push(o);
    }
    if (n.id) add("id", n.id, "ID");
    if (n.t && !n.e) add("text", n.t, "Text");
    if (n.d) add("text", n.d, "Accessibility label");
    if (n.h) add("text", n.h, "Placeholder");
    if (!out.some(function (o) { return o.unique; })) {
      var best = out.filter(function (o) { return o.pos !== undefined; })[0];
      if (best) out.push({ kind: best.kind, value: best.value, index: best.pos, unique: true, fragile: true, count: 1, label: best.label + " #" + (best.pos + 1) + " of " + best.count });
    }
    out.forEach(function (o) { delete o.pos; });
    out.sort(function (x, y) { return (x.unique ? (x.fragile ? 1 : 0) : 2) - (y.unique ? (y.fragile ? 1 : 0) : 2); });
    if (S.dw) out.push({ kind: "point", value: Math.round((n.b[0] + n.b[2]) / 2 / S.dw * 100) + "%," + Math.round((n.b[1] + n.b[3]) / 2 / S.dh * 100) + "%", unique: true, count: 1, label: "Screen position" });
    return out;
  }
  function selYaml(cmd, c) {
    if (c.kind === "point") return "- " + cmd + ":\n    point: " + q(c.value);
    if (c.kind === "text" && c.index == null) return "- " + cmd + ": " + q(reEsc(c.value));
    var y = "- " + cmd + ":\n    " + c.kind + ": " + q(reEsc(c.value));
    if (c.kind === "id" && c.text) y += "\n    text: " + q(reEsc(c.text));
    if (c.index != null) y += "\n    index: " + c.index;
    return y;
  }
  function selOf(c) {                    // the part of a candidate a step keeps
    var o = { kind: c.kind, value: c.value };
    if (c.text) o.text = c.text;
    if (c.index != null) o.index = c.index;
    return o;
  }
  function renderInspector(target, cands, pinned) {
    var box = $("recInspect"); box.innerHTML = "";
    if (!target) { box.appendChild(el("div", "empty", "No element here. Steps on this spot use the screen position.")); return; }
    var head = el("div", "ihead");
    var title = el("div", "ititle");
    title.appendChild(el("b", "", target.cls || "Element"));
    var sub = target.text || target.desc || target.placeholder || (target.idShort ? "#" + target.idShort : "");
    if (sub) title.appendChild(el("span", "", sub));
    head.appendChild(title);
    if (pinned) {
      head.appendChild(el("span", "badge spot", "Pinned"));
      var up = el("button", "btn quiet", "Unpin"); up.onclick = function () { S.pinned = null; renderInspector(null, [], false); box.firstChild.textContent = "Point at anything on the screen to see its selectors."; };
      head.appendChild(up);
    } else head.appendChild(el("span", "badge", "Under the mouse"));
    box.appendChild(head);

    box.appendChild(el("div", "isec", "Selectors"));
    cands.forEach(function (c, i) {
      var row = el("div", "isel" + (i === 0 ? " best" : ""));
      var top = el("div", "iseltop");
      top.appendChild(el("span", "ikind", c.kind === "id" ? "ID" : c.kind === "point" ? "Position" : (c.label && !/^(Text|ID)/.test(c.label) ? c.label.split(/\s{2}/)[0] : "Text")));
      top.appendChild(el("span", "badge " + (c.kind === "point" || !c.unique || c.fragile ? "warn" : "ok"),
        c.kind === "point" ? "breaks if the layout moves" : c.fragile ? "by position in the list" : c.unique ? "unique" : c.count + " matches"));
      if (i === 0 && c.kind !== "point") top.appendChild(el("span", "dim", "used when you record"));
      row.appendChild(top);
      var code = el("pre", "icode", selYaml("tapOn", c));
      row.appendChild(code);
      var acts = el("div", "iacts");
      [["Copy", function () { copyText(selYaml("tapOn", c)); }],
       ["Add tap", function () { addStep({ type: "tap", sel: selOf(c), candidates: cands }); toast("Tap step added.", "ok"); }],
       ["Add check", function () { addStep({ type: "assertVisible", sel: selOf(c), candidates: cands }); toast("Check step added.", "ok"); }]
      ].forEach(function (a) { var b = el("button", "btn", a[0]); b.onclick = a[1]; acts.appendChild(b); });
      if (c.kind === "point") acts.lastChild.disabled = true;
      row.appendChild(acts);
      box.appendChild(row);
    });
    if (cands.length && !cands[0].unique && cands[0].kind !== "point")
      box.appendChild(el("div", "fhint warnline", "No unique selector. Maestro taps the first match; add an ID to this element in the app for a reliable test."));

    var det = document.createElement("details"); det.className = "iprops";
    det.appendChild(el("summary", "", "All properties"));
    var dl = el("dl", "props");
    [["Class", target.cls], ["Resource ID", target.id], ["Text", target.text], ["Accessibility label", target.desc], ["Placeholder", target.placeholder],
     ["Clickable", target.clickable ? "yes" : ""], ["Text field", target.editable ? "yes" : ""], ["Password", target.password ? "yes" : ""],
     ["Enabled", target.enabled === false ? "no" : ""], ["App", target.pkg], ["Bounds", target.bounds ? target.bounds.join(", ") : ""]].forEach(function (r) {
      if (!r[1]) return; dl.appendChild(el("dt", "", r[0])); dl.appendChild(el("dd", "", r[1]));
    });
    det.appendChild(dl);
    box.appendChild(det);
  }
  function copyText(t) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("Copied.", "ok"); })
      .catch(function () { var ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("Copied.", "ok"); });
  }
  function nodeTarget(n) {
    return { cls: n.c, id: n.id || "", idShort: n.id ? n.id.split(":id/").pop() : "", text: n.e ? "" : n.t, desc: n.d, placeholder: n.h,
             clickable: !!n.k, editable: !!n.e, password: !!n.pw, enabled: !n.dis, pkg: n.pk, bounds: n.b };
  }
  function showHovered(n) {
    if ($("pane-el").hidden || S.pinned) return;
    renderInspector(nodeTarget(n), selectorsFor(n), false);
  }

  function toDevice(ev) {
    var c = $("recScreen"), r = c.getBoundingClientRect();
    if (!S.dw || !r.width) return null;
    var nx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), ny = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
    return { x: Math.round(nx * S.dw), y: Math.round(ny * S.dh), nx: nx, ny: ny,
             px: ev.clientX - r.left, py: ev.clientY - r.top };
  }
  function pct(x, y) { return Math.round(x / S.dw * 100) + "%," + Math.round(y / S.dh * 100) + "%"; }
  function spotlight(px, py) {
    var s = $("recSpot"); s.style.left = px + "px"; s.style.top = py + "px";
    s.classList.remove("on"); void s.offsetWidth; s.classList.add("on");
  }
  function outline(b) {
    var h = $("recBox"), c = $("recScreen");
    if (!b || !S.dw) { h.hidden = true; return; }
    var k = c.clientWidth / S.dw;
    h.style.left = b[0] * k + "px"; h.style.top = b[1] * k + "px";
    h.style.width = (b[2] - b[0]) * k + "px"; h.style.height = (b[3] - b[1]) * k + "px";
    h.hidden = false; clearTimeout(outline.t); outline.t = setTimeout(function () { h.hidden = true; }, 1600);
  }

  /* ---------- Pointer on the screen ----------
     Record: a click opens the element menu (nothing is tapped until you choose).
     Use: a click taps the phone. A drag is a swipe in both. */
  var down = null;
  function onDown(ev) {
    if (ev.button !== 0 || S.busy) return;
    var p = toDevice(ev); if (!p) return;
    ev.preventDefault();
    try { $("recScreen").setPointerCapture(ev.pointerId); } catch (_) {}
    down = { p: p, t: Date.now(), last: p };
  }
  function onMove(ev) {
    var p = toDevice(ev);
    if (!p) return;
    if (!down) { hoverAt(p.x, p.y); return; }
    down.last = p;
  }
  function onUp(ev) {
    if (!down) return;
    var p = toDevice(ev) || down.last, d = down; down = null;
    if (!p || !S.serial) return;
    if (Math.hypot(p.px - d.p.px, p.py - d.p.py) > 12) return doSwipe(d.p, p);
    spotlight(p.px, p.py);
    if (S.mode === "interact") return input({ action: Date.now() - d.t > 600 ? "longPress" : "tap", x: p.x, y: p.y });
    S.busy = true; $("recStage").classList.add("thinking");
    inspect(p, layoutFresh() ? S.layout.seq : 0).then(function (info) { openMenu(info, p); })
      .catch(function (e) { toast(e.message, "err"); })
      .finally(function () { S.busy = false; $("recStage").classList.remove("thinking"); });
  }
  function onLeave() { $("recHover").hidden = $("recTip").hidden = true; S.hoverAt = null; }

  function inspect(p, seq) {
    return api("/api/rec/inspect", { serial: S.serial, x: p.x, y: p.y, seq: seq || undefined });
  }

  /* ---------- Element menu (Maestro Studio style) ----------
     One click on an element: choose the action, how to find the element, and
     for typing, the text or Excel column right there. Nothing else to open. */
  function closeMenu() { if (S.menu) { S.menu.remove(); S.menu = null; } }
  function ensureData() {                         // where "From Excel" values go, decided once per flow
    if (S.data) return Promise.resolve(S.data);
    return api("/api/rec/datafiles").then(function (d) {
      var name = (defaultBook() + ".xlsx").toLowerCase();
      var mine = d.files.filter(function (f) { return f.usable && f.name.toLowerCase() === name; })[0];
      var sheet = safeName(flowBase(), "Data").slice(0, 31);
      S.data = mine ? { file: mine.path, sheet: sheet } : { file: "", workbook: defaultBook(), sheet: sheet };
      renderSteps();
      return S.data;
    });
  }
  function openMenu(info, p) {
    closeMenu();
    var e = info.element, cands = (info.candidates || []).filter(function (c) { return e || c.kind === "point"; });
    var cr = $("recScreen").getBoundingClientRect();
    var m = S.menu = el("div", "emenu");
    m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "What to do with this element");
    if (e) outline(e.bounds);

    var head = el("div", "em-head");
    head.appendChild(el("b", "", e ? (e.text || e.desc || e.placeholder || (e.idShort ? e.idShort : e.cls)) : "This spot"));
    head.appendChild(el("span", "", e ? e.cls + (e.editable ? " \u00b7 text field" : "") : "No element here: the step uses the screen position"));
    m.appendChild(head);

    var pick = document.createElement("select"); pick.className = "em-find"; pick.setAttribute("aria-label", "Find the element by");
    cands.forEach(function (c, i) {
      opt(pick, String(i), (c.kind === "point" ? "Position " + c.value : c.label.replace(/\s{2,}/g, "  ")) + (c.kind === "point" ? "" : c.unique ? "  \u2713 unique" : "  \u00d7" + c.count));
    });
    if (cands.length > 1) { var fb = el("label", "em-row"); fb.appendChild(el("span", "", "Find by")); fb.appendChild(pick); m.appendChild(fb); }
    function sel() { return selOf(cands[+pick.value || 0]); }

    var body = el("div", "em-acts"); body.setAttribute("role", "menu"); m.appendChild(body);
    var form = el("div", "em-form"); form.hidden = true; m.appendChild(form);
    function done(msg) { closeMenu(); if (msg) toast(msg, "ok"); }
    function act(label, key, fn, when) {
      if (when === false) return;
      var b = el("button", "em-act"); b.setAttribute("role", "menuitem");
      b.appendChild(el("span", "", label)); b.appendChild(el("kbd", "", key));
      b.onclick = fn; b.dataset.key = key.toLowerCase(); body.appendChild(b);
    }
    var tapAt = function (a) { return input({ action: a, x: p.x, y: p.y }); };
    var hasText = e && (e.text || e.desc);
    if (e && e.editable) act("Type text\u2026", "I", typeForm);
    if (cands.length) act("Tap", "T", function () { addStep({ type: "tap", sel: sel(), candidates: cands }); tapAt("tap"); done(); });
    act("Long press", "L", function () { addStep({ type: "longPress", sel: sel(), candidates: cands }); tapAt("longPress"); done(); }, cands.length > 0);
    act("Double tap", "D", function () { addStep({ type: "doubleTap", sel: sel(), candidates: cands }); tapAt("tap").then(function () { return tapAt("tap"); }); done(); }, !!e);
    if (!(e && e.editable)) act("Type text\u2026", "I", typeForm);
    act("Clear text", "E", function () { addStep({ type: "tap", sel: sel(), candidates: cands }); addStep({ type: "erase", count: 50 });
      tapAt("tap").then(function () { return input({ action: "erase", count: 50 }); }); done(); }, !!(e && e.editable));
    act("Check it is visible", "V", function () { addStep({ type: "assertVisible", sel: sel(), candidates: cands }); done("Check added."); }, !!e);
    act("Wait until it shows", "W", function () { addStep({ type: "waitUntil", sel: sel(), visible: true, timeout: 10000 }); done("Wait added."); }, !!e);
    act("Scroll until it shows", "S", function () { addStep({ type: "scrollUntilVisible", sel: sel(), candidates: cands, direction: "DOWN" }); done("Scroll added."); }, !!e);
    act("Copy its text\u2026", "C", copyForm, !!hasText);
    act("Inspect", "N", function () { showInspect(info, true); panel("el"); done(); }, !!e);
    var just = el("button", "em-quiet", "Tap without recording");
    just.onclick = function () { tapAt("tap"); done(); };
    m.appendChild(just);

    function showForm(build) { body.hidden = true; just.hidden = true; form.hidden = false; form.innerHTML = ""; build(form); }
    function typeForm() {
      showForm(function (f) {
        var t = document.createElement("input"); t.type = e && e.password ? "password" : "text";
        t.placeholder = "Text to type"; t.spellcheck = false; t.setAttribute("aria-label", "Text to type");
        var src = el("div", "em-seg"); src.setAttribute("role", "group"); src.setAttribute("aria-label", "Where the text comes from");
        var bFix = el("button", "", "This exact text"), bData = el("button", "", "From Excel");
        src.appendChild(bFix); src.appendChild(bData);
        var col = document.createElement("input"); col.className = "mono"; col.value = info.suggestedColumn || "Value";
        col.setAttribute("aria-label", "Excel column"); col.spellcheck = false;
        var colRow = el("label", "em-row"); colRow.appendChild(el("span", "", "Column")); colRow.appendChild(col);
        var note = el("div", "em-note");
        var mode = S.lastChoice === "data" ? "data" : "fixed";
        function paint() {
          bFix.classList.toggle("on", mode === "fixed"); bData.classList.toggle("on", mode === "data");
          bFix.setAttribute("aria-pressed", mode === "fixed"); bData.setAttribute("aria-pressed", mode === "data");
          colRow.hidden = mode !== "data";
          note.textContent = mode === "data" ? "Typed as ${output." + (col.value.trim() || "Column") + "}. This value becomes row 1; add rows to run with more data." : "Typed the same way on every run.";
        }
        bFix.onclick = function () { mode = "fixed"; paint(); t.focus(); };
        bData.onclick = function () { mode = "data"; paint(); col.focus(); };
        col.oninput = paint;
        var go = el("button", "btn solid", "Add and type");
        go.onclick = function () {
          var v = t.value, c = col.value.trim();
          if (!v) { t.focus(); return; }
          if (mode === "data" && !/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(c)) { note.textContent = "Column: letters, numbers and _, starting with a letter."; col.focus(); return; }
          S.lastChoice = mode; localStorage.setItem("us.valueMode", mode);
          (mode === "data" ? ensureData() : Promise.resolve()).then(function () {
            if (cands.length) addStep({ type: "tap", sel: sel(), candidates: cands });
            addStep({ type: "input", mode: mode, value: v, column: mode === "data" ? c : undefined, password: !!(e && e.password) });
            (cands.length ? tapAt("tap") : Promise.resolve()).then(function () { return input({ action: "text", text: v }); });
            done();
          }).catch(function (x) { note.textContent = x.message; });
        };
        [t, col].forEach(function (x) { x.addEventListener("keydown", function (k) { if (k.key === "Enter") { k.preventDefault(); go.click(); } }); });
        f.appendChild(t); f.appendChild(src); f.appendChild(colRow); f.appendChild(note); f.appendChild(go);
        paint(); t.focus();
      });
    }
    function copyForm() {
      showForm(function (f) {
        var n = document.createElement("input"); n.className = "mono"; n.value = suggestVar(info); n.setAttribute("aria-label", "Variable name");
        var note = el("div", "em-note", "Later steps can type it as ${output." + n.value + "}.");
        n.oninput = function () { note.textContent = "Later steps can type it as ${output." + (n.value || "Name") + "}."; };
        var go = el("button", "btn solid", "Add copy step");
        go.onclick = function () {
          if (!/^[A-Za-z_]\w{0,40}$/.test(n.value)) { note.textContent = "Variable names: letters, numbers and _."; return; }
          addStep({ type: "copyText", sel: sel(), candidates: cands, name: n.value }); done("Copy step added.");
        };
        n.addEventListener("keydown", function (k) { if (k.key === "Enter") { k.preventDefault(); go.click(); } });
        f.appendChild(n); f.appendChild(note); f.appendChild(go); n.focus(); n.select();
      });
    }
    m.addEventListener("keydown", function (k) {
      if (k.key === "Escape") { k.preventDefault(); closeMenu(); return; }
      if (k.target.tagName === "INPUT" || k.target.tagName === "SELECT" || k.ctrlKey || k.metaKey || k.altKey) return;
      var b = body.querySelector('[data-key="' + k.key.toLowerCase() + '"]');
      if (b && !body.hidden) { k.preventDefault(); b.click(); }
      else if (k.key === "ArrowDown" || k.key === "ArrowUp") {
        var all = [].slice.call(body.querySelectorAll(".em-act")), i = all.indexOf(document.activeElement);
        k.preventDefault(); all[(i + (k.key === "ArrowDown" ? 1 : all.length - 1)) % all.length].focus();
      }
    });
    document.body.appendChild(m);
    // Beside the click, free to float over the steps panel; flips left or up near the window edges
    var x = cr.left + p.px + 16, y = cr.top + p.py - 24;
    if (x + m.offsetWidth > innerWidth - 8) x = cr.left + p.px - m.offsetWidth - 16;
    m.style.left = Math.max(8, x) + "px";
    m.style.top = Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) + "px";
    var first = body.querySelector(".em-act"); if (first) first.focus();
  }
  // "Type" under the screen: text for whatever field has focus on the phone
  function typeAny() {
    if (!S.serial) { toast("Connect a device first.", "err"); return; }
    var r = $("recScreen").getBoundingClientRect();
    openMenu({ element: null, candidates: [] }, { x: 0, y: 0, px: r.width / 2 - 140, py: r.height * 0.35 });
    S.menu.querySelector('[data-key="i"]').click();
  }

  function suggestVar(info) {
    var e = info.element || {};
    var base = (e.idShort || e.text || e.desc || "Copied").replace(/^(tv|txt|lbl|text)[_-]?/i, "");
    var w = base.split(/[^A-Za-z0-9]+|(?=[A-Z][a-z])/).filter(Boolean).slice(0, 3)
      .map(function (x) { return x.charAt(0).toUpperCase() + x.slice(1).toLowerCase(); }).join("");
    if (!/^[A-Za-z_]/.test(w)) w = "Copied" + w;
    return w.slice(0, 40) || "Copied";
  }

  function input(body) {
    body.serial = S.serial;
    return api("/api/device/input", body).catch(function (e) { toast(e.message, "err"); throw e; });
  }

  function doSwipe(a, b) {
    if (!S.serial) return;
    if (S.mode !== "interact") addStep({ type: "swipe", from: pct(a.x, a.y), to: pct(b.x, b.y) });
    input({ action: "swipe", x1: a.x, y1: a.y, x2: b.x, y2: b.y, ms: 300 }).catch(function () {});
  }

  function nav(kind) {
    if (!S.serial) { toast("Connect a device first.", "err"); return; }
    var rec = S.mode !== "interact";
    if (kind === "recents") { input({ action: "key", key: "recents" }).catch(function () {}); return; }
    if (kind === "back" || kind === "enter" || kind === "home") {
      if (rec) addStep({ type: "key", key: kind });
      input({ action: "key", key: kind }).catch(function () {});
    } else if (kind === "hideKeyboard") {
      if (rec) addStep({ type: "hideKeyboard" });
      input({ action: "hideKeyboard" }).catch(function () {});
    } else if (kind === "scroll") {
      if (rec) addStep({ type: "scroll" });
      var w = S.dw || 1080, h = S.dh || 2000;
      input({ action: "swipe", x1: w / 2, y1: h * 0.7, x2: w / 2, y2: h * 0.3, ms: 400 }).catch(function () {});
    }
  }

  /* ======================= Inserting and wrapping ======================= */
  function blockTemplate(kind, steps) {
    var b = { type: "block", kind: kind === "ifExpr" ? "if" : kind, steps: steps || [] };
    if (kind === "repeat") b.times = 3;
    if (kind === "retry") b.times = 3;
    if (kind === "while") { b.visible = true; b.sel = { kind: "text", value: "Change me", exact: false }; }
    if (kind === "if") { b.cond = "visible"; b.visible = true; b.sel = { kind: "text", value: "Change me", exact: false }; b.elseSteps = []; }
    if (kind === "ifExpr") { b.cond = "expr"; b.expr = (knownVars()[0] ? "output." + knownVars()[0] : "output.Role") + " == 'admin'"; b.elseSteps = []; }
    return b;
  }

  /* Small dialogs (app.js modal) */
  function askText(title, label, value, hint) {
    return modal({ title: title, text: hint || "", fields: [{ id: "v", label: label, value: value || "" }], ok: "OK" })
      .then(function (v) { return v ? v.v : null; });
  }
  function askFields(title, hint, fields) { return modal({ title: title, text: hint || "", fields: fields, ok: "Add step" }); }

  // Every variable the flow knows: flow variables, set / copied ones, test data columns
  function knownVars() {
    var out = [];
    Object.keys(S.env || {}).forEach(function (k) { out.push(k); });
    walk(S.steps, function (s) {
      if ((s.type === "setVar" || s.type === "copyText") && s.name && out.indexOf(s.name) < 0) out.push(s.name);
      if (s.type === "input" && s.mode === "data" && s.column && out.indexOf(s.column) < 0) out.push(s.column);
    });
    return out;
  }
  function varRef(name) { return (S.env && name in S.env) ? name : "output." + name; }

  function insert(kind) {
    closeMenus();
    var map = { wait: { type: "wait" }, hideKeyboard: { type: "hideKeyboard" }, back: { type: "key", key: "back" },
                enter: { type: "key", key: "enter" }, scroll: { type: "scroll" }, erase: { type: "erase", count: 50 },
                screenshot: { type: "screenshot", name: "step_" + (S.steps.length + 1) }, paste: { type: "paste" },
                airplaneOn: { type: "airplane", on: true }, airplaneOff: { type: "airplane", on: false },
                recStart: { type: "record", action: "start", name: "recording" }, recStop: { type: "record", action: "stop" } };
    if (map[kind]) return addStep(map[kind]);
    var app = appId();
    switch (kind) {
      case "setVar":
        return askFields("Set a variable", "Use it later as ${output.NAME}. A value that starts with = is a JavaScript expression, e.g. =Number(output.Count) + 1",
          [{ id: "name", label: "Name", value: "MyValue" }, { id: "value", label: "Value", value: "" }]).then(function (v) {
            if (!v) return;
            var expr = v.value.charAt(0) === "=";
            addStep({ type: "setVar", name: v.name, mode: expr ? "expr" : "text", value: expr ? v.value.slice(1) : v.value });
          });
      case "typeVar": {
        var vars = knownVars();
        return modal({ title: "Type a variable", text: vars.length ? "Known: " + vars.join(", ") : "Set or copy a variable first, or add flow variables.",
          fields: [{ id: "v", label: "Variable", value: vars[0] || "", list: vars }], ok: "Add step" }).then(function (v) {
            if (!v || !v.v) return;
            addStep({ type: "input", mode: "var", ref: /\./.test(v.v) ? v.v : varRef(v.v), value: "" });
          });
      }
      case "assertTrue":
        return askText("Check a condition", "JavaScript condition", knownVars()[0] ? "output." + knownVars()[0] + " != ''" : "output.Total > 0",
          "The test fails here if the condition is false.").then(function (v) { if (v) addStep({ type: "assertTrue", expr: v }); });
      case "waitUntil":
        return askFields("Wait until something shows", "Waits up to the time given (default 10 s) instead of failing at once.",
          [{ id: "text", label: "Text on screen (or an ID)", value: "" }, { id: "timeout", label: "Seconds", value: "10" }]).then(function (v) {
            if (!v || !v.text) return;
            addStep({ type: "waitUntil", sel: { kind: /:id\//.test(v.text) ? "id" : "text", value: v.text }, visible: true, timeout: Math.round((+v.timeout || 10) * 1000) });
          });
      case "key":
        return modal({ title: "Press a key", fields: [{ id: "k", label: "Key", value: "backspace", list: ["back", "enter", "home", "tab", "backspace", "power", "lock", "volumeUp", "volumeDown"] }], ok: "Add step" })
          .then(function (v) { if (v && v.k) addStep({ type: "key", key: v.k }); });
      case "openApp":
        return pickApp(true);
      case "stopApp": case "clearState":
        return askText(kind === "stopApp" ? "Stop an app" : "Clear an app's data", "App ID (empty = the flow's app)", "", "").then(function (v) {
          if (v === null) return; addStep({ type: kind, appId: v });
        });
      case "openLink":
        return askFields("Open a link", "Opens in the app that handles it, or in the browser.", [{ id: "url", label: "Address", value: "https://" }, { id: "b", label: "Force the browser? (yes / no)", value: "no" }])
          .then(function (v) {
            if (!v || !v.url) return;
            addStep({ type: "openLink", url: v.url, browser: /^y/i.test(v.b) });
            if (S.serial) api("/api/device/openlink", { serial: S.serial, url: v.url }).catch(function (e) { toast(e.message, "err"); });
          });
      case "runFlowFile": {
        var paths = (typeof flows !== "undefined" ? flows : []).map(function (f) { return f.path; });
        return modal({ title: "Run another flow", text: "Path relative to this flow's folder (e.g. common/login.yaml or ../Login/login.yaml).",
          fields: [{ id: "f", label: "Flow file", value: "", list: paths }], ok: "Add step" }).then(function (v) { if (v && v.f) addStep({ type: "runFlowFile", file: v.f }); });
      }
      case "runScriptFile":
        return askText("Run a JavaScript file", "File (relative to this flow)", "../scripts/helper.js").then(function (v) { if (v) addStep({ type: "runScriptFile", file: v }); });
      case "setLocation":
        return askFields("Set GPS location", "", [{ id: "lat", label: "Latitude", value: "23.8103" }, { id: "lon", label: "Longitude", value: "90.4125" }])
          .then(function (v) { if (v) addStep({ type: "setLocation", lat: +v.lat, lon: +v.lon }); });
    }
    addStep(blockTemplate(kind));
    toast("Block added. Tick steps and use the bar above to move them in, or edit it in the Flow panel.");
  }
  function selectedPaths() { return Object.keys(S.picked).filter(function (k) { return S.picked[k]; }); }
  function wrap(kind) {
    var paths = selectedPaths();
    if (!paths.length) return;
    var parent = parentPath(paths[0]);
    if (!paths.every(function (p) { return parentPath(p) === parent; })) { toast("Pick steps at the same level to put them in a block.", "err"); return; }
    var list = listAtPath(parent);
    var idx = paths.map(lastIndex).sort(function (a, b) { return a - b; });
    var moved = idx.map(function (i) { return list[i]; });
    for (var i = idx.length - 1; i >= 0; i--) list.splice(idx[i], 1);
    list.splice(idx[0], 0, blockTemplate(kind, moved));
    S.picked = {}; renderSteps();
  }
  function deleteSelected() {
    var paths = selectedPaths().sort(function (a, b) { return b.localeCompare(a, undefined, { numeric: true }); });
    paths.forEach(function (p) { listAtPath(parentPath(p)).splice(lastIndex(p), 1); });
    S.picked = {}; renderSteps();
  }

  /* ======================= Test data target ======================= */
  function dataLabel(d) {
    if (!d) return "";
    return (d.file || ("TestData/" + d.workbook + ".xlsx  (new)")) + "  \u203a  " + d.sheet;
  }

  // Excel file + sheet chooser used in the value dialog and in Change
  function dataEditor(box, initial) {
    var cur = initial ? JSON.parse(JSON.stringify(initial)) : null;
    var files = [], sheets = [], columns = [];
    var grid = el("div", "datagrid");
    var fWrap = el("label", "field"), sWrap = el("label", "field");
    fWrap.appendChild(el("span", "flabel", "Excel file"));
    sWrap.appendChild(el("span", "flabel", "Sheet"));
    var fSel = document.createElement("select"), sSel = document.createElement("select");
    var fNew = document.createElement("input"), sNew = document.createElement("input");
    fNew.type = sNew.type = "text"; fNew.placeholder = "New file name"; sNew.placeholder = "New sheet name";
    fNew.spellcheck = sNew.spellcheck = false;
    fWrap.appendChild(fSel); fWrap.appendChild(fNew); sWrap.appendChild(sSel); sWrap.appendChild(sNew);
    grid.appendChild(fWrap); grid.appendChild(sWrap); box.appendChild(grid);
    var note = el("div", "datanote"); box.appendChild(note);
    var onCols = function () {};

    function paint() {
      fNew.hidden = fSel.value !== "__new";
      sNew.hidden = sSel.value !== "__new";
      note.textContent = fSel.value === "__new" ? "A new Excel file is created in TestData/ when you save."
        : sSel.value === "__new" ? "A new sheet is added to this file when you save."
        : "New columns are added to this sheet. Row 1 keeps any value it already has.";
    }
    function loadSheets() {
      sSel.innerHTML = ""; columns = [];
      if (fSel.value === "__new") { opt(sSel, "__new", "New sheet\u2026"); sSel.value = "__new"; paint(); onCols(columns); return Promise.resolve(); }
      return api("/api/rec/sheets?file=" + encodeURIComponent(fSel.value)).then(function (d) {
        sheets = d.sheets;
        sheets.forEach(function (s) { opt(sSel, s.name, s.name); });
        opt(sSel, "__new", "New sheet\u2026");
        if (cur && cur.file === fSel.value && sheets.some(function (s) { return s.name === cur.sheet; })) sSel.value = cur.sheet;
        else if (sheets.some(function (s) { return s.name === flowBase(); })) sSel.value = flowBase();
        else sSel.value = "__new";
        pickCols(); paint();
      }).catch(function (e) { note.textContent = e.message; });
    }
    function pickCols() {
      var sh = sheets.filter(function (s) { return s.name === sSel.value; })[0];
      columns = sh ? sh.columns : []; onCols(columns);
    }
    fSel.onchange = function () { loadSheets(); };
    sSel.onchange = function () { pickCols(); paint(); };
    if (!sNew.value) sNew.value = safeName(flowBase(), "Data").slice(0, 31);
    fNew.value = (cur && !cur.file && cur.workbook) || defaultBook();
    if (cur && !cur.file && cur.sheet) sNew.value = cur.sheet;

    var ready = api("/api/rec/datafiles").then(function (d) {
      files = d.files.filter(function (f) { return f.usable; });
      files.forEach(function (f) { opt(fSel, f.path, f.path.replace(/^TestData\//, "")); });
      opt(fSel, "__new", "New file\u2026");
      // Default: the file chosen before, else <App>Data.xlsx if it exists, else a new file
      var mine = files.filter(function (f) { return f.name.toLowerCase() === (defaultBook() + ".xlsx").toLowerCase(); })[0];
      fSel.value = cur && cur.file && files.some(function (f) { return f.path === cur.file; }) ? cur.file : (mine ? mine.path : "__new");
      return loadSheets();
    });

    return {
      ready: ready,
      onColumns: function (fn) { onCols = fn; fn(columns); },
      get: function () {
        var file = fSel.value === "__new" ? "" : fSel.value;
        var sheet = sSel.value === "__new" ? sNew.value.trim() : sSel.value;
        if (!file && !/^[A-Za-z0-9_-]{1,60}$/.test(fNew.value.trim())) throw new Error("New file name: letters, numbers, - and _");
        if (!sheet || (sSel.value === "__new" && !/^[A-Za-z0-9_-]{1,31}$/.test(sheet))) throw new Error("Sheet name: letters, numbers, - and _ (31 max)");
        return file ? { file: file, sheet: sheet } : { file: "", workbook: fNew.value.trim(), sheet: sheet };
      }
    };
  }

  function dialogShell(title) {
    var ov = el("div", "overlay"), dlg = el("div", "dialog valuedlg");
    dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true");
    dlg.appendChild(el("h3", "", title));
    ov.appendChild(dlg);
    return { ov: ov, dlg: dlg };
  }
  function openDialog(sh, onSubmit, onClose, focusEl) {
    var err = el("div", "derr"); sh.dlg.appendChild(err);
    var bar = el("div", "dbar");
    var cancel = el("button", "btn", "Cancel"), ok = el("button", "btn solid", sh.okText || "OK");
    bar.appendChild(cancel); bar.appendChild(ok); sh.dlg.appendChild(bar);
    function close(v) {
      document.removeEventListener("keydown", onkey, true);
      sh.ov.classList.remove("show"); setTimeout(function () { sh.ov.remove(); }, 200);
      onClose(v);
    }
    function submit() { try { close(onSubmit()); } catch (e) { err.textContent = e.message; } }
    function onkey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(null); }
      else if (e.key === "Enter" && e.target.tagName !== "SELECT" && e.target.tagName !== "BUTTON" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); e.stopPropagation(); submit(); }
    }
    cancel.onclick = function () { close(null); };
    ok.onclick = submit;
    sh.ov.onclick = function (e) { if (e.target === sh.ov) close(null); };
    document.addEventListener("keydown", onkey, true);
    document.body.appendChild(sh.ov);
    requestAnimationFrame(function () { sh.ov.classList.add("show"); if (focusEl) { focusEl.focus(); if (focusEl.select) focusEl.select(); } else ok.focus(); });
    return { ok: ok, err: err };
  }

  function chooseData() {
    var sh = dialogShell("Where should test data go?");
    sh.okText = "Use this";
    sh.dlg.appendChild(el("p", "datanote", "All data-driven values in this flow use one sheet. Each row of the sheet is one test run."));
    var ed = dataEditor(sh.dlg, S.data);
    openDialog(sh, function () { return ed.get(); }, function (v) { if (v) { S.data = v; renderSteps(); } });
  }

  /* ---------- Value dialog: exact text or test data ---------- */
  function askValue(value, o) {
    o = o || {};
    return new Promise(function (resolve) {
      var used = {};
      dataSteps().forEach(function (s) { if (!(s.column in used)) used[s.column] = s.value; });
      var suggested = o.column || "Value";
      if (used[suggested] !== undefined && used[suggested] !== value) { var i = 2; while (used[suggested + i] !== undefined) i++; suggested += i; }

      var sh = dialogShell(o.title || "How should this value be used?");
      sh.okText = "Use it";
      var valIn = null;
      if (o.needsValue) {
        sh.dlg.appendChild(el("div", "datanote", o.password ? "Hidden text can't be read from the screen. Enter the value that was typed:" : "The typed text could not be read. Enter it:"));
        valIn = document.createElement("input"); valIn.type = o.password ? "password" : "text"; valIn.className = "valueinput"; valIn.value = value || "";
        sh.dlg.appendChild(valIn);
      } else {
        sh.dlg.appendChild(el("div", "valueshow", o.password ? "\u2022".repeat(Math.min(String(value).length, 12)) : value));
      }
      var mode = S.lastChoice;
      var choices = el("div", "choices");
      var cData = el("button", "choice"), cFixed = el("button", "choice");
      cData.appendChild(el("b", "", "Read from test data")); cData.appendChild(el("span", ""));
      cFixed.appendChild(el("b", "", "Use this exact text")); cFixed.appendChild(el("span", "", "Typed the same way every run."));
      var vars = knownVars();
      var cVar = el("button", "choice");
      cVar.appendChild(el("b", "", "Use a variable")); cVar.appendChild(el("span", "", vars.length ? "Type a value copied or set earlier, or a flow variable." : "Set or copy a variable first (Insert \u203a Variables)."));
      cVar.disabled = !vars.length;
      choices.appendChild(cData); choices.appendChild(cFixed); choices.appendChild(cVar); sh.dlg.appendChild(choices);
      choices.classList.add("three");
      var varBox = el("label", "field"); varBox.appendChild(el("span", "flabel", "Variable"));
      var varSel = document.createElement("select"); vars.forEach(function (v) { opt(varSel, varRef(v), v); });
      varBox.appendChild(varSel); sh.dlg.appendChild(varBox);

      var dataBox = el("div", "");
      var colWrap = el("label", "field");
      colWrap.appendChild(el("span", "flabel", "Column"));
      var col = document.createElement("input"); col.type = "text"; col.value = suggested; col.setAttribute("autocomplete", "off");
      var dl = document.createElement("datalist"); dl.id = "recColList" + Date.now(); col.setAttribute("list", dl.id);
      colWrap.appendChild(col); colWrap.appendChild(dl);
      dataBox.appendChild(colWrap);

      var where = el("div", "");
      var colNote = el("div", "datanote");
      var ed = null;
      var sheetCols = [];
      function showEditor() {
        where.innerHTML = "";
        ed = dataEditor(where, S.data);
        ed.onColumns(function (cols) {
          sheetCols = cols; dl.innerHTML = "";
          cols.forEach(function (c) { opt(dl, c, c); });
          paint();
        });
      }
      if (S.data) {
        var line = el("div", "dataline");
        line.appendChild(el("span", "flabel", "Saved to"));
        line.appendChild(el("span", "", dataLabel(S.data)));
        var ch = el("button", "btn mini", "Change"); ch.onclick = function (e) { e.preventDefault(); showEditor(); };
        line.appendChild(ch); where.appendChild(line);
        api("/api/rec/sheets?file=" + encodeURIComponent(S.data.file || "")).then(function (d) {
          var s = d.sheets.filter(function (x) { return x.name === S.data.sheet; })[0];
          sheetCols = s ? s.columns : []; sheetCols.forEach(function (c) { opt(dl, c, c); }); paint();
        }).catch(function () {});
      } else showEditor();
      dataBox.appendChild(where);
      dataBox.appendChild(colNote);
      sh.dlg.appendChild(dataBox);

      function paint() {
        cData.classList.toggle("on", mode === "data"); cFixed.classList.toggle("on", mode === "fixed"); cVar.classList.toggle("on", mode === "var");
        varBox.hidden = mode !== "var";
        cData.setAttribute("aria-pressed", mode === "data"); cFixed.setAttribute("aria-pressed", mode === "fixed");
        dataBox.hidden = mode !== "data";
        var c = col.value.trim() || "Column";
        cData.querySelector("span").textContent = "The flow uses ${output." + c + "} and the value goes into Excel. Add rows later to run with more data.";
        colNote.textContent = sheetCols.indexOf(c) >= 0 ? "This column already exists in the sheet. Its row 1 value is kept if it has one."
          : (used[c] !== undefined ? "Already used earlier in this flow: the same value will be reused." : "");
      }
      cData.onclick = function () { mode = "data"; paint(); col.focus(); };
      cFixed.onclick = function () { mode = "fixed"; paint(); };
      cVar.onclick = function () { mode = "var"; paint(); };
      col.oninput = paint;
      paint();

      openDialog(sh, function () {
        var v = valIn ? valIn.value : value;
        if (mode === "data") {
          var c = col.value.trim();
          if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(c)) throw new Error("Column: letters, numbers and _, starting with a letter (e.g. Email, Phone_2).");
          if (used[c] !== undefined && used[c] !== v) throw new Error(c + " already holds a different value in this flow. Choose another column.");
          if (ed) S.data = ed.get();
          S.lastChoice = "data"; localStorage.setItem("us.valueMode", "data");
          return { mode: "data", column: c, value: v };
        }
        if (mode === "var") return { mode: "var", ref: varSel.value, value: v };
        S.lastChoice = "fixed"; localStorage.setItem("us.valueMode", "fixed");
        return { mode: "fixed", value: v };
      }, function (r) { resolve(r); }, valIn || (mode === "data" ? col : null));
    });
  }

  /* ======================= Capture from the device ======================= */
  function startCapture() {
    if (!S.serial) { toast("Connect a device first.", "err"); setMode("record"); return; }
    if (!/^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/.test(appId())) { toast("Enter the app ID first. Only taps in that app are kept.", "err"); setMode("record"); return; }
    api("/api/capture/start", { serial: S.serial, appId: appId(), follow: $("recFollow").checked }).then(function () {
      clearInterval(S.capTimer);
      S.capTimer = setInterval(pollCapture, 700);
      $("recModeHint").textContent = "Use the phone or the emulator window. Only taps in " + appId() + " are kept; the keyboard and other apps are ignored.";
    }).catch(function (e) { toast(e.message, "err"); setMode("record"); });
  }
  function stopCapture() {
    clearInterval(S.capTimer); S.capTimer = null;
    if (!S.serial) return Promise.resolve();
    return api("/api/capture/stop", { serial: S.serial }).then(function (d) { handleCaptured(d.events || []); }).catch(function () {});
  }
  function pollCapture() {
    api("/api/capture/poll?serial=" + encodeURIComponent(S.serial)).then(function (d) {
      if (d.error) { toast(d.error, "err"); setMode("record"); return; }
      handleCaptured(d.events || []);
      if (d.active) $("recModeHint").textContent = "Watching " + appId() + (d.typing ? ". Typing\u2026 tap the next thing when done." : ".") +
        (d.discarded ? "  " + d.discarded + " touches outside the app ignored." : "");
    }).catch(function () {});
  }
  function handleCaptured(events) {
    events.forEach(function (e) {
      if (e.type === "swipe") addStep({ type: "swipe", from: e.from, to: e.to });
      else if (e.type === "openApp") { addStep({ type: "openApp", appId: e.appId, clearState: false, stopApp: false }); toast("Switched to " + e.appId + ": added an Open app step."); }
      else if (e.type === "tap" || e.type === "longPress") {
        addStep({ type: e.type, sel: e.info.candidates[0], candidates: e.info.candidates, unsure: e.unsure });
        if (e.info.element) showInspect(e.info);
      } else if (e.type === "input") {
        // Ask how to use each typed value, one at a time
        var step = { type: "input", mode: S.lastChoice, value: e.value, column: e.column, password: e.password, pending: true };
        addStep(step);
        S.capQueue.push({ step: step, e: e });
      }
    });
    nextCaptured();
  }
  function nextCaptured() {
    if (S.capBusy || !S.capQueue.length) return;
    S.capBusy = true;
    var item = S.capQueue.shift();
    askValue(item.e.value, { column: item.e.column, password: item.e.password, needsValue: item.e.needsValue,
                             title: "Typed on the device: how should it be used?" }).then(function (c) {
      var s = item.step;
      delete s.pending;
      if (c) { s.mode = c.mode; s.value = c.value; s.column = c.column; }
      else { s.mode = "fixed"; }
      renderSteps();
      S.capBusy = false; nextCaptured();
    });
  }

  /* ======================= Element panel ======================= */
  function showInspect(info, pin) {
    var e = info.element;
    if (pin) S.pinned = info;
    if (S.pinned && !pin) return;
    renderInspector(e ? { cls: e.cls, id: e.id, idShort: e.idShort, text: e.text, desc: e.desc, placeholder: e.placeholder, editable: e.editable,
                          password: e.password, enabled: e.enabled, pkg: e.pkg, bounds: e.bounds } : null, info.candidates || [], !!pin);
  }
  function panel(which) {
    ["steps", "flow", "el", "ai"].forEach(function (k) {
      $("pane-" + k).hidden = which !== k;
      $("ptab-" + k).classList.toggle("active", which === k);
    });
    if (which === "ai" && window.AI) AI.render();
  }

  /* ======================= Steps list ======================= */
  var TYPE_NAMES = { tap: "Tap", doubleTap: "Double tap", longPress: "Long press", assertVisible: "Check visible",
    assertNotVisible: "Check not visible", scrollUntilVisible: "Scroll until visible" };
  var OTHER_NAMES = { launch: "Launch app", input: "Type", swipe: "Swipe", scroll: "Scroll down", erase: "Clear text",
    key: "Press", hideKeyboard: "Hide keyboard", wait: "Wait for animations", screenshot: "Screenshot", raw: "Custom step",
    openApp: "Switch to app", stopApp: "Stop app", killApp: "Kill app", clearState: "Clear app data", openLink: "Open link",
    setVar: "Set variable", copyText: "Copy text into", paste: "Paste", assertTrue: "Check that", waitUntil: "Wait until visible",
    runFlowFile: "Run flow", runScriptFile: "Run script", setLocation: "Location", airplane: "Airplane mode", record: "Screen recording" };
  // Simple text fields edited in place: [property, placeholder, width]
  var FIELDS = {
    openApp: [["appId", "com.android.chrome", 200]], stopApp: [["appId", "app ID (empty = this app)", 200]],
    clearState: [["appId", "app ID (empty = this app)", 200]], killApp: [["appId", "app ID (empty = this app)", 200]],
    openLink: [["url", "https://", 240]], setVar: [["name", "Name", 110], ["value", "value or expression", 170]],
    assertTrue: [["expr", "output.Total > 0", 240]], runFlowFile: [["file", "common/login.yaml", 220]],
    runScriptFile: [["file", "../scripts/x.js", 220]], setLocation: [["lat", "lat", 90], ["lon", "lon", 90]],
    record: [["name", "name", 120]]
  };
  var BLOCK_NAMES = { repeat: "Repeat", while: "Repeat while", if: "If", retry: "Retry" };

  function targetEditor(s, onchange) {
    var box = el("div", "");
    if (s.candidates && s.candidates.length > 1) {
      var sel = document.createElement("select"); sel.className = "rsel";
      s.candidates.forEach(function (c, k) {
        var o = opt(sel, String(k), c.label + (c.unique ? "" : "  (" + c.count + " matches)"));
        if (c.kind === s.sel.kind && c.value === s.sel.value && (c.text || "") === (s.sel.text || "") && (c.index == null ? s.sel.index == null : c.index === s.sel.index)) o.selected = true;
      });
      opt(sel, "custom", "Edit target\u2026");
      sel.onchange = function () {
        if (sel.value === "custom") { delete s.candidates; renderSteps(); return; }
        s.sel = s.candidates[+sel.value]; onchange();
      };
      box.appendChild(sel);
      if (s.sel && s.sel.unique === false) box.appendChild(el("div", "rwarn", "Matches more than one element. Pick another target if the wrong one is used."));
      else if (s.sel && s.sel.fragile) box.appendChild(el("div", "rwarn", "Found by its position in a list (index). Fine for fixed lists; ask the developers for an ID if the list changes."));
    } else {
      var row = el("div", "selrow");
      var kind = document.createElement("select");
      [["id", "ID"], ["text", "Text"], ["point", "Position"]].forEach(function (k) { opt(kind, k[0], k[1]); });
      kind.value = s.sel.kind;
      var val = document.createElement("input"); val.type = "text"; val.className = "rval"; val.value = s.sel.value; val.spellcheck = false;
      kind.onchange = function () { s.sel = { kind: kind.value, value: val.value, exact: s.sel.exact }; onchange(); };
      val.onchange = function () { s.sel = { kind: kind.value, value: val.value, exact: s.sel.exact }; onchange(); };
      row.appendChild(kind); row.appendChild(val); box.appendChild(row);
    }
    if (s.unsure) box.appendChild(el("div", "rwarn", "The screen was still changing when this was tapped. Check the target."));
    return box;
  }

  function stepRow(s, path, list, idx) {
    var row = el("div", "rstep" + (S.picked[path] ? " sel" : ""));
    var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!S.picked[path];
    cb.setAttribute("aria-label", "Select step " + path);
    cb.onchange = function () { S.picked[path] = cb.checked; renderSteps(); };
    row.appendChild(cb);
    row.appendChild(el("span", "n", path.split(".").map(function (x) { return (x.charAt(0) === "e" ? "e" : "") + (+x.replace("e", "") + 1); }).join(".")));
    var body = el("div", "rbody"), head = el("div", "rhead");
    body.appendChild(head);

    if (s.type === "copyText" || s.type === "waitUntil") {
      head.appendChild(el("span", "rtitle", OTHER_NAMES[s.type]));
      if (s.type === "copyText") {
        var vn = document.createElement("input"); vn.type = "text"; vn.className = "rval small"; vn.value = s.name || ""; vn.placeholder = "variable";
        vn.onchange = function () { s.name = vn.value.trim(); schedulePreview(); };
        head.appendChild(vn);
        head.appendChild(el("span", "dim", "\u2190 text of"));
      } else {
        var tw = document.createElement("input"); tw.type = "number"; tw.min = 1; tw.max = 600; tw.className = "small"; tw.value = Math.round((s.timeout || 10000) / 1000);
        tw.onchange = function () { s.timeout = Math.max(1, +tw.value || 10) * 1000; schedulePreview(); };
        head.appendChild(el("span", "dim", "up to")); head.appendChild(tw); head.appendChild(el("span", "dim", "s"));
      }
      body.appendChild(targetEditor(s, renderSteps));
    } else if (s.sel && TYPE_NAMES[s.type]) {
      var ts = document.createElement("select"); ts.className = "rtype"; ts.setAttribute("aria-label", "Step type");
      Object.keys(TYPE_NAMES).forEach(function (k) { opt(ts, k, TYPE_NAMES[k]); });
      opt(ts, "__type", "+ Type text after this\u2026");
      ts.value = s.type;
      ts.onchange = function () {
        if (ts.value === "__type") {
          ts.value = s.type;
          var v = window.prompt("Text to type after this step:");
          if (v) askValue(v, { column: "Value" }).then(function (c) {
            if (c) { list.splice(idx + 1, 0, { type: "input", mode: c.mode, value: c.value, column: c.column }); renderSteps(); }
          });
          return;
        }
        s.type = ts.value;
        if (s.type === "scrollUntilVisible" && !s.direction) s.direction = "DOWN";
        renderSteps();
      };
      head.appendChild(ts);
      body.appendChild(targetEditor(s, renderSteps));
    } else if (s.type === "block") {
      head.appendChild(el("span", "rtitle", BLOCK_NAMES[s.kind]));
      var bp = el("div", "bparams");
      if (s.kind === "if") {
        var cs = document.createElement("select");
        opt(cs, "visible", "this is visible"); opt(cs, "notVisible", "this is not visible"); opt(cs, "expr", "this condition is true");
        cs.value = s.cond || (s.visible === false ? "notVisible" : "visible");
        cs.onchange = function () {
          s.cond = cs.value;
          if (s.cond === "expr") { s.expr = s.expr || (knownVars()[0] ? "output." + knownVars()[0] + " == ''" : "output.Role == 'admin'"); delete s.sel; }
          else { s.visible = s.cond === "visible"; s.sel = s.sel || { kind: "text", value: "Change me", exact: false }; }
          renderSteps();
        };
        bp.appendChild(el("span", "dim", "when")); bp.appendChild(cs);
        if (s.cond === "expr") {
          var ex = document.createElement("input"); ex.type = "text"; ex.className = "rval"; ex.value = s.expr || ""; ex.spellcheck = false;
          ex.title = "JavaScript, e.g. output.Role == 'admin' or output.Count > 3";
          ex.onchange = function () { s.expr = ex.value.trim(); schedulePreview(); };
          bp.appendChild(ex);
        }
        if (!s.elseSteps) s.elseSteps = [];
      } else if (s.kind === "repeat" || s.kind === "retry") {
        var n = document.createElement("input"); n.type = "number"; n.min = 1; n.max = s.kind === "retry" ? 10 : 1000; n.value = s.times;
        n.onchange = function () { s.times = +n.value || 1; schedulePreview(); };
        bp.appendChild(n); bp.appendChild(el("span", "dim", s.kind === "retry" ? "attempts if a step fails" : "times"));
      } else {
        var vis = document.createElement("select");
        opt(vis, "1", "is visible"); opt(vis, "0", "is not visible");
        vis.value = s.visible ? "1" : "0";
        vis.onchange = function () { s.visible = vis.value === "1"; schedulePreview(); };
        bp.appendChild(el("span", "dim", "while / when this")); bp.appendChild(vis);
      }
      body.appendChild(bp);
      if (s.sel && s.cond !== "expr") body.appendChild(targetEditor(s, renderSteps));
      var unwrap = el("button", "btn mini", "Unwrap");
      unwrap.onclick = function () { list.splice.apply(list, [idx, 1].concat(s.steps, s.elseSteps || [])); S.picked = {}; renderSteps(); };
      head.appendChild(unwrap);
    } else {
      head.appendChild(el("span", "rtitle", OTHER_NAMES[s.type] || s.type));
      if (s.type === "launch") {
        var lc = el("label", "opt inline"); var lcb = document.createElement("input"); lcb.type = "checkbox"; lcb.checked = !!s.clearState;
        lcb.onchange = function () { s.clearState = lcb.checked; schedulePreview(); };
        lc.appendChild(lcb); lc.appendChild(document.createTextNode(" with fresh data")); head.appendChild(lc);
      }
      if (s.type === "swipe") head.appendChild(el("span", "dim", s.from + " \u2192 " + s.to));
      if (s.type === "key") head.appendChild(el("span", "dim", s.key));
      if (s.type === "erase") head.appendChild(el("span", "dim", s.count + " characters"));
      if (s.type === "screenshot") head.appendChild(el("span", "dim", s.name));
      if (s.type === "raw") body.appendChild(el("div", "rcode", JSON.stringify(s.value)));
      if (s.type === "airplane") head.appendChild(el("span", "dim", s.on ? "on" : "off"));
      if (s.type === "record") head.appendChild(el("span", "dim", s.action === "start" ? "start" : "stop"));
      if (s.type === "openApp") {
        var fr = el("label", "opt inline"); var frb = document.createElement("input"); frb.type = "checkbox"; frb.checked = !!s.clearState;
        frb.onchange = function () { s.clearState = frb.checked; schedulePreview(); };
        fr.appendChild(frb); fr.appendChild(document.createTextNode(" fresh data")); head.appendChild(fr);
      }
      if (s.type === "openLink") {
        var br = el("label", "opt inline"); var brb = document.createElement("input"); brb.type = "checkbox"; brb.checked = !!s.browser;
        brb.onchange = function () { s.browser = brb.checked; schedulePreview(); };
        br.appendChild(brb); br.appendChild(document.createTextNode(" browser")); head.appendChild(br);
      }
      if (FIELDS[s.type]) {
        var fr2 = el("div", "selrow");
        FIELDS[s.type].forEach(function (fd) {
          var inp = document.createElement("input"); inp.type = "text"; inp.className = "rval"; inp.spellcheck = false;
          inp.placeholder = fd[1]; inp.style.maxWidth = fd[2] + "px";
          var cur = s[fd[0]];
          inp.value = cur == null ? "" : (s.type === "setVar" && fd[0] === "value" && s.mode === "expr" ? "=" + cur : String(cur));
          inp.onchange = function () {
            var v = inp.value;
            if (s.type === "setVar" && fd[0] === "value") { s.mode = v.charAt(0) === "=" ? "expr" : "text"; s.value = s.mode === "expr" ? v.slice(1) : v; }
            else if (s.type === "setLocation") s[fd[0]] = +v;
            else s[fd[0]] = v.trim();
            schedulePreview();
          };
          fr2.appendChild(inp);
        });
        body.appendChild(fr2);
        if (s.type === "setVar") body.appendChild(el("div", "fhint", "Use it as ${output." + (s.name || "NAME") + "}. Start the value with = for a JavaScript expression."));
      }
      if (s.type === "input") {
        var chip = el("button", "vchip " + s.mode + (s.pending ? " warn" : ""));
        var shown = s.password ? "\u2022\u2022\u2022\u2022" : s.value;
        chip.textContent = s.pending ? "Waiting for your choice\u2026" : s.mode === "var" ? "${" + s.ref + "}" :
          (s.mode === "data" ? "${output." + s.column + "}  \u2190  " + shown : "\u201C" + shown + "\u201D");
        chip.title = "Click to change how this value is used";
        chip.onclick = function () {
          askValue(s.value, { column: s.column || "Value", password: s.password, needsValue: s.password && !s.value }).then(function (c) {
            if (!c) return; s.mode = c.mode; s.column = c.column; s.value = c.value; s.ref = c.ref; renderSteps();
          });
        };
        body.appendChild(chip);
      }
    }
    row.appendChild(body);

    var mv = el("div", "rmove");
    var up = el("button", "btn mini", "\u25B2"), dn = el("button", "btn mini", "\u25BC"), del = el("button", "btn mini ghost", "\u00d7");
    up.title = "Move up"; dn.title = "Move down"; del.title = "Delete step";
    up.setAttribute("aria-label", "Move step up"); dn.setAttribute("aria-label", "Move step down"); del.setAttribute("aria-label", "Delete step");
    up.disabled = idx === 0; dn.disabled = idx === list.length - 1;
    up.onclick = function () { list.splice(idx - 1, 0, list.splice(idx, 1)[0]); S.picked = {}; renderSteps(); };
    dn.onclick = function () { list.splice(idx + 1, 0, list.splice(idx, 1)[0]); S.picked = {}; renderSteps(); };
    del.onclick = function () { list.splice(idx, 1); S.picked = {}; renderSteps(); };
    mv.appendChild(up); mv.appendChild(dn); mv.appendChild(del);
    row.appendChild(mv);
    return row;
  }

  function renderList(list, parent, into, elsePart) {
    list.forEach(function (s, i) {
      var seg = (elsePart ? "e" : "") + i;
      var path = parent ? parent + "." + seg : seg;
      into.appendChild(stepRow(s, path, list, i));
      if (s.type === "block") {
        var inner = el("div", "rblock");
        if (!s.steps.length) inner.appendChild(el("div", "empty", "Empty block. Tick steps and choose Repeat / If / Retry above, or edit in the Flow panel."));
        renderList(s.steps, path, inner, false);
        into.appendChild(inner);
        if (s.kind === "if") {
          var eh = el("div", "relse");
          eh.appendChild(el("span", "", "Else"));
          var addE = el("button", "btn mini", "Move ticked steps here");
          addE.title = "Steps that run when the condition is false";
          addE.onclick = function () { moveToElse(s); };
          eh.appendChild(addE);
          into.appendChild(eh);
          var inE = el("div", "rblock else");
          if (!(s.elseSteps || []).length) inE.appendChild(el("div", "empty", "Nothing runs otherwise. Tick steps and press \u201CMove ticked steps here\u201D."));
          renderList(s.elseSteps || [], path, inE, true);
          into.appendChild(inE);
        }
      }
    });
  }
  function moveToElse(blk) {
    var paths = selectedPaths().sort(function (a, b) { return b.localeCompare(a, undefined, { numeric: true }); });
    if (!paths.length) { toast("Tick the steps to move into Else first.", "err"); return; }
    var moved = [];
    paths.forEach(function (p) { var l = listAtPath(parentPath(p)); var x = l.splice(lastIndex(p), 1)[0]; if (x !== blk) moved.unshift(x); });
    blk.elseSteps = (blk.elseSteps || []).concat(moved);
    S.picked = {}; renderSteps();
  }

  function renderSteps() {
    var box = $("recSteps"); box.innerHTML = "";
    if (!S.steps.length) box.appendChild(el("div", "empty", S.mode === "interact" ? "Just use: nothing is recorded."
      : "Launch the app, then tap and type on the device. Each action becomes a step here."));
    renderList(S.steps, "", box);
    var n = selectedPaths().length;
    $("recSelBar").hidden = !n;
    $("recSelCount").textContent = n + " selected";
    var count = 0; walk(S.steps, function () { count++; });
    $("recCount").textContent = count ? String(count) : "";
    var vars = Object.keys(S.env || {});
    $("recVarText").textContent = vars.length ? vars.map(function (k) { return k + " = " + S.env[k]; }).join(",  ") : "None. Flow variables are used as ${NAME} in any step.";
    var hasData = dataSteps().length > 0;
    $("recDataLine").hidden = !hasData;
    if (hasData && !S.data) S.data = { file: "", workbook: defaultBook(), sheet: safeName(flowBase(), "Data").slice(0, 31) };
    $("recDataText").textContent = dataLabel(S.data);
    schedulePreview();
  }

  /* ======================= Flow panel (YAML, two-way) ======================= */
  function clean(list) {
    return list.map(function (s) {
      var c = {};
      Object.keys(s).forEach(function (k) { if (k !== "candidates" && k !== "unsure" && k !== "pending") c[k] = s[k]; });
      if (c.type === "block") { c.steps = clean(s.steps); if (s.elseSteps) c.elseSteps = clean(s.elseSteps); }
      return c;
    });
  }
  function buildRecording() {
    return {
      flow: $("recFlow").value.trim(), appId: appId(),
      tags: $("recTags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
      data: S.data, steps: clean(S.steps), env: S.env
    };
  }
  function schedulePreview() {
    clearTimeout(S.previewTimer);
    S.previewTimer = setTimeout(function () {
      if (S.dirty) return;
      if (!S.steps.length) { $("recYaml").value = ""; $("recProblem").textContent = ""; return; }
      api("/api/rec/preview", buildRecording()).then(function (d) {
        if (S.dirty) return;
        $("recYaml").value = d.yaml || "";
        $("recProblem").textContent = d.problem || "";
      }).catch(function () {});
    }, 180);
  }
  function setDirty(v) {
    S.dirty = v;
    $("recYaml").classList.toggle("dirty", v);
    $("recApply").hidden = !v;
  }
  function applyYaml() {
    var text = $("recYaml").value;
    if (!text.trim()) { S.steps = []; setDirty(false); renderSteps(); return Promise.resolve(true); }
    return api("/api/rec/parse", { yaml: text, steps: clean(S.steps) }).then(function (d) {
      S.steps = d.steps; S.picked = {};
      if (d.appId) $("recApp").value = d.appId;
      if (d.tags && d.tags.length) $("recTags").value = d.tags.filter(function (t) { return t !== "recorded"; }).join(", ");
      if (d.data) S.data = d.data;
      S.env = d.env || {};
      $("recProblem").textContent = "";
      setDirty(false); renderSteps();
      return true;
    }).catch(function (e) { $("recProblem").textContent = e.message; return false; });
  }

  /* ======================= Save ======================= */
  function save(thenRun, overwrite) {
    var go = S.dirty ? applyYaml() : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) { toast("Fix the flow text first.", "err"); return; }
      var rec = buildRecording();
      if (!rec.flow) { toast("Give the flow a file name first.", "err"); $("recFlow").focus(); return; }
      if (!rec.steps.length) { toast("Record at least one step first.", "err"); return; }
      if (S.capQueue.length || S.capBusy) { toast("Answer the open question about a typed value first.", "err"); return; }
      $("recSave").disabled = $("recSaveRun").disabled = true;
      api("/api/rec/save", { recording: rec, overwrite: !!overwrite }).then(function (d) {
        toast("Saved " + d.path + (d.data && d.data.columns ? " and test data in " + d.data.file : "") + ".", "ok");
        if (typeof loadFlows === "function") loadFlows();
        if (thenRun) { showTab("run"); startRun([{ flow: d.path, rows: "" }]); }
      }).catch(function (e) {
        if (e.code === "EXISTS") {
          modal({ title: "Replace the existing flow?", text: rec.flow + " already exists. A backup of the old version is kept in FlowBackups.", ok: "Replace" })
            .then(function (v) { if (v) save(thenRun, true); });
        } else toast(e.message, "err");
      }).finally(function () { $("recSave").disabled = $("recSaveRun").disabled = false; });
    });
  }

  function clearAll() {
    if (!S.steps.length) return;
    modal({ title: "Clear all steps?", text: "This removes the recorded steps. Saved flows are not affected.", ok: "Clear steps" })
      .then(function (v) { if (v) { S.steps = []; S.picked = {}; setDirty(false); renderSteps(); } });
  }

  /* ======================= Modes ======================= */
  var HINTS = {
    record: "Click an element to choose what to do with it. Drag to swipe.",
    device: "Tap on the phone itself. Only taps in your app are kept.",
    interact: "Clicks go straight to the phone. Nothing is recorded."
  };
  function setMode(m) {
    var was = S.mode;
    S.mode = m;
    closeMenu();
    ["record", "interact", "device"].forEach(function (k) {
      var b = $("recMode-" + k); b.classList.toggle("active", k === m); b.setAttribute("aria-pressed", k === m);
    });
    $("recStage").setAttribute("data-mode", m);
    $("recModeHint").textContent = HINTS[m];
    if (was === "device" && m !== "device") stopCapture();
    if (m === "device" && was !== "device") startCapture();
    $("recFollowBox").hidden = m !== "device";
    renderSteps();
  }

  /* ======================= Wire up ======================= */
  function init() {
    var c = $("recScreen");
    c.addEventListener("pointerdown", onDown);
    c.addEventListener("pointermove", onMove);
    c.addEventListener("pointerup", onUp);
    c.addEventListener("pointercancel", onUp);
    c.addEventListener("pointerleave", onLeave);
    c.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    $("recAllOn").addEventListener("change", drawAll);
    $("recInspectOn").addEventListener("change", function () { if (!this.checked) onLeave(); });
    $("recApkFile").addEventListener("change", function () { uploadApk(this.files[0]); });
    ["recFlow", "recApp", "recTags"].forEach(function (id) { $(id).addEventListener("input", schedulePreview); });
    var ta = $("recYaml");
    ta.addEventListener("input", function () { setDirty(true); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Tab") { e.preventDefault(); var p = ta.selectionStart; ta.setRangeText("  ", p, ta.selectionEnd, "end"); setDirty(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); applyYaml(); }
    });
    document.addEventListener("pointerdown", function (e) {
      if (S.menu && !S.menu.contains(e.target) && e.target !== $("recScreen")) closeMenu();
    });
    document.addEventListener("click", function (e) {
      document.querySelectorAll("details.menu[open]").forEach(function (d) { if (!d.contains(e.target)) d.open = false; });
    });
    document.addEventListener("keydown", function (e) {
      if ($("tab-record").hidden) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && tag !== "INPUT" && tag !== "TEXTAREA" && S.steps.length) {
        e.preventDefault(); S.steps.pop(); renderSteps(); toast("Removed the last step.");
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !$("tab-record").hidden && S.serial) startStream();
    });
    hooks.tab.push(function (name) {
      if (name === "record") { refreshDevices(); loadApks($("recApk").value); }
      else { stopStream(); closeMenu(); clearTimeout(S.watch); if (S.mode === "device") setMode("record"); }
    });
    setMode("record");
  }

  return {
    init: init, refreshDevices: refreshDevices, chooseDevice: chooseDevice, useDevice: useDevice, startAvd: startAvd, disconnect: disconnect,
    connectWifi: connectWifi, snapshot: snapshot, launch: launch,
    pickApk: pickApk, installApk: installApk, deleteApk: deleteApk, nav: nav, typeAny: typeAny, insert: insert,
    wrap: wrap, deleteSelected: deleteSelected, chooseData: chooseData, applyYaml: applyYaml, panel: panel,
    save: save, clearAll: clearAll, setMode: setMode,
    usbToWifi: usbToWifi, freeMemory: freeMemory, setAnimPref: setAnimPref, animPref: animPref, pickApp: function () { pickApp(false); }, editVars: editVars,
    // used by ui/ai.js
    serial: function () { return S.serial; }, appId: appId, yaml: function () { return $("recYaml").value; },
    setYaml: function (t) { $("recYaml").value = t; setDirty(true); return applyYaml(); }
  };
})();

Rec.init();
