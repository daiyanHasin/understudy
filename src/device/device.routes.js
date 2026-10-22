/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * HTTP routes - Devices: list, start/stop, Wi-Fi + pairing, screen frames, input, layout, apps, APKs.
 * Routes only read the request, call the feature module and answer.
 * The logic lives in the modules required below.
 */
const fs   = require("fs");
const path = require("path");
const security = require("../core/security");
const state = require("../core/state");
const android = require("../device/android");
const recorder = require("../record/recorder");
const capture = require("../record/capture");
const P = require("../core/paths");
const pairing = require("../device/pairing");
const wifi = require("../device/wifi");
const animations = require("../device/animations");
const stream = require("../device/stream");
const APK_LIMIT = 800 * 1024 * 1024;

module.exports = function register(r, ctx) {
  const { GET, POST, json, deviceFree } = r;

  /* ----- Devices ----- */
  GET("/api/device/list", async (req, res) => {
    let adbError = "";
    const [devices, avds] = await Promise.all([android.devices().catch(e => { adbError = e.message; return []; }), android.avds()]);
    const problems = {};
    avds.forEach(a => { const p = android.avdProblem(a); if (p) problems[a] = p; });
    json(res, 200, { devices, avds, problems, adb: adbError ? { ok: false, error: adbError } : { ok: true, source: android.adbSource() } });
  });
  POST("/api/device/start", async (req, res) => {
    const b = await security.readJson(req);
    json(res, 200, android.startAvd(b.avd, { headless: b.headless !== false, graphics: b.graphics, cold: !!b.cold, light: !!b.light }));
  });
  POST("/api/device/stop", async (req, res) => {
    const b = await security.readJson(req);
    capture.stop(String(b.serial || ""));
    stream.stop(String(b.serial || ""));
    await animations.restore(String(b.serial || "")).catch(() => {});
    json(res, 200, await android.stopDevice(b.serial));
  });
  POST("/api/device/connect", async (req, res) => {
    const b = await security.readJson(req);
    let address = String(b.address || "").trim();
    if (b.code) {
      const p = await android.pair(String(b.pairAddress || ""), String(b.code));
      // Paired: the phone usually announces its connection address, so the tester need not type it
      if (!address) {
        const f = await pairing.findConnect(p.ip, 7000);
        if (f && f.already) return json(res, 200, { ok: true, address: f.serial, paired: true });
        if (f && f.address) address = f.address;
        else return json(res, 400, { error: "Paired. Now enter the \u201CIP address & Port\u201D shown at the top of Wireless debugging (not the pairing port) and press Connect.", paired: true });
      }
    }
    const r = await android.connect(address);
    json(res, 200, Object.assign({ paired: !!b.code }, r));
  });
  /* Can this PC reach a phone at IP:port? Plain-language answer (wifi.js) */
  POST("/api/device/wifi-check", async (req, res) => {
    const b = await security.readJson(req);
    const address = android.normAddr(b.address);
    json(res, 200, Object.assign(await wifi.diagnose(address, b.what === "pair" ? "pair" : "connect"), { address, networks: wifi.pcNetworks() }));
  });
  /* Phone animations off while recording (more reliable element capture), restored on disconnect / quit */
  POST("/api/device/animations", async (req, res) => {
    const b = await security.readJson(req);
    const serial = String(b.serial || "");
    android.checkSerial(serial);
    json(res, 200, b.off === false ? await animations.restore(serial) : await animations.off(serial));
  });
  POST("/api/device/wifi", async (req, res) => {
    const b = await security.readJson(req);
    json(res, 200, await android.usbToWifi(String(b.serial || "")));
  });
  /* Wi-Fi pairing by QR code */
  POST("/api/pair/start", (req, res) => json(res, 200, pairing.start({
    // Restarting adb cuts every connected phone (a running test, or the USB phone on the Record
    // tab). Only when nothing is connected; otherwise the QR hint says to use the 6-digit code.
    canRestart: async () => !state.busy &&
      !(await android.devices({ fresh: true }).catch(() => [])).some(d => d.state === "device"),
    beforeRestart: () => { try { capture.stopAll(); } catch (_) {} }
  })));
  GET("/api/pair/status", (req, res) => json(res, 200, pairing.status()));
  POST("/api/pair/stop", (req, res) => json(res, 200, pairing.stop()));
  GET("/api/device/apps", async (req, res, u) => json(res, 200, { apps: await android.apps(u.searchParams.get("serial")) }));
  GET("/api/device/foreground", async (req, res, u) => json(res, 200, { app: await android.foreground(u.searchParams.get("serial")) }));
  POST("/api/device/openlink", async (req, res) => {
    deviceFree();
    const b = await security.readJson(req);
    json(res, 200, await android.openLink(String(b.serial || ""), String(b.url || "")));
  });
  // Every element on screen (for hover outlines). Cached unless force=1.
  GET("/api/device/layout", async (req, res, u) => {
    const serial = String(u.searchParams.get("serial") || "");
    android.checkSerial(serial);
    // `app` = the app in front (from the same layout), so the Record tab can fill in "App" by itself
    if (u.searchParams.get("force") === "1" && !state.busy) {
      const l = await android.layout(serial);
      return json(res, 200, { seq: l.seq, screenSeq: android.screenInfo(serial).seq, nodes: recorder.compactNodes(l.nodes),
                              app: await android.appInFront(serial, l.nodes) });
    }
    const info = android.screenInfo(serial);
    const snap = android.lastLayout(serial);
    if (!snap) return json(res, 200, { seq: 0, screenSeq: info.seq, nodes: [] });
    json(res, 200, { seq: snap.seq, screenSeq: info.seq, nodes: recorder.compactNodes(snap.nodes),
                     app: snap.fresh ? await android.appInFront(serial, snap.nodes) : "" });
  });
  POST("/api/device/snapshot", async (req, res) => {
    deviceFree();
    const b = await security.readJson(req);
    json(res, 200, await android.snapshot(b.serial, b.action));
  });
  // Raw RGBA frame, shrunk on this PC. Headers carry the sizes.
  GET("/api/device/frame", async (req, res, u) => {
    const f = await android.frame(u.searchParams.get("serial"), { prefetch: u.searchParams.get("prefetch") === "1" && !state.busy });
    const h = security.headers.api("application/octet-stream");
    h["X-Frame-W"] = f.w; h["X-Frame-H"] = f.h; h["X-Device-W"] = f.dw; h["X-Device-H"] = f.dh;
    h["Access-Control-Expose-Headers"] = "X-Frame-W, X-Frame-H, X-Device-W, X-Device-H";
    res.writeHead(200, h);
    res.end(f.data);
  });
  // Live screen video (H.264 from the phone's encoder), see src/device/stream.js
  GET("/api/device/stream", (req, res, u) => {
    stream.pipe(String(u.searchParams.get("serial") || ""), { dw: u.searchParams.get("dw"), dh: u.searchParams.get("dh") },
                req, res, security.headers.api("application/octet-stream"));
  });
  POST("/api/device/input", async (req, res) => {
    deviceFree();
    const b = await security.readJson(req);
    const s = b.serial;
    switch (b.action) {
      case "tap":       await android.tap(s, b.x, b.y); break;
      case "longPress": await android.longPress(s, b.x, b.y); break;
      case "swipe":     await android.swipe(s, b.x1, b.y1, b.x2, b.y2, b.ms); break;
      case "key":       await android.key(s, String(b.key)); break;
      case "text":      await android.text(s, b.text); break;
      case "hideKeyboard": await android.hideKeyboard(s); break;
      case "erase":     await android.erase(s, b.count); break;
      default: return json(res, 400, { error: "Unknown action" });
    }
    json(res, 200, { ok: true });
  });
  GET("/api/device/packages", async (req, res, u) =>
    json(res, 200, { packages: await android.packages(u.searchParams.get("serial")) }));
  POST("/api/app/launch", async (req, res) => {
    deviceFree();
    const b = await security.readJson(req);
    json(res, 200, await android.launch(b.serial, b.package, !!b.clearState));
  });
  /* ----- APKs: kept only in the local Apps/ folder, never uploaded anywhere ----- */
  function apkName(n) {
    const base = path.basename(String(n || "")).replace(/[^A-Za-z0-9._-]/g, "_");
    if (!/\.apk$/i.test(base) || base.length > 100 || base.startsWith(".")) throw new Error("Choose an .apk file");
    return base;
  }
  function apkFile(n) {
    const full = path.resolve(P.apps, apkName(n));
    if (!full.startsWith(P.apps + path.sep) || !fs.existsSync(full)) throw new Error("APK not found");
    return full;
  }
  GET("/api/apk/list", (req, res) => {
    fs.mkdirSync(P.apps, { recursive: true });
    const list = fs.readdirSync(P.apps).filter(f => /\.apk$/i.test(f)).map(f => {
      const st = fs.statSync(path.join(P.apps, f));
      return { name: f, size: st.size, mtime: st.mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);
    json(res, 200, { apks: list });
  });
  POST("/api/apk/upload", (req, res, u) => new Promise((resolve, reject) => {
    const name = apkName(u.searchParams.get("name"));
    if (!/^application\/octet-stream\b/i.test(String(req.headers["content-type"] || ""))) {
      const e = new Error("Expected a file"); e.status = 415; throw e;
    }
    if (Number(req.headers["content-length"] || 0) > APK_LIMIT) { const e = new Error("APK is larger than 800 MB"); e.status = 413; throw e; }
    fs.mkdirSync(P.apps, { recursive: true });
    const final = path.join(P.apps, name), part = final + ".part";
    const out = fs.createWriteStream(part);
    let size = 0, head = null, aborted = false;
    const abort = (msg, status) => {
      if (aborted) return; aborted = true;
      out.destroy(); try { fs.unlinkSync(part); } catch (_) {}
      const e = new Error(msg); e.status = status || 400; reject(e);
    };
    req.on("data", c => {
      if (!head) head = c.subarray(0, 4);
      size += c.length;
      if (size > APK_LIMIT) { req.unpipe(out); req.resume(); abort("APK is larger than 800 MB", 413); }
    });
    req.pipe(out);
    req.on("error", () => abort("Upload interrupted"));
    out.on("finish", () => {
      if (aborted) return;
      if (!head || head[0] !== 0x50 || head[1] !== 0x4b) return abort("That file is not a valid APK");
      fs.renameSync(part, final);
      android.apkPackage(final).then(pkg => { json(res, 200, { ok: true, name, size, package: pkg }); resolve(); });
    });
  }));
  POST("/api/apk/install", async (req, res) => {
    deviceFree();
    const b = await security.readJson(req);
    json(res, 200, await android.install(b.serial, apkFile(b.name)));
  });
  POST("/api/apk/delete", async (req, res) => {
    const b = await security.readJson(req);
    fs.unlinkSync(apkFile(b.name));
    json(res, 200, { ok: true });
  });
};
