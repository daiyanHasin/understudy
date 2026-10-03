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
    lastChoice: localStorage.getItem("us.valueMode") || "data"
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
  function listAt(path) {           // path of the parent block ("" = top level)
    var list = S.steps;
    if (!path) return list;
    path.split(".").forEach(function (i) { list = list[+i].steps; });
    return list;
  }
  function parentPath(p) { var a = p.split("."); a.pop(); return a.join("."); }
  function lastIndex(p) { return +p.split(".").pop(); }
  function walk(list, fn) { list.forEach(function (s) { fn(s); if (s.type === "block") walk(s.steps, fn); }); }
  function dataSteps() { var out = []; walk(S.steps, function (s) { if (s.type === "input" && s.mode === "data") out.push(s); }); return out; }
  function addStep(step) { S.steps.push(step); renderSteps(); }

  /* ======================= Devices ======================= */
  function refreshDevices() {
    return api("/api/device/list").then(function (d) {
      var sel = $("recDevice"); sel.innerHTML = "";
      var ready = d.devices.filter(function (x) { return x.state === "device"; });
      if (!ready.length) opt(sel, "", "No device connected");
      ready.forEach(function (x) {
        var name = x.avd ? x.avd.replace(/_/g, " ") : (x.model || x.serial);
        opt(sel, x.serial, name + (x.booted ? "" : "  (starting\u2026)") + (x.emulator ? "" : x.wifi ? "  \u00b7 Wi-Fi" : "  \u00b7 USB"));
      });
      if (!ready.some(function (x) { return x.serial === S.serial; })) S.serial = ready.length ? ready[0].serial : "";
      sel.value = S.serial;
      var avd = $("recAvd"), keep = avd.value; avd.innerHTML = "";
      if (!d.avds.length) opt(avd, "", "None yet. See Setup");
      d.avds.forEach(function (a) { opt(avd, a, a.replace(/_/g, " ")); });
      if (keep) avd.value = keep;

      var cur = ready.filter(function (x) { return x.serial === S.serial; })[0];
      $("recDisconnect").disabled = !cur;
      $("recDisconnect").textContent = cur && cur.emulator ? "Stop" : "Disconnect";
      $("recDot").className = "ldot" + (cur ? (cur.booted ? " on" : " boot") : "");
      showProblem(d.problems || {});
      setStage(cur ? (cur.booted ? "live" : "booting") : "empty");
      if (cur && cur.booted) { loadPackages(); startStream(); }
      return d;
    }).catch(function (e) { setStage("empty", e.message); });
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
    S.serial = $("recDevice").value;
    localStorage.setItem("us.serial", S.serial);
    if (S.mode === "device") setMode("record");
    refreshDevices();
  }

  function startAvd() {
    var name = $("recAvd").value;
    if (!name) { toast("No virtual device yet. Open Setup and press Install Android tools.", "err"); return; }
    closeMenus();
    $("recStartAvd").disabled = true;
    api("/api/device/start", { avd: name, headless: !$("recWindow").checked, graphics: $("recGfx").value }).then(function () {
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
    api("/api/device/stop", { serial: S.serial }).then(function () {
      S.streaming = false; toast("Device disconnected.");
      S.serial = ""; setTimeout(refreshDevices, 1200);
    }).catch(function (e) { toast(e.message, "err"); });
  }

  function connectWifi() {
    var body = { address: $("recAddr").value.trim() };
    if ($("recPairCode").value.trim()) { body.code = $("recPairCode").value.trim(); body.pairAddress = $("recPairAddr").value.trim(); }
    api("/api/device/connect", body).then(function () {
      closeMenus(); toast("Phone connected.", "ok"); $("recPairCode").value = ""; refreshDevices();
    }).catch(function (e) { toast(e.message, "err"); });
  }

  function snapshot(action) {
    if (!S.serial) { toast("Choose a virtual device first.", "err"); return; }
    closeMenus();
    toast(action === "save" ? "Saving clean state\u2026" : "Going back to the clean state\u2026");
    api("/api/device/snapshot", { serial: S.serial, action: action }).then(function () {
      toast(action === "save" ? "Clean state saved." : "Back to the clean state.", "ok");
    }).catch(function (e) { toast(e.message, "err"); });
  }

  function loadPackages() {
    if (!S.serial) return;
    api("/api/device/packages?serial=" + encodeURIComponent(S.serial)).then(function (d) {
      var dl = $("recPkgs"); dl.innerHTML = "";
      d.packages.forEach(function (p) { opt(dl, p, p); });
    }).catch(function () {});
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
    $("recEmpty").textContent = msg || (st === "booting" ? "Starting the device\u2026" : "Choose a device, or use Add device to start one.");
  }
  function startStream() { if (S.streaming || !S.serial) return; S.streaming = true; frame(); }

  function frame() {
    if (!S.streaming) return;
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
        setTimeout(frame, 60);
      })
      .catch(function (e) {
        S.streamErr++;
        if (S.streamErr > 3) setStage("empty", e.message);
        setTimeout(frame, 1500);
      });
  }

  function toDevice(ev) {
    var c = $("recScreen"), r = c.getBoundingClientRect();
    if (!S.dw || !r.width) return null;
    return { x: Math.round((ev.clientX - r.left) / r.width * S.dw), y: Math.round((ev.clientY - r.top) / r.height * S.dh),
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

  var down = null;
  function onDown(ev) { if (ev.button !== 0 || S.busy) return; var p = toDevice(ev); if (!p) return; down = { p: p, t: Date.now() }; ev.preventDefault(); }
  function onUp(ev) {
    if (!down) return;
    var p = toDevice(ev), d = down; down = null;
    if (!p) return;
    if (Math.hypot(p.px - d.p.px, p.py - d.p.py) > 12) return doSwipe(d.p, p);
    doTap(d.p, Date.now() - d.t > 600);
  }

  function input(body) {
    body.serial = S.serial;
    return api("/api/device/input", body).catch(function (e) { toast(e.message, "err"); throw e; });
  }

  function doTap(p, long) {
    if (!S.serial) return;
    spotlight(p.px, p.py);
    if (S.mode === "interact") return input({ action: long ? "longPress" : "tap", x: p.x, y: p.y });
    S.busy = true; $("recStage").classList.add("thinking");
    api("/api/rec/inspect", { serial: S.serial, x: p.x, y: p.y }).then(function (info) {
      outline(info.element && info.element.bounds);
      showInspect(info);
      if (S.mode === "assert") { addStep({ type: "assertVisible", sel: info.candidates[0], candidates: info.candidates }); return; }
      addStep({ type: long ? "longPress" : "tap", sel: info.candidates[0], candidates: info.candidates });
      S.field = info.element && info.element.editable ? { el: info.element, column: info.suggestedColumn } : null;
      return input({ action: long ? "longPress" : "tap", x: p.x, y: p.y }).then(function () {
        if (!S.field) return;
        var t = $("recText");
        t.type = S.field.el.password ? "password" : "text";
        t.placeholder = "Type into " + (S.field.el.placeholder || S.field.el.idShort || "this field") + ", then press Enter";
        t.focus();
      });
    }).catch(function (e) { toast(e.message, "err"); })
      .finally(function () { S.busy = false; $("recStage").classList.remove("thinking"); });
  }

  function doSwipe(a, b) {
    if (!S.serial) return;
    if (S.mode === "record" || S.mode === "device") addStep({ type: "swipe", from: pct(a.x, a.y), to: pct(b.x, b.y) });
    input({ action: "swipe", x1: a.x, y1: a.y, x2: b.x, y2: b.y, ms: 300 }).catch(function () {});
  }

  function nav(kind) {
    if (!S.serial) { toast("Connect a device first.", "err"); return; }
    var rec = S.mode === "record" || S.mode === "device";
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
    var b = { type: "block", kind: kind, steps: steps || [] };
    if (kind === "repeat") b.times = 3;
    if (kind === "retry") b.times = 3;
    if (kind === "if" || kind === "while") { b.visible = true; b.sel = { kind: "text", value: "Change me", exact: false }; }
    return b;
  }
  function insert(kind) {
    closeMenus();
    var map = { wait: { type: "wait" }, hideKeyboard: { type: "hideKeyboard" }, back: { type: "key", key: "back" },
                enter: { type: "key", key: "enter" }, scroll: { type: "scroll" }, erase: { type: "erase", count: 50 },
                screenshot: { type: "screenshot", name: "step_" + (S.steps.length + 1) } };
    if (map[kind]) return addStep(map[kind]);
    addStep(blockTemplate(kind));
    toast("Block added. Tick steps and use the bar above to move them in, or edit it in the Flow panel.");
  }
  function selectedPaths() { return Object.keys(S.picked).filter(function (k) { return S.picked[k]; }); }
  function wrap(kind) {
    var paths = selectedPaths();
    if (!paths.length) return;
    var parent = parentPath(paths[0]);
    if (!paths.every(function (p) { return parentPath(p) === parent; })) { toast("Pick steps at the same level to put them in a block.", "err"); return; }
    var list = listAt(parent);
    var idx = paths.map(lastIndex).sort(function (a, b) { return a - b; });
    var moved = idx.map(function (i) { return list[i]; });
    for (var i = idx.length - 1; i >= 0; i--) list.splice(idx[i], 1);
    list.splice(idx[0], 0, blockTemplate(kind, moved));
    S.picked = {}; renderSteps();
  }
  function deleteSelected() {
    var paths = selectedPaths().sort(function (a, b) { return b.localeCompare(a, undefined, { numeric: true }); });
    paths.forEach(function (p) { listAt(parentPath(p)).splice(lastIndex(p), 1); });
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
      else if (e.key === "Enter" && e.target.tagName !== "SELECT" && e.target.tagName !== "BUTTON") { e.preventDefault(); e.stopPropagation(); submit(); }
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
      choices.appendChild(cData); choices.appendChild(cFixed); sh.dlg.appendChild(choices);

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
        cData.classList.toggle("on", mode === "data"); cFixed.classList.toggle("on", mode === "fixed");
        cData.setAttribute("aria-pressed", mode === "data"); cFixed.setAttribute("aria-pressed", mode === "fixed");
        dataBox.hidden = mode !== "data";
        var c = col.value.trim() || "Column";
        cData.querySelector("span").textContent = "The flow uses ${output." + c + "} and the value goes into Excel. Add rows later to run with more data.";
        colNote.textContent = sheetCols.indexOf(c) >= 0 ? "This column already exists in the sheet. Its row 1 value is kept if it has one."
          : (used[c] !== undefined ? "Already used earlier in this flow: the same value will be reused." : "");
      }
      cData.onclick = function () { mode = "data"; paint(); col.focus(); };
      cFixed.onclick = function () { mode = "fixed"; paint(); };
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
        S.lastChoice = "fixed"; localStorage.setItem("us.valueMode", "fixed");
        return { mode: "fixed", value: v };
      }, function (r) { $("recText").focus(); resolve(r); }, valIn || (mode === "data" ? col : null));
    });
  }

  function typeText() {
    var t = $("recText"), value = t.value;
    if (!value) return;
    if (!S.serial) { toast("Connect a device first.", "err"); return; }
    if (S.mode === "interact") { input({ action: "text", text: value }).then(function () { t.value = ""; }).catch(function () {}); return; }
    askValue(value, { column: S.field && S.field.column, password: S.field && S.field.el.password }).then(function (c) {
      if (!c) return;
      input({ action: "text", text: value }).then(function () {
        addStep({ type: "input", mode: c.mode, value: value, column: c.column, password: !!(S.field && S.field.el.password) });
        t.value = ""; t.type = "text";
      }).catch(function () {});
    });
  }

  /* ======================= Capture from the device ======================= */
  function startCapture() {
    if (!S.serial) { toast("Connect a device first.", "err"); setMode("record"); return; }
    if (!/^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/.test(appId())) { toast("Enter the app ID first. Only taps in that app are kept.", "err"); setMode("record"); return; }
    api("/api/capture/start", { serial: S.serial, appId: appId() }).then(function () {
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
  function showInspect(info) {
    var box = $("recInspect"); box.innerHTML = "";
    var e = info.element;
    if (!e) { box.appendChild(el("div", "empty", "No element here. The step uses the screen position.")); return; }
    var dl = el("dl", "props");
    [["Type", e.cls], ["ID", e.idShort], ["Text", e.text], ["Placeholder", e.placeholder], ["Label", e.desc], ["App", e.pkg]].forEach(function (r) {
      if (!r[1]) return; dl.appendChild(el("dt", "", r[0])); dl.appendChild(el("dd", "", r[1]));
    });
    box.appendChild(dl);
    if (e.password) box.appendChild(el("div", "fhint", "Password field: the value is hidden in Understudy."));
    if (info.ms !== undefined) box.appendChild(el("div", "fhint", info.cached ? "Read instantly (screen was already read)." : "Read the screen in " + info.ms + " ms."));
  }
  function panel(which) {
    $("pane-flow").hidden = which !== "flow"; $("pane-el").hidden = which !== "el";
    $("ptab-flow").classList.toggle("active", which === "flow"); $("ptab-el").classList.toggle("active", which === "el");
  }

  /* ======================= Steps list ======================= */
  var TYPE_NAMES = { tap: "Tap", doubleTap: "Double tap", longPress: "Long press", assertVisible: "Check visible",
    assertNotVisible: "Check not visible", scrollUntilVisible: "Scroll until visible" };
  var OTHER_NAMES = { launch: "Launch app", input: "Type", swipe: "Swipe", scroll: "Scroll down", erase: "Clear text",
    key: "Press", hideKeyboard: "Hide keyboard", wait: "Wait for animations", screenshot: "Screenshot", raw: "Custom step" };
  var BLOCK_NAMES = { repeat: "Repeat", while: "Repeat while", if: "If", retry: "Retry" };

  function targetEditor(s, onchange) {
    var box = el("div", "");
    if (s.candidates && s.candidates.length > 1) {
      var sel = document.createElement("select"); sel.className = "rsel";
      s.candidates.forEach(function (c, k) {
        var o = opt(sel, String(k), c.label + (c.unique ? "" : "  (" + c.count + " matches)"));
        if (c.kind === s.sel.kind && c.value === s.sel.value) o.selected = true;
      });
      opt(sel, "custom", "Edit target\u2026");
      sel.onchange = function () {
        if (sel.value === "custom") { delete s.candidates; renderSteps(); return; }
        s.sel = s.candidates[+sel.value]; onchange();
      };
      box.appendChild(sel);
      if (s.sel && s.sel.unique === false) box.appendChild(el("div", "rwarn", "Matches more than one element. Pick another target if the wrong one is used."));
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
    row.appendChild(el("span", "n", path.split(".").map(function (x) { return +x + 1; }).join(".")));
    var body = el("div", "rbody"), head = el("div", "rhead");
    body.appendChild(head);

    if (s.sel && TYPE_NAMES[s.type]) {
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
      if (s.kind === "repeat" || s.kind === "retry") {
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
      if (s.sel) body.appendChild(targetEditor(s, renderSteps));
      var unwrap = el("button", "btn mini", "Unwrap");
      unwrap.onclick = function () { list.splice.apply(list, [idx, 1].concat(s.steps)); S.picked = {}; renderSteps(); };
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
      if (s.type === "input") {
        var chip = el("button", "vchip " + s.mode + (s.pending ? " warn" : ""));
        var shown = s.password ? "\u2022\u2022\u2022\u2022" : s.value;
        chip.textContent = s.pending ? "Waiting for your choice\u2026" : (s.mode === "data" ? "${output." + s.column + "}  \u2190  " + shown : "\u201C" + shown + "\u201D");
        chip.title = "Click to change how this value is used";
        chip.onclick = function () {
          askValue(s.value, { column: s.column || "Value", password: s.password, needsValue: s.password && !s.value }).then(function (c) {
            if (!c) return; s.mode = c.mode; s.column = c.column; s.value = c.value; renderSteps();
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

  function renderList(list, parent, into) {
    list.forEach(function (s, i) {
      var path = parent ? parent + "." + i : String(i);
      into.appendChild(stepRow(s, path, list, i));
      if (s.type === "block") {
        var inner = el("div", "rblock");
        if (!s.steps.length) inner.appendChild(el("div", "empty", "Empty block. Tick steps and choose Repeat / If / Retry above, or edit in the Flow panel."));
        renderList(s.steps, path, inner);
        into.appendChild(inner);
      }
    });
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
    $("recCount").textContent = count ? count + (count === 1 ? " step" : " steps") : "";
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
      if (c.type === "block") c.steps = clean(s.steps);
      return c;
    });
  }
  function buildRecording() {
    return {
      flow: $("recFlow").value.trim(), appId: appId(),
      tags: $("recTags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
      data: S.data, steps: clean(S.steps)
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
    record: "Click and type on the screen here. Every action becomes a step.",
    device: "Use the phone or the emulator window directly. Only taps in your app are kept.",
    assert: "Click anything on the screen to check that it is visible.",
    interact: "Use the device freely. Nothing is recorded."
  };
  function setMode(m) {
    var was = S.mode;
    S.mode = m;
    ["record", "device", "assert", "interact"].forEach(function (k) {
      var b = $("recMode-" + k); b.classList.toggle("active", k === m); b.setAttribute("aria-pressed", k === m);
    });
    $("recStage").setAttribute("data-mode", m);
    $("recModeHint").textContent = HINTS[m];
    if (was === "device" && m !== "device") stopCapture();
    if (m === "device" && was !== "device") startCapture();
    renderSteps();
  }

  /* ======================= Wire up ======================= */
  function init() {
    var c = $("recScreen");
    c.addEventListener("pointerdown", onDown);
    c.addEventListener("pointerup", onUp);
    $("recText").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); typeText(); } });
    $("recApkFile").addEventListener("change", function () { uploadApk(this.files[0]); });
    ["recFlow", "recApp", "recTags"].forEach(function (id) { $(id).addEventListener("input", schedulePreview); });
    var ta = $("recYaml");
    ta.addEventListener("input", function () { setDirty(true); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Tab") { e.preventDefault(); var p = ta.selectionStart; ta.setRangeText("  ", p, ta.selectionEnd, "end"); setDirty(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); applyYaml(); }
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
      else { S.streaming = false; if (S.mode === "device") setMode("record"); }
    });
    setMode("record");
  }

  return {
    init: init, refreshDevices: refreshDevices, chooseDevice: chooseDevice, startAvd: startAvd, disconnect: disconnect,
    connectWifi: connectWifi, snapshot: snapshot, launch: launch,
    pickApk: pickApk, installApk: installApk, deleteApk: deleteApk, nav: nav, typeText: typeText, insert: insert,
    wrap: wrap, deleteSelected: deleteSelected, chooseData: chooseData, applyYaml: applyYaml, panel: panel,
    save: save, clearAll: clearAll, setMode: setMode
  };
})();

Rec.init();
