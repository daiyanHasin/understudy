/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Android tooling: SDK discovery, devices, virtual devices, Wi-Fi phones,
 * snapshots, fast screen frames, input, and the screen-layout cache.
 *
 * Speed:
 *   - Frames use raw `screencap` (no PNG encoding on the device, which is the
 *     slow part) and are shrunk on this PC before going to the window.
 *   - The screen layout (uiautomator dump, 1-3 s) is read in the background
 *     as soon as the screen stops changing, so a tap usually finds it ready.
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

const WIN = process.platform === "win32";
const EXE = WIN ? ".exe" : "";
const LOG_DIR = path.join(__dirname, "..", "logs");

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
function tool(sub, name) {
  const root = sdkRoot();
  if (root) {
    const p = path.join(root, sub, name + EXE);
    if (fs.existsSync(p)) return p;
  }
  return name;   // fall back to PATH
}
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
    list.push({ serial: m[1], state: m[2], model: model.replace(/_/g, " "),
                emulator: m[1].startsWith("emulator-"), wifi: m[1].includes(":"), booted: false });
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
  // Hardware graphics is much faster; software rendering is the compatible fallback
  args.push("-gpu", software ? "swiftshader_indirect" : (headless ? "auto-no-window" : "auto"));
  if (opts.cold) args.push("-no-snapshot-load");

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, "emulator-" + name + ".log");
  const fd = fs.openSync(logFile, "w");
  const child = spawn(emulator(), args, { detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  const st = { started: Date.now(), exited: false, code: null, log: logFile };
  emuState.set(name, st);
  child.on("error", e => { st.exited = true; st.code = e.code || "error"; });
  child.on("exit", code => { st.exited = true; st.code = code; try { fs.closeSync(fd); } catch (_) {} });
  child.unref();
  return { ok: true, log: path.relative(path.join(__dirname, ".."), logFile).split(path.sep).join("/") };
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
  if (serial.startsWith("emulator-")) await run(adb(), ["-s", serial, "emu", "kill"], { timeout: 15000 });
  else if (serial.includes(":"))      await run(adb(), ["disconnect", serial], { timeout: 10000 });
  else throw new Error("This phone is connected by USB. Unplug the cable to disconnect it.");
  forget(serial);
  return { ok: true };
}

/* ---------- Phones over Wi-Fi (Android 11+ wireless debugging) ---------- */
async function pair(address, code) {
  if (!ADDR_RE.test(String(address || ""))) throw new Error("Enter the pairing address as IP:port");
  if (!/^\d{6}$/.test(String(code || ""))) throw new Error("The pairing code has 6 digits");
  const { stdout } = await run(adb(), ["pair", address, code], { timeout: 30000 });
  if (!/success/i.test(String(stdout))) throw new Error(String(stdout).trim() || "Pairing failed");
  return { ok: true };
}
async function connect(address) {
  if (!ADDR_RE.test(String(address || ""))) throw new Error("Enter the address as IP:port, e.g. 192.168.0.12:37123");
  const { stdout } = await run(adb(), ["connect", address], { timeout: 20000 });
  const t = String(stdout).trim();
  if (!/connected to/i.test(t) || /fail|unable|cannot/i.test(t)) throw new Error(t || "Could not connect");
  return { ok: true };
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

/* ---------- Fast frames + change detection ---------- */
const TARGET_W = 540;                  // frame width sent to the window
const devState = new Map();            // serial -> { hash, prevHash, frameInflight, ui:{hash,nodes,at}, dumping }

function stateOf(serial) {
  let s = devState.get(serial);
  if (!s) { s = { hash: 0, prevHash: -1, frameInflight: null, ui: null, dumping: null }; devState.set(serial, s); }
  return s;
}
function forget(serial) { devState.delete(serial); }

function fnv(buf, step) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < buf.length; i += step) { h ^= buf[i]; h = Math.imul(h, 16777619) >>> 0; }
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

/** One frame: { dw, dh (device px), w, h (sent), data (RGBA) }. Also feeds the layout cache. */
function frame(serial, opts) {
  checkSerial(serial);
  const s = stateOf(serial);
  if (s.frameInflight) return s.frameInflight;
  s.frameInflight = run(adb(), ["-s", serial, "exec-out", "screencap"], { encoding: "buffer", timeout: 10000 })
    .then(r => {
      const f = decodeRaw(r.stdout);
      s.prevHash = s.hash;
      s.hash = fnv(f.data, 61);
      s.size = { w: f.dw, h: f.dh };
      // Screen still for two frames and the cached layout is older: read it now, in the background
      if (opts && opts.prefetch && s.hash === s.prevHash && (!s.ui || s.ui.hash !== s.hash) && !s.dumping)
        refreshLayout(serial).catch(() => {});
      return f;
    })
    .finally(() => { s.frameInflight = null; });
  return s.frameInflight;
}

/* ---------- Input ---------- */
const KEYS = { back: 4, home: 3, enter: 66, tab: 61, del: 67, recents: 187, power: 26 };
function tap(serial, x, y) {
  return shell(serial, ["input", "tap", String(int(x, 0, 20000, "x")), String(int(y, 0, 20000, "y"))]);
}
function longPress(serial, x, y) {
  const X = String(int(x, 0, 20000, "x")), Y = String(int(y, 0, 20000, "y"));
  return shell(serial, ["input", "swipe", X, Y, X, Y, "800"]);
}
function swipe(serial, x1, y1, x2, y2, ms) {
  return shell(serial, ["input", "swipe",
    String(int(x1, 0, 20000, "x")), String(int(y1, 0, 20000, "y")),
    String(int(x2, 0, 20000, "x")), String(int(y2, 0, 20000, "y")),
    String(int(ms || 300, 50, 5000, "duration"))]);
}
function key(serial, name) {
  if (!(name in KEYS)) throw new Error("Unknown key");
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
  const re = /<node\s([^>]*?)(\/?)>|<\/node>/g;
  let m, i = 0;
  while ((m = re.exec(xml))) {
    if (m[0] === "</node>") { stack.pop(); continue; }
    const a = {};
    m[1].replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { a[k] = unxml(v); return ""; });
    const b = (a.bounds || "").match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    const node = b ? {
      i: i++, parent: stack.length ? stack[stack.length - 1] : -1,
      text: a.text || "", id: a["resource-id"] || "", desc: a["content-desc"] || "",
      hint: a.hint || "", cls: a.class || "", pkg: a.package || "",
      clickable: a.clickable === "true",
      editable: /EditText|AutoCompleteTextView|TextField/.test(a.class || ""),
      password: a.password === "true", scrollable: a.scrollable === "true",
      enabled: a.enabled !== "false", focused: a.focused === "true",
      x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4]
    } : null;
    if (node) nodes.push(node);
    if (m[2] !== "/") stack.push(node ? node.i : (stack.length ? stack[stack.length - 1] : -1));
  }
  return nodes;
}

async function dumpLayout(serial) {
  let out = "";
  try {
    out = String((await run(adb(), ["-s", serial, "exec-out", "uiautomator", "dump", "/dev/tty"], { timeout: 20000 })).stdout);
  } catch (_) {}
  if (!out.includes("<hierarchy")) {
    await shell(serial, ["uiautomator", "dump", "/sdcard/understudy-ui.xml"], { timeout: 20000 });
    out = String((await run(adb(), ["-s", serial, "exec-out", "cat", "/sdcard/understudy-ui.xml"], { timeout: 10000 })).stdout);
  }
  const a = out.indexOf("<?xml"), b = out.lastIndexOf("</hierarchy>");
  if (a < 0 || b < 0) throw new Error("Could not read the screen layout. Wait for animations to stop and try again.");
  return parseHierarchy(out.slice(a, b + 12));
}

function refreshLayout(serial) {
  const s = stateOf(serial);
  if (s.dumping) return s.dumping;
  const hashAtStart = s.hash;
  s.dumping = dumpLayout(serial)
    .then(nodes => {
      // Keep it only if the screen did not change while we were reading it
      if (s.hash === hashAtStart) s.ui = { hash: hashAtStart, nodes, at: Date.now() };
      return nodes;
    })
    .finally(() => { s.dumping = null; });
  return s.dumping;
}

/** Layout of what is on screen now: the cached one when the screen hasn't changed, else read it. */
async function layout(serial) {
  checkSerial(serial);
  const s = stateOf(serial);
  if (s.ui && s.ui.hash === s.hash && Date.now() - s.ui.at < 60000) return { nodes: s.ui.nodes, cached: true };
  try { return { nodes: await refreshLayout(serial), cached: false }; }
  catch (_) { await sleep(600); return { nodes: await dumpLayout(serial), cached: false }; }
}

/** Last layout read, with whether it still matches the screen (used when capturing taps made on the device). */
function lastLayout(serial) {
  const s = devState.get(serial);
  if (!s || !s.ui) return null;
  return { nodes: s.ui.nodes, fresh: s.ui.hash === s.hash, age: Date.now() - s.ui.at };
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
  for (const b of blocks) {
    const dev = (b.match(/add device \d+:\s*(\/dev\/input\/event\d+)/) || [])[1];
    const mx = (b.match(/ABS_MT_POSITION_X\s*:.*?max (\d+)/) || [])[1];
    const my = (b.match(/ABS_MT_POSITION_Y\s*:.*?max (\d+)/) || [])[1];
    if (dev && mx && my) return { dev, maxX: +mx, maxY: +my };
  }
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
  if (clearState) await shell(serial, ["pm", "clear", pkg]);
  await shell(serial, ["monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
  return { ok: true };
}

module.exports = {
  WIN, SERIAL_RE, PKG_RE, sdkRoot, adb, emulator, run, shell, shQuote,
  devices, avds, startAvd, avdProblem, stopDevice, pair, connect, snapshot,
  frame, layout, lastLayout, refreshLayout, parseHierarchy,
  tap, longPress, swipe, key, hideKeyboard, erase, text,
  screenSize, touchDevice, keyboardArea, packages, launch, aaptPath, apkPackage, install, checkSerial, checkPkg
};
