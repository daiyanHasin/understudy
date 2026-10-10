/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Android tooling: SDK discovery, devices, virtual devices, Wi-Fi phones,
 * snapshots, fast screen frames, input, and the screen-layout cache.
 *
 * Speed:
 *   - Screen frames: raw `screencap`, gzip-compressed on the phone (about 10x
 *     less to move than raw, much faster to make than a PNG), shrunk on this PC.
 *   - The screen layout (uiautomator dump, 1-3 s) is read in the background
 *     as soon as the screen stops changing, so a tap usually finds it ready.
 *     Every change of the screen bumps a counter (seq); a layout is valid for
 *     the seq it was read at. Blinking text cursors and the status-bar clock
 *     do not count as changes.
 *
 * Reliability:
 *   - Only ONE uiautomator command runs per device at a time (a second one
 *     makes Android kill the first: the "Killed" message).
 *   - If something else holds the device's UI automation (Maestro Studio, a
 *     leftover Maestro driver), it is released and the read is retried.
 *   - Layouts include every window (dialogs, keyboard, system bars) on
 *     Android versions that support it (`uiautomator dump --windows`).
 *
 * Safety:
 *   - host programs run with execFile/spawn and argument arrays, never a shell;
 *   - every value is validated (serial, AVD, package, address, numbers);
 *   - commands run on the device have every argument single-quoted.
 */

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");
const zlib = require("zlib");

const WIN = process.platform === "win32";
const EXE = WIN ? ".exe" : "";
const state = require("../core/state");
const P     = require("../core/paths");
const LOG_DIR = P.LOG_DIR;
const wifi  = require("./wifi");

const SERIAL_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const AVD_RE    = /^[A-Za-z0-9._-]{1,64}$/;
const PKG_RE    = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const ADDR_RE   = /^(\d{1,3}(\.\d{1,3}){3}|[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*):\d{2,5}$/;
const SNAPSHOT  = "understudy_clean";

/* ---------- SDK discovery ---------- */
function sdkRoot() {
  const c = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    WIN && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : null,
    path.join(os.homedir(), "Library", "Android", "sdk"),
    path.join(os.homedir(), "Android", "Sdk")
  ].filter(Boolean);
  for (const d of c) if (fs.existsSync(d)) return d;
  return null;
}
// Understudy's own copy (Setup > Install phone tools): tools/platform-tools/adb
const LOCAL_TOOLS = path.join(P.APP_DIR, "tools");
function tool(sub, name) {
  const root = sdkRoot();
  if (root) {
    const p = path.join(root, sub, name + EXE);
    if (fs.existsSync(p)) return p;
  }
  const local = path.join(LOCAL_TOOLS, sub, name + EXE);
  if (fs.existsSync(local)) return local;
  return name;   // fall back to PATH
}
/** Where adb comes from: "sdk", "understudy" (tools/platform-tools), "path" or "" (missing). */
function adbSource() {
  const p = adb();
  if (p === "adb") return "path";
  return p.startsWith(LOCAL_TOOLS) ? "understudy" : "sdk";
}
// Wi-Fi pairing by QR code needs adb's built-in network discovery (on by default in new adb; this turns it on for Windows builds that still ask)
if (!process.env.ADB_MDNS_OPENSCREEN) process.env.ADB_MDNS_OPENSCREEN = "1";
function aaptPath() {
  const root = sdkRoot();
  if (!root) return null;
  const bt = path.join(root, "build-tools");
  if (!fs.existsSync(bt)) return null;
  const vers = fs.readdirSync(bt).filter(v => /^\d/.test(v))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of vers) {
    const p = path.join(bt, v, "aapt" + EXE);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const adb      = () => tool("platform-tools", "adb");
const emulator = () => tool("emulator", "emulator");

/* ---------- Process helpers ---------- */
function run(file, args, opts) {
  opts = Object.assign({ timeout: 20000, maxBuffer: 96 * 1024 * 1024, windowsHide: true }, opts || {});
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        if (err.code === "ENOENT") err.message = path.basename(file) + " was not found. Open Setup to fix this.";
        else if (err.killed) err.message = path.basename(file) + " timed out";
        else err.message = (String(stderr || "").trim() || String(stdout || "").trim() || err.message)
                             .split(/\r?\n/).slice(-3).join(" ");
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}
function checkSerial(s) {
  if (!SERIAL_RE.test(String(s || ""))) throw new Error("Choose a device first");
  return String(s);
}
function checkPkg(p) {
  if (!PKG_RE.test(String(p || ""))) throw new Error("Invalid app ID");
  return String(p);
}
function int(n, min, max, what) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < min || v > max) throw new Error("Invalid " + what);
  return v;
}
const shQuote = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
function shell(serial, args, opts) {
  return run(adb(), ["-s", checkSerial(serial), "shell", args.map(shQuote).join(" ")], opts)
    .then(r => String(r.stdout));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Devices ---------- */
async function devices() {
  const { stdout } = await run(adb(), ["devices", "-l"], { timeout: 10000 });
  const list = [];
  for (const line of String(stdout).split(/\r?\n/).slice(1)) {
    const m = line.trim().match(/^(\S+)\s+(\S+)(.*)$/);
    if (!m || !SERIAL_RE.test(m[1])) continue;
    const model = (m[3].match(/model:(\S+)/) || [])[1] || "";
    // States: device (ready), unauthorized (tap Allow on the phone), offline, no permissions (Linux udev), authorizing, connecting
    let st = m[2];
    if (st === "no" && /permissions/.test(m[3])) st = "nopermission";
    list.push({ serial: m[1], state: st, model: model.replace(/_/g, " "),
                emulator: m[1].startsWith("emulator-"), wifi: isWifi(m[1]), booted: false });
  }
  await Promise.all(list.filter(d => d.state === "device").map(async d => {
    try { d.booted = (await shell(d.serial, ["getprop", "sys.boot_completed"], { timeout: 5000 })).trim() === "1"; }
    catch (_) {}
    if (d.emulator) {
      try {
        const { stdout } = await run(adb(), ["-s", d.serial, "emu", "avd", "name"], { timeout: 5000 });
        d.avd = String(stdout).split(/\r?\n/)[0].trim();
      } catch (_) {}
    }
  }));
  return list;
}

function isWifi(serial) { return serial.includes(":") || /\._adb-tls-connect\._tcp/.test(serial); }

async function avds() {
  try {
    const { stdout } = await run(emulator(), ["-list-avds"], { timeout: 15000 });
    return String(stdout).split(/\r?\n/).map(s => s.trim()).filter(s => AVD_RE.test(s));
  } catch (_) { return []; }
}

/* ---------- Virtual devices ---------- */
const emuState = new Map();   // avd -> { started, exited, code, log }

function startAvd(name, opts) {
  opts = opts || {};
  if (!AVD_RE.test(String(name || ""))) throw new Error("Invalid virtual device name");
  const headless = opts.headless !== false;
  const software = opts.graphics === "software";
  const args = ["-avd", name, "-no-boot-anim", "-no-audio", "-netdelay", "none", "-netspeed", "full"];
  if (headless) args.push("-no-window");
  // Light mode: for PCs with 8 GB of RAM or less
  if (opts.light) args.push("-memory", "1536", "-cores", "2", "-no-snapshot-save",
                            "-camera-back", "none", "-camera-front", "none", "-no-metrics");
  // Hardware graphics is much faster; software rendering is the compatible fallback
  args.push("-gpu", software ? "swiftshader_indirect" : (headless ? "auto-no-window" : "auto"));
  if (opts.cold) args.push("-no-snapshot-load");

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, "emulator-" + name + ".log");
  const fd = fs.openSync(logFile, "w");
  const child = spawn(emulator(), args, { detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  const st = { started: Date.now(), exited: false, code: null, log: logFile, pid: child.pid };
  emuState.set(name, st);
  child.on("error", e => { st.exited = true; st.code = e.code || "error"; });
  child.on("exit", code => { st.exited = true; st.code = code; try { fs.closeSync(fd); } catch (_) {} });
  child.unref();
  return { ok: true, log: path.relative(P.APP_DIR, logFile).split(path.sep).join("/") };
}

/** If a virtual device we started has quit, return the last lines of its log. */
function avdProblem(name) {
  const st = emuState.get(name);
  if (!st || !st.exited) return null;
  let tail = "";
  try {
    tail = fs.readFileSync(st.log, "utf8").split(/\r?\n/)
      .filter(l => /error|fatal|fail|cannot|unable|not supported|hax|whpx|hypervisor|vulkan|gpu/i.test(l))
      .slice(-6).join("\n");
  } catch (_) {}
  return { code: st.code, lines: tail || "The emulator closed without an error message.", log: "logs/emulator-" + name + ".log" };
}

async function stopDevice(serial) {
  checkSerial(serial);
  if (serial.startsWith("emulator-")) {
    let avd = "";
    try { avd = String((await run(adb(), ["-s", serial, "emu", "avd", "name"], { timeout: 5000 })).stdout).split(/\r?\n/)[0].trim(); } catch (_) {}
    try { await run(adb(), ["-s", serial, "emu", "kill"], { timeout: 15000 }); } catch (_) {}
    forget(serial);
    // `emu kill` asks nicely; make sure the emulator really leaves memory
    const freed = await waitGone(serial, avd, 12000);
    return { ok: true, freed };
  }
  if (isWifi(serial)) await run(adb(), ["disconnect", serial], { timeout: 10000 }).catch(() => {});
  else throw new Error("This phone is connected by USB. Unplug the cable to disconnect it.");
  forget(serial);
  return { ok: true };
}

/* Wait for an emulator to leave; end its processes if it hangs. */
async function waitGone(serial, avd, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await sleep(800);
    const list = await devices().catch(() => []);
    if (!list.some(d => d.serial === serial)) break;
  }
  const st = avd ? emuState.get(avd) : null;
  if (st && !st.exited && st.pid) { await killPid(st.pid); return "forced"; }
  if (await devices().then(l => l.some(d => d.serial === serial)).catch(() => false)) {
    await endProcesses(["emulator"]);
    return "forced";
  }
  return "clean";
}

function killPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve();
  if (WIN) return run("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 10000 }).catch(() => {});
  try { process.kill(pid, "SIGKILL"); } catch (_) {}
  return Promise.resolve();
}

/* ---------- Free memory: heavy Android processes on this PC ---------- */
const PROC_KINDS = {
  emulator: { label: "Android emulator", names: [/^qemu-system-.*\.exe$/i, /^emulator(64)?(-\w+)?\.exe$/i, /^qemu-system-/i, /^emulator$/i, /^netsimd(\.exe)?$/i] },
  adb:      { label: "ADB server", names: [/^adb(\.exe)?$/i] },
  studio:   { label: "Android Studio", names: [/^studio64\.exe$/i, /^studio\.exe$/i, /^studio$/i] }
};
function kindOf(name) { return Object.keys(PROC_KINDS).find(k => PROC_KINDS[k].names.some(re => re.test(name))) || null; }

async function processes() {
  const out = [];
  try {
    if (WIN) {
      const { stdout } = await run("tasklist", ["/FO", "CSV", "/NH"], { timeout: 15000 });
      for (const line of String(stdout).split(/\r?\n/)) {
        const c = line.match(/"([^"]*)"/g); if (!c || c.length < 5) continue;
        const name = c[0].slice(1, -1), pid = +c[1].slice(1, -1), mem = parseInt(c[4].replace(/[^\d]/g, ""), 10) * 1024 || 0;
        const kind = kindOf(name);
        if (kind) out.push({ name, pid, mem, kind });
      }
    } else {
      const { stdout } = await run("ps", ["-eo", "pid=,rss=,comm="], { timeout: 10000 });
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/); if (!m) continue;
        const name = path.basename(m[3]); const kind = kindOf(name);
        if (kind) out.push({ name, pid: +m[1], mem: +m[2] * 1024, kind });
      }
    }
  } catch (_) {}
  const groups = {};
  out.forEach(p => {
    const g = groups[p.kind] || (groups[p.kind] = { kind: p.kind, label: PROC_KINDS[p.kind].label, count: 0, mem: 0 });
    g.count++; g.mem += p.mem;
  });
  return Object.values(groups);
}

/** End processes by kind ("emulator", "adb", "studio"). Only those names, never anything else. */
async function endProcesses(kinds) {
  kinds = (Array.isArray(kinds) ? kinds : []).filter(k => PROC_KINDS[k]);
  if (kinds.includes("adb")) { try { await run(adb(), ["kill-server"], { timeout: 10000 }); } catch (_) {} }
  const ended = [];
  try {
    if (WIN) {
      const { stdout } = await run("tasklist", ["/FO", "CSV", "/NH"], { timeout: 15000 });
      for (const line of String(stdout).split(/\r?\n/)) {
        const c = line.match(/"([^"]*)"/g); if (!c || c.length < 2) continue;
        const name = c[0].slice(1, -1), pid = +c[1].slice(1, -1), kind = kindOf(name);
        if (kind && kinds.includes(kind)) { await killPid(pid); ended.push(name); }
      }
    } else {
      const { stdout } = await run("ps", ["-eo", "pid=,comm="], { timeout: 10000 });
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = line.trim().match(/^(\d+)\s+(.+)$/); if (!m) continue;
        const name = path.basename(m[2]), kind = kindOf(name);
        if (kind && kinds.includes(kind)) { await killPid(+m[1]); ended.push(name); }
      }
    }
  } catch (_) {}
  emuState.forEach(st => { if (kinds.includes("emulator")) st.exited = true; });
  devState.clear();
  return { ok: true, ended };
}

/* ---------- Phones over Wi-Fi (Android 11+ wireless debugging) ---------- */
async function pair(address, code) {
  if (!ADDR_RE.test(String(address || ""))) throw new Error("Enter the pairing address as IP:port");
  if (!/^\d{6}$/.test(String(code || ""))) throw new Error("The pairing code has 6 digits");
  // Reachable at all? Answers in 3 s instead of adb's long silent wait.
  const pre = await wifi.diagnose(address, "pair");
  if (!pre.ok) throw new Error(pre.message);
  let out = "";
  try { out = String((await run(adb(), ["pair", address, code], { timeout: 30000 })).stdout); }
  catch (e) { out = e.message; }
  if (!/success/i.test(out)) throw new Error(wifi.explainAdb(out, "pair") || out.trim() || "Pairing failed");
  return { ok: true, ip: wifi.split(address).host };
}
/* USB phone -> Wi-Fi with one click (works on every Android version):
   `adb tcpip 5555`, read the phone's IP, `adb connect IP:5555`. */
async function usbToWifi(serial) {
  checkSerial(serial);
  if (isWifi(serial) || serial.startsWith("emulator-")) throw new Error("Choose a phone connected by USB first");
  let ip = phoneWifiIp(await shell(serial, ["ip", "-f", "inet", "addr", "show"], { timeout: 8000 }).catch(() => ""));
  if (!ip) {
    const r = await shell(serial, ["ip", "route"], { timeout: 8000 }).catch(() => "");
    ip = (r.match(/src (\d+\.\d+\.\d+\.\d+)/) || [])[1];
  }
  if (!ip) throw new Error("The phone is not on Wi-Fi. Connect it to the same Wi-Fi as this PC and try again.");
  const nets = wifi.pcNetworks();
  if (nets.length && !wifi.sameNetwork(ip, nets))
    throw new Error("The phone (" + ip + ") and this PC (" + nets.filter(n => !n.virtual).map(n => n.address).join(", ") +
                    ") are on different networks. Connect both to the same Wi-Fi, then try again. The phone stays on USB.");
  await run(adb(), ["-s", serial, "tcpip", "5555"], { timeout: 15000 });
  await sleep(1500);
  const address = ip + ":5555";
  let lastErr = null;
  for (let i = 0; i < 5; i++) {               // the phone restarts its adb service: the first tries are often refused
    try { await connect(address); return { ok: true, address }; }
    catch (e) { lastErr = e; await sleep(1200); }
  }
  throw new Error(lastErr ? lastErr.message : "Could not connect over Wi-Fi.");
}

/* The phone's Wi-Fi address from `ip -f inet addr show`: wlan first, never
   mobile data (rmnet, ccmni), loopback or VPN interfaces. */
function phoneWifiIp(out) {
  const found = [];
  let dev = "";
  String(out || "").split(/\r?\n/).forEach(l => {
    const h = l.match(/^\d+:\s+([^:@\s]+)/); if (h) { dev = h[1]; return; }
    const m = l.match(/inet (\d+\.\d+\.\d+\.\d+)/); if (m && dev) found.push({ dev, ip: m[1] });
  });
  const ok = found.filter(x => !/^(lo|rmnet|ccmni|dummy|tun|ppp|r_rmnet|v4-|clat|ip6tnl|sit)/i.test(x.dev) && !/^127\./.test(x.ip));
  const w = ok.find(x => /^(wlan|swlan|wifi|eth)/i.test(x.dev)) || ok[0];
  return w ? w.ip : "";
}

/** "192.168.0.12" -> "192.168.0.12:5555"; spaces and a trailing slash removed. */
function normAddr(a) {
  let s = String(a || "").trim().replace(/\s+/g, "").replace(/\/+$/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) s += ":5555";
  return s;
}

async function connect(address) {
  address = normAddr(address);
  if (!ADDR_RE.test(address)) throw new Error("Enter the address as IP:port, e.g. 192.168.0.12:37123");
  // Reachable at all? A clear reason in 3 s instead of adb's “failed to connect” after 20 s.
  const pre = await wifi.diagnose(address, "connect");
  if (!pre.ok) throw new Error(pre.message);
  let t = "";
  try { t = String((await run(adb(), ["connect", address], { timeout: 20000 })).stdout).trim(); }
  catch (e) { t = e.message; }
  if (!/connected to/i.test(t) || /fail|unable|cannot/i.test(t)) throw new Error(wifi.explainAdb(t, "connect") || t || "Could not connect");
  // Connected is not the same as allowed: wait a moment for the phone's answer
  for (let i = 0; i < 8; i++) {
    const d = (await devices().catch(() => [])).find(x => x.serial === address);
    if (d && d.state === "device") return { ok: true, address };
    if (d && d.state === "unauthorized" && i >= 3) {
      throw new Error("Connected, but the phone has not allowed this PC. Unlock the phone and tap Allow, or pair it first (QR code or 6-digit code).");
    }
    await sleep(500);
  }
  return { ok: true, address };
}

/* ---------- Clean-state snapshots (virtual devices only) ---------- */
async function snapshot(serial, action) {
  checkSerial(serial);
  if (!serial.startsWith("emulator-")) throw new Error("Snapshots work on virtual devices only");
  if (action !== "save" && action !== "load") throw new Error("Unknown snapshot action");
  const { stdout } = await run(adb(), ["-s", serial, "emu", "avd", "snapshot", action, SNAPSHOT], { timeout: 120000 });
  if (/KO/.test(String(stdout))) throw new Error(String(stdout).replace(/\s+/g, " ").trim());
  forget(serial);
  return { ok: true };
}

/* ---------- Screen changes, fast frames ---------- */
const TARGET_W = 540;                  // frame width sent to the window
const devState = new Map();
const layoutListeners = [];

function stateOf(serial) {
  let s = devState.get(serial);
  if (!s) {
    s = { seq: 1, lastChange: Date.now(), recent: [], frameInflight: null, ui: null, dumping: null,
          uiLock: Promise.resolve(), size: null, noGzip: false };
    devState.set(serial, s);
  }
  return s;
}
function forget(serial) { devState.delete(serial); }

/** Something on the screen changed (new video frames, a tap we sent ...). */
function markChange(serial) {
  const s = stateOf(serial);
  s.seq++; s.lastChange = Date.now();
}
function screenInfo(serial) {
  const s = devState.get(serial);
  if (!s) return { seq: 0, still: false, layoutSeq: 0 };
  return { seq: s.seq, still: Date.now() - s.lastChange > 450, layoutSeq: s.ui ? s.ui.seq : 0, size: s.size };
}
function onLayout(fn) { layoutListeners.push(fn); }

/** Read the layout now if the screen is still and the cached one is old. */
function prefetch(serial) {
  const s = devState.get(serial);
  if (!s || state.busy || s.dumping) return;
  if (Date.now() - s.lastChange < 450) return;
  if (s.ui && s.ui.seq === s.seq) return;
  if (s.failAt && Date.now() - s.failAt < 3000) return;    // don't hammer a device that refuses
  refreshLayout(serial).catch(() => {});
}

function fnv(buf, from, to, step) {
  let h = 2166136261 >>> 0;
  for (let i = from; i < to; i += step) { h ^= buf[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

function decodeRaw(b) {
  if (!b || b.length < 16) throw new Error("No screen image (is the device unlocked?)");
  const w = b.readUInt32LE(0), h = b.readUInt32LE(4), f = b.readUInt32LE(8);
  if (!w || !h || w > 8000 || h > 8000) throw new Error("Unexpected screen data");
  const bpp = f === 4 ? 2 : 4;
  const hdr = b.length - w * h * bpp;
  if (hdr !== 12 && hdr !== 16) throw new Error("Unexpected screen data");
  const k = Math.max(1, Math.ceil(w / TARGET_W));
  const ow = Math.floor(w / k), oh = Math.floor(h / k);
  const out = Buffer.allocUnsafe(ow * oh * 4);
  let o = 0;
  for (let y = 0; y < oh; y++) {
    let src = hdr + (y * k * w) * bpp;
    for (let x = 0; x < ow; x++, src += k * bpp) {
      if (bpp === 4) {
        if (f === 5) { out[o] = b[src + 2]; out[o + 1] = b[src + 1]; out[o + 2] = b[src]; }   // BGRA
        else         { out[o] = b[src];     out[o + 1] = b[src + 1]; out[o + 2] = b[src + 2]; }
      } else {                                                                               // RGB565
        const v = b.readUInt16LE(src);
        out[o] = (v >> 11) << 3; out[o + 1] = ((v >> 5) & 63) << 2; out[o + 2] = (v & 31) << 3;
      }
      out[o + 3] = 255; o += 4;
    }
  }
  return { dw: w, dh: h, w: ow, h: oh, data: out };
}

/** One frame: { dw, dh (device px), w, h (sent), data (RGBA) }. Also feeds change detection. */
function frame(serial, opts) {
  checkSerial(serial);
  const s = stateOf(serial);
  if (s.frameInflight) return s.frameInflight;
  const grab = () => s.noGzip
    ? run(adb(), ["-s", serial, "exec-out", "screencap"], { encoding: "buffer", timeout: 10000 }).then(r => r.stdout)
    : run(adb(), ["-s", serial, "exec-out", "screencap | gzip -1"], { encoding: "buffer", timeout: 10000 }).then(r => {
        const b = r.stdout;
        if (b && b[0] === 0x1f && b[1] === 0x8b) return zlib.gunzipSync(b);
        s.noGzip = true;                       // phone without gzip (older Android): raw from now on
        return grab();
      });
  s.frameInflight = grab()
    .then(raw => {
      const f = decodeRaw(raw);
      // Skip the status bar (clock, signal) so it never counts as a change
      const from = Math.floor(f.h * 0.045) * f.w * 4;
      const h = fnv(f.data, from, f.data.length, 61);
      // A blinking cursor flips between two images: A B A B is still "still"
      if (s.recent[0] !== h && s.recent[1] !== h) markChange(serial);
      s.recent = [h, s.recent[0]];
      s.size = { w: f.dw, h: f.dh };
      if (opts && opts.prefetch) prefetch(serial);
      return f;
    })
    .finally(() => { s.frameInflight = null; });
  return s.frameInflight;
}

/* ---------- Input ---------- */
const KEYS = { back: 4, home: 3, enter: 66, tab: 61, del: 67, recents: 187, power: 26 };
function tap(serial, x, y) {
  markChange(serial);
  return shell(serial, ["input", "tap", String(int(x, 0, 20000, "x")), String(int(y, 0, 20000, "y"))]);
}
function longPress(serial, x, y) {
  const X = String(int(x, 0, 20000, "x")), Y = String(int(y, 0, 20000, "y"));
  markChange(serial);
  return shell(serial, ["input", "swipe", X, Y, X, Y, "800"]);
}
function swipe(serial, x1, y1, x2, y2, ms) {
  markChange(serial);
  return shell(serial, ["input", "swipe",
    String(int(x1, 0, 20000, "x")), String(int(y1, 0, 20000, "y")),
    String(int(x2, 0, 20000, "x")), String(int(y2, 0, 20000, "y")),
    String(int(ms || 300, 50, 5000, "duration"))]);
}
function key(serial, name) {
  if (!(name in KEYS)) throw new Error("Unknown key");
  markChange(serial);
  return shell(serial, ["input", "keyevent", String(KEYS[name])]);
}
async function keyboardShown(serial) {
  return /mInputShown=true/.test(await shell(serial, ["dumpsys", "input_method"], { timeout: 8000 }));
}
async function hideKeyboard(serial) { if (await keyboardShown(serial)) await key(serial, "back"); }
function erase(serial, n) {
  const count = int(n || 50, 1, 200, "count");
  return shell(serial, ["input", "keyevent", "123"].concat(new Array(count).fill("67")));
}

const ADB_IME = "com.android.adbkeyboard/.AdbIME";
async function text(serial, value) {
  const s = String(value == null ? "" : value);
  if (!s.length) return;
  if (s.length > 1000) throw new Error("Text is too long (1000 characters max)");
  if (/^[\x20-\x7e]+$/.test(s)) return shell(serial, ["input", "text", s.replace(/ /g, "%s")]);
  const imes = await shell(serial, ["ime", "list", "-s"]);
  if (!imes.includes(ADB_IME))
    throw new Error("To type non-English text, install ADB Keyboard on the device. See Setup.");
  const prev = (await shell(serial, ["settings", "get", "secure", "default_input_method"])).trim();
  await shell(serial, ["ime", "enable", ADB_IME]);
  await shell(serial, ["ime", "set", ADB_IME]);
  await sleep(300);
  await shell(serial, ["am", "broadcast", "-a", "ADB_INPUT_B64", "--es", "msg", Buffer.from(s, "utf8").toString("base64")]);
  if (prev && prev !== ADB_IME && /^[\w.\/]+$/.test(prev)) { await sleep(300); await shell(serial, ["ime", "set", prev]); }
}

/* ---------- Screen layout ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
const unxml = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
               : (ENT[e] !== undefined ? ENT[e] : m));

function parseHierarchy(xml) {
  const nodes = [];
  const stack = [];
  // <window> tags appear with `dump --windows`: remember which window (and its layer) a node is in
  const re = /<window\s([^>]*?)>|<\/window>|<node\s([^>]*?)(\/?)>|<\/node>/g;
  let m, i = 0, win = { idx: 0, layer: 0, type: "", title: "" }, wins = 0;
  while ((m = re.exec(xml))) {
    if (m[0] === "</node>") { stack.pop(); continue; }
    if (m[0] === "</window>") { stack.length = 0; continue; }
    if (m[1] !== undefined) {
      const wa = {};
      m[1].replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { wa[k] = unxml(v); return ""; });
      win = { idx: ++wins, layer: parseInt(wa.layer, 10) || 0, type: wa.type || "", title: wa.title || "" };
      stack.length = 0;
      continue;
    }
    const a = {};
    m[2].replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { a[k] = unxml(v); return ""; });
    const b = (a.bounds || "").match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    const node = b ? {
      i: i++, parent: stack.length ? stack[stack.length - 1] : -1,
      text: a.text || "", id: a["resource-id"] || "", desc: a["content-desc"] || "",
      hint: a.hint || "", cls: a.class || "", pkg: a.package || "",
      clickable: a.clickable === "true", checkable: a.checkable === "true", checked: a.checked === "true",
      editable: /EditText|AutoCompleteTextView|TextField/.test(a.class || ""),
      password: a.password === "true", scrollable: a.scrollable === "true",
      enabled: a.enabled !== "false", focused: a.focused === "true", selected: a.selected === "true",
      x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4],
      win: win.idx, layer: win.layer, wtype: win.type
    } : null;
    if (node) nodes.push(node);
    if (m[3] !== "/") stack.push(node ? node.i : (stack.length ? stack[stack.length - 1] : -1));
  }
  return nodes;
}

/* All uiautomator calls for one device go through this queue. Two at once
   make Android kill one of them, which is where "Killed" came from. */
function withUiLock(serial, fn) {
  const s = stateOf(serial);
  const p = s.uiLock.then(fn, fn);
  s.uiLock = p.then(() => {}, () => {});
  return p;
}

const HOLDERS = ["dev.mobile.maestro", "dev.mobile.maestro.test", "io.appium.uiautomator2.server", "io.appium.uiautomator2.server.test"];
const BLOCKED_RE = /Killed|null root node|UiAutomation not connected|already registered|Can't register UiAutomationService|SecurityException/i;
// Android only describes a screen that has stopped moving for a moment. A spinner,
// video or endless animation makes `uiautomator dump` wait ~10 s and give up.
const IDLE_RE = /could not get idle state/i;
const IDLE_MSG = "The screen never stops moving (an animation, video or loading spinner), so Android won't describe it. " +
                 "Wait for it to finish, or tick \u201CTurn off phone animations\u201D in Add device. This step uses the screen position.";

/** Something else (Maestro Studio, a leftover test driver) owns UI automation: release it. */
async function releaseUiAutomation(serial) {
  if (state.busy) return false;                 // a Maestro run legitimately owns it
  for (const p of HOLDERS) { try { await shell(serial, ["am", "force-stop", p], { timeout: 6000 }); } catch (_) {} }
  await sleep(400);
  return true;
}

async function dumpOnce(serial) {
  const s = stateOf(serial);
  const winFlag = s.noWindows ? [] : ["--windows"];
  let out = "", err = "";
  try {
    const r = await run(adb(), ["-s", serial, "exec-out", "uiautomator", "dump"].concat(winFlag, ["/dev/tty"]), { timeout: 20000 });
    out = String(r.stdout); err = String(r.stderr || "");
  } catch (e) { err = e.message; }
  if (!out.includes("<hierarchy") && IDLE_RE.test(err + out)) {
    // Asking again through a file would wait another 10 s for the same answer
    const e = new Error(IDLE_MSG); e.code = "IDLE"; throw e;
  }
  if (!out.includes("<hierarchy")) {
    // Some devices can't write to /dev/tty: use a file
    try {
      const r = await run(adb(), ["-s", serial, "shell", ["uiautomator", "dump"].concat(winFlag, ["/sdcard/understudy-ui.xml"]).join(" ")], { timeout: 20000 });
      err += " " + String(r.stdout) + String(r.stderr || "");
      out = String((await run(adb(), ["-s", serial, "exec-out", "cat", "/sdcard/understudy-ui.xml"], { timeout: 10000 })).stdout);
    } catch (e) { err += " " + e.message; }
  }
  const a = out.indexOf("<?xml"), b = out.lastIndexOf("</hierarchy>");
  if (a < 0 || b < 0) {
    if (IDLE_RE.test(err + out)) { const ie = new Error(IDLE_MSG); ie.code = "IDLE"; throw ie; }
    const e = new Error(BLOCKED_RE.test(err + out) ? "BLOCKED" : "Could not read the screen layout. Wait for animations to stop and try again.");
    e.detail = (err + " " + out).trim().slice(-200);
    throw e;
  }
  const nodes = parseHierarchy(out.slice(a, b + 12));
  // --windows not supported on this Android version: it returned the old format, fine.
  // If it returned nothing usable, stop asking for windows on this device.
  if (!nodes.length && !s.noWindows) { s.noWindows = true; return dumpOnce(serial); }
  return nodes;
}

async function dumpLayout(serial) {
  return withUiLock(serial, async () => {
    try { return await dumpOnce(serial); }
    catch (e) {
      if (e.message !== "BLOCKED") throw e;
      // Retry once after releasing UI automation from whoever holds it
      const released = await releaseUiAutomation(serial);
      try { return await dumpOnce(serial); }
      catch (e2) {
        throw new Error(released
          ? "Android stopped the screen reader (\u201CKilled\u201D). Close Maestro Studio / Maestro Desktop if it is open on this device, then try again."
          : "The device is busy running a test. Wait for it to finish.");
      }
    }
  });
}

function refreshLayout(serial) {
  const s = stateOf(serial);
  if (s.dumping) return s.dumping;
  const seqAtStart = s.seq;
  s.dumping = dumpLayout(serial)
    .then(nodes => {
      s.failAt = 0;
      // Keep it only if the screen did not change while we were reading it
      if (s.seq === seqAtStart) {
        s.ui = { seq: seqAtStart, nodes, at: Date.now() };
        layoutListeners.forEach(fn => { try { fn(serial, s.ui); } catch (_) {} });
      }
      return nodes;
    })
    .catch(e => { s.failAt = Date.now(); throw e; })
    .finally(() => { s.dumping = null; });
  return s.dumping;
}

/**
 * Layout of what is on screen now: the cached one when the screen hasn't
 * changed, else read it. `seq` = "the layout the user was looking at":
 * when that one is still cached it is used even if the screen moved since
 * (e.g. the press ripple of the tap that is being recorded).
 */
async function layout(serial, seq) {
  checkSerial(serial);
  const s = stateOf(serial);
  if (s.ui && (s.ui.seq === s.seq || (seq && s.ui.seq === Number(seq))) && Date.now() - s.ui.at < 120000)
    return { nodes: s.ui.nodes, cached: true, seq: s.ui.seq };
  try { const nodes = await refreshLayout(serial); return { nodes, cached: false, seq: s.ui ? s.ui.seq : s.seq }; }
  catch (e) {
    if (/Killed|busy/.test(e.message) || e.code === "IDLE") throw e;
    await sleep(600);
    return { nodes: await dumpLayout(serial), cached: false, seq: s.seq };
  }
}

/** Last layout read, with whether it still matches the screen (used when capturing taps made on the device). */
function lastLayout(serial) {
  const s = devState.get(serial);
  if (!s || !s.ui) return null;
  return { nodes: s.ui.nodes, fresh: s.ui.seq === s.seq, age: Date.now() - s.ui.at, seq: s.ui.seq,
           stillFor: Date.now() - s.lastChange };
}

/* ---------- Device facts used by capture ---------- */
async function screenSize(serial) {
  const out = await shell(serial, ["wm", "size"]);
  const all = [...out.matchAll(/(\d+)x(\d+)/g)];
  if (!all.length) throw new Error("Could not read the screen size");
  const m = all[all.length - 1];          // Override size wins over Physical size
  return { w: +m[1], h: +m[2] };
}

async function touchDevice(serial) {
  const out = await shell(serial, ["getevent", "-lp"], { timeout: 10000 });
  const blocks = out.split(/(?=add device \d+:)/);
  const found = [];
  for (const b of blocks) {
    const dev = (b.match(/add device \d+:\s*(\/dev\/input\/event\d+)/) || [])[1];
    const name = (b.match(/name:\s*"([^"]*)"/) || [])[1] || "";
    const mx = (b.match(/ABS_MT_POSITION_X\s*:.*?max (\d+)/) || [])[1];
    const my = (b.match(/ABS_MT_POSITION_Y\s*:.*?max (\d+)/) || [])[1];
    if (dev && mx && my && +mx > 0 && +my > 0) found.push({ dev, name, maxX: +mx, maxY: +my });
  }
  // Phones can list a pen, a fingerprint sensor or a virtual input next to the screen: prefer the touch screen
  const NOT_SCREEN = /pen|stylus|wacom|fingerprint|uinput|virtual|mouse|gamepad|joystick/i;
  const LOOKS_SCREEN = /touch|_ts\b|^ts|sec_touch|fts|goodix|synaptics|himax|novatek|focaltech|ilitek|atmel|elan|nvt|xiaomi-touch/i;
  const pick = found.find(d => LOOKS_SCREEN.test(d.name) && !NOT_SCREEN.test(d.name)) ||
               found.find(d => !NOT_SCREEN.test(d.name)) || found[0];
  if (pick) return { dev: pick.dev, maxX: pick.maxX, maxY: pick.maxY, name: pick.name };
  throw new Error("Could not find the touch screen on this device");
}

async function keyboardArea(serial) {
  try {
    if (!(await keyboardShown(serial))) return null;
    const out = await shell(serial, ["dumpsys", "window", "InputMethod"], { timeout: 8000 });
    const all = [...out.matchAll(/(?:mFrame|frame)=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/g)]
      .map(m => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }))
      .filter(r => r.y1 > 0 && r.y2 > r.y1);
    return all.length ? all[0] : null;
  } catch (_) { return null; }
}

async function packages(serial) {
  const out = await shell(serial, ["pm", "list", "packages", "-3"]);
  return out.split(/\r?\n/).map(l => l.replace(/^package:/, "").trim()).filter(p => PKG_RE.test(p)).sort();
}

/**
 * Apps on the device that have an icon in the launcher (includes Chrome,
 * Settings, Camera ... which `pm list -3` leaves out), plus where each comes from.
 *   [{ id, user: true|false }]
 */
async function apps(serial) {
  checkSerial(serial);
  const user = new Set(await packages(serial).catch(() => []));
  let launch = [];
  try {
    const out = await shell(serial, ["cmd", "package", "query-activities", "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER"], { timeout: 15000 });
    launch = [...out.matchAll(/^\s*([A-Za-z][\w.]*)\/[\w.$]+\s*$/gm)].map(m => m[1]);
    if (!launch.length) launch = [...out.matchAll(/packageName=([A-Za-z][\w.]*)/g)].map(m => m[1]);
  } catch (_) {}
  const all = new Set([...launch.filter(p => PKG_RE.test(p)), ...user]);
  return [...all].sort((a, b) => (user.has(b) - user.has(a)) || a.localeCompare(b)).map(id => ({ id, user: user.has(id) }));
}

/** The app in front right now (package name), or "". */
async function foreground(serial) {
  checkSerial(serial);
  try {
    const out = await shell(serial, ["dumpsys", "window", "displays"], { timeout: 6000 });
    const m = out.match(/mCurrentFocus=.*?\s([A-Za-z][\w.]*)\/[\w.$]+/) || out.match(/mFocusedApp=.*?\s([A-Za-z][\w.]*)\/[\w.$]+/);
    if (m && PKG_RE.test(m[1])) return m[1];
  } catch (_) {}
  try {
    const out = await shell(serial, ["dumpsys", "activity", "activities"], { timeout: 8000 });
    const m = out.match(/(?:mResumedActivity|topResumedActivity|ResumedActivity)[^\n]*?\s([A-Za-z][\w.]*)\/[\w.$]+/);
    if (m && PKG_RE.test(m[1])) return m[1];
  } catch (_) {}
  return "";
}
/* ---------- APKs ---------- */
async function apkPackage(file) {
  const aapt = aaptPath();
  if (!aapt) return null;
  try {
    const { stdout } = await run(aapt, ["dump", "badging", file], { timeout: 30000 });
    const m = String(stdout).match(/package: name='([^']+)'/);
    return m && PKG_RE.test(m[1]) ? m[1] : null;
  } catch (_) { return null; }
}
async function install(serial, file) {
  checkSerial(serial);
  const before = new Set(await packages(serial).catch(() => []));
  await run(adb(), ["-s", serial, "install", "-r", "-g", file], { timeout: 5 * 60 * 1000 });
  let pkg = await apkPackage(file);
  if (!pkg) {
    const added = (await packages(serial).catch(() => [])).filter(p => !before.has(p));
    if (added.length === 1) pkg = added[0];
  }
  return { ok: true, package: pkg };
}

async function launch(serial, pkg, clearState) {
  checkPkg(pkg);
  markChange(serial);
  if (clearState) await shell(serial, ["pm", "clear", pkg]);
  await shell(serial, ["monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
  return { ok: true };
}

/** Open a web address on the device (browser or the app that handles it). */
async function openLink(serial, url) {
  if (!/^(https?:\/\/|[a-z][a-z0-9+.-]*:\/\/)[^\s'"]{1,2000}$/i.test(String(url || ""))) throw new Error("Enter a full link, e.g. https://example.com");
  markChange(serial);
  await shell(serial, ["am", "start", "-a", "android.intent.action.VIEW", "-d", String(url)]);
  return { ok: true };
}

module.exports = {
  WIN, SERIAL_RE, PKG_RE, sdkRoot, adb, adbSource, isWifi, emulator, run, shell, shQuote, sleep,
  devices, avds, startAvd, avdProblem, stopDevice, pair, connect, usbToWifi, snapshot, normAddr, phoneWifiIp,
  frame, layout, lastLayout, refreshLayout, parseHierarchy, markChange, screenInfo, prefetch, onLayout, stateOf,
  tap, longPress, swipe, key, hideKeyboard, erase, text, openLink, KEYS,
  screenSize, touchDevice, keyboardArea, packages, apps, foreground, launch, aaptPath, apkPackage, install,
  checkSerial, checkPkg, processes, endProcesses, releaseUiAutomation
};
