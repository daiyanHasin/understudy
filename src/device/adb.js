/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * adb basics used by every other device file:
 *   - where adb / emulator / aapt are (Android SDK, Understudy's own tools/, or PATH)
 *   - run(file, args)  execFile with argument arrays (never a shell)
 *   - shell(serial, args)  `adb shell` with every argument single-quoted
 *   - input checks: checkSerial, checkPkg, int
 *   - devices()  the list `adb devices -l` reports, with boot state
 *
 * Safety: host programs run with execFile and argument arrays, never a shell;
 * every value is validated; device-side arguments are single-quoted.
 */
const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { execFile } = require("child_process");
const P    = require("../core/paths");

const WIN = process.platform === "win32";
const EXE = WIN ? ".exe" : "";
const SERIAL_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const AVD_RE    = /^[A-Za-z0-9._-]{1,64}$/;
const PKG_RE    = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const ADDR_RE   = /^(\d{1,3}(\.\d{1,3}){3}|[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*):\d{2,5}$/;

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
/*
 * devices() is polled by several screens at once (Record tab every 2.5 s, Add device every
 * 1.5 s, the Wi-Fi connect loop every 0.5 s). Before 2.0.1 every call started its own
 * `adb devices -l` plus one `getprop` per device plus `emu avd name` per emulator. Polls
 * overlapped (a Wi-Fi phone's getprop can take up to 5 s), so adb had a queue of commands
 * in front of every screenshot and every `adb pair` / `adb connect`.
 * Now:
 *   - callers that ask while a read is running share that read (no pile-up)
 *   - a result younger than LIST_TTL is reused
 *   - "booted" and the AVD name are remembered per serial; only devices not yet booted
 *     are asked again. Forgotten as soon as the serial leaves the list.
 */
const LIST_TTL = 700;
let listInflight = null, listLast = null;
const bootedSeen = new Set();          // serials that reported sys.boot_completed=1
const avdNames   = new Map();          // emulator serial -> AVD name

async function readDevices() {
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
  // Forget what we knew about devices that are gone or not ready (a rebooted phone boots again)
  const ready = new Set(list.filter(d => d.state === "device").map(d => d.serial));
  for (const s of Array.from(bootedSeen)) if (!ready.has(s)) bootedSeen.delete(s);
  for (const s of Array.from(avdNames.keys())) if (!ready.has(s)) avdNames.delete(s);

  await Promise.all(list.filter(d => d.state === "device").map(async d => {
    if (bootedSeen.has(d.serial)) d.booted = true;
    else {
      try { d.booted = (await shell(d.serial, ["getprop", "sys.boot_completed"], { timeout: 5000 })).trim() === "1"; }
      catch (_) {}
      if (d.booted) bootedSeen.add(d.serial);
    }
    if (d.emulator) {
      if (avdNames.has(d.serial)) d.avd = avdNames.get(d.serial);
      else {
        try {
          const { stdout } = await run(adb(), ["-s", d.serial, "emu", "avd", "name"], { timeout: 5000 });
          d.avd = String(stdout).split(/\r?\n/)[0].trim();
          if (d.avd) avdNames.set(d.serial, d.avd);
        } catch (_) {}
      }
    }
  }));
  return list;
}

/** Devices adb reports, with boot state. opts.fresh skips the short cache (still shares a running read). */
function devices(opts) {
  const fresh = !!(opts && opts.fresh);
  if (!fresh && listLast && Date.now() - listLast.at < LIST_TTL) return Promise.resolve(copyList(listLast.list));
  if (listInflight) return listInflight.then(copyList);
  listInflight = readDevices()
    .then(list => { listLast = { at: Date.now(), list }; return list; })
    .finally(() => { listInflight = null; });
  return listInflight.then(copyList);
}
const copyList = l => l.map(d => Object.assign({}, d));
/** Drop cached device facts (after connect / disconnect / stop, so the next list is read anew). */
function forgetDevices(serial) {
  listLast = null;
  if (serial) { bootedSeen.delete(serial); avdNames.delete(serial); }
}

function isWifi(serial) { return serial.includes(":") || /\._adb-tls-connect\._tcp/.test(serial); }

module.exports = {
  WIN, SERIAL_RE, AVD_RE, PKG_RE, ADDR_RE, LOCAL_TOOLS,
  sdkRoot, tool, adb, emulator, adbSource, aaptPath,
  run, shell, shQuote, sleep, checkSerial, checkPkg, int,
  devices, forgetDevices, isWifi
};
