/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Virtual devices (emulators) and heavy Android processes on this PC:
 *   avds, startAvd, avdProblem (why one closed), stopDevice (emulator or Wi-Fi phone),
 *   snapshot (clean-state save/load), processes / endProcesses ("Free memory").
 */
const fs   = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const P      = require("../core/paths");
const LOG_DIR = P.LOG_DIR;
const { WIN, AVD_RE, adb, emulator, run, checkSerial, sleep, devices, isWifi } = require("./adb");
const screen = require("./screen");
const forget = serial => screen.forget(serial);
const SNAPSHOT = "understudy_clean";

/* `emulator -list-avds` starts emulator.exe (about 0.5-1.5 s on Windows) and was run on
   every device-list poll (every 1.5-2.5 s). The list only changes when a virtual device is
   installed, so it is kept for AVD_TTL and shared between callers. */
const AVD_TTL = 30000;
let avdCache = null, avdInflight = null;
function avds() {
  if (avdCache && Date.now() - avdCache.at < AVD_TTL) return Promise.resolve(avdCache.list.slice());
  if (avdInflight) return avdInflight.then(l => l.slice());
  avdInflight = run(emulator(), ["-list-avds"], { timeout: 15000 })
    .then(({ stdout }) => String(stdout).split(/\r?\n/).map(s => s.trim()).filter(s => AVD_RE.test(s)))
    .catch(() => [])
    .then(list => { avdCache = { at: Date.now(), list }; return list; })
    .finally(() => { avdInflight = null; });
  return avdInflight.then(l => l.slice());
}
function forgetAvds() { avdCache = null; }

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
  screen.forgetAll();
  return { ok: true, ended };
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

module.exports = {
  avds, forgetAvds, startAvd, avdProblem, stopDevice, snapshot, processes, endProcesses
};
