/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Wi-Fi phones without a cable and without typing addresses (Android 11+):
 *
 *   1. Understudy shows a QR code: WIFI:T:ADB;S:<name>;P:<password>;;
 *   2. On the phone: Developer options > Wireless debugging >
 *      Pair device with QR code, and scan it.
 *   3. The phone announces a pairing service called <name> on the local
 *      network. Understudy finds it (adb mdns), pairs with the password,
 *      then finds the phone's connect service and connects.
 *
 * Same mechanism Android Studio uses. Nothing leaves the local network.
 * One session at a time; it ends by itself after 3 minutes.
 *
 * Where it fails in practice (and what this file does about it):
 *   - adb's network discovery is off: restart adb once with it on (only when
 *     no test is running), else say so and point to "Pair with a code".
 *   - office / guest Wi-Fi blocks discovery (multicast) or keeps devices
 *     apart: after 40 s without the phone showing up, say so.
 *   - pairing works but the connect step fails: lib/wifi.js explains why.
 */

const crypto  = require("crypto");
const android = require("./android");
const qr      = require("./qr");
const wifi    = require("./wifi");

const TIMEOUT_MS = 3 * 60 * 1000;
const ALNUM = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let S = null;

function rand(n) {
  const b = crypto.randomBytes(n);
  let s = ""; for (let i = 0; i < n; i++) s += ALNUM[b[i] % ALNUM.length];
  return s;
}

/** Parse `adb mdns services`. */
function parseServices(out) {
  const list = [];
  String(out).split(/\r?\n/).forEach(line => {
    const m = line.trim().match(/^(\S+)\s+(_adb-tls-(?:pairing|connect)\._tcp)\.?\s+(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/);
    if (m) list.push({ name: m[1], type: m[2].includes("pairing") ? "pairing" : "connect", ip: m[3], port: +m[4] });
  });
  return list;
}

async function services() {
  const r = await android.run(android.adb(), ["mdns", "services"], { timeout: 8000 });
  return parseServices(r.stdout);
}

async function mdnsWorks() {
  try {
    const r = await android.run(android.adb(), ["mdns", "check"], { timeout: 8000 });
    return !/unavailable|not supported|error/i.test(String(r.stdout) + String(r.stderr));
  } catch (_) { return false; }
}

/* An adb server started earlier without network discovery (by another tool,
   or an old adb) keeps it off until it restarts. Restart it once, only when
   opts.canRestart() says nothing is using the device. */
async function ensureMdns(opts) {
  if (await mdnsWorks()) return true;
  if (!opts || !opts.canRestart || !opts.canRestart()) return false;
  try { if (opts.beforeRestart) opts.beforeRestart(); } catch (_) {}
  try { await android.run(android.adb(), ["kill-server"], { timeout: 10000 }); } catch (_) {}
  try { await android.run(android.adb(), ["start-server"], { timeout: 20000 }); } catch (_) {}
  return mdnsWorks();
}

/** After pairing by code: find the phone's connect address on the network (a few seconds). */
async function findConnect(ip, ms) {
  const until = Date.now() + (ms || 6000);
  while (Date.now() < until) {
    const devs = await android.devices().catch(() => []);
    const auto = devs.find(d => d.state === "device" && d.serial.startsWith(ip + ":"));
    if (auto) return { serial: auto.serial, already: true };
    const c = (await services().catch(() => [])).find(x => x.type === "connect" && x.ip === ip);
    if (c) return { address: c.ip + ":" + c.port };
    await android.sleep(1000);
  }
  return null;
}

function start(opts) {
  stop();
  const name = "understudy-" + rand(8);
  const password = rand(10);
  const text = "WIFI:T:ADB;S:" + name + ";P:" + password + ";;";
  S = { name, password, state: "waiting", message: "Scan the code with the phone", serial: "", at: Date.now(),
        timer: null, busy: false, ip: "", mdns: null, hint: "" };
  const s = S;
  ensureMdns(opts).then(ok => {
    if (S !== s) return;
    s.mdns = ok;
    if (!ok) s.hint = "This PC's adb can't look for phones on the network, so scanning won't work here. Use \u201CPair with a 6-digit code\u201D below.";
    s.timer = setInterval(() => tick(s).catch(() => {}), 1200);
  });
  return { name, svg: qr.svg(text), expires: TIMEOUT_MS };
}

async function tick(s) {
  if (s !== S || s.busy || s.state === "connected" || s.state === "error") return;
  if (Date.now() - s.at > TIMEOUT_MS) { finish(s, "error", "The code expired. Make a new one and scan it within 3 minutes."); return; }
  s.busy = true;
  try {
    const list = await services().catch(() => []);
    if (s.state === "waiting") {
      const p = list.find(x => x.type === "pairing" && x.name === s.name);
      if (!p) {
        if (!s.hint && Date.now() - s.at > 40000)
          s.hint = "Scanned but nothing happens? Office and guest Wi-Fi often block how phones announce themselves. " +
                   "Use \u201CPair with a 6-digit code\u201D below, or connect the phone to this PC's Mobile hotspot.";
        return;
      }
      s.state = "pairing"; s.message = "Pairing with the phone\u2026"; s.ip = p.ip;
      const r = await android.run(android.adb(), ["pair", p.ip + ":" + p.port, s.password], { timeout: 30000 })
        .catch(e => ({ stdout: e.message }));
      if (!/success/i.test(String(r.stdout))) {
        const why = wifi.explainAdb(r.stdout, "pair");
        if (!why) {
          const d = await wifi.diagnose(p.ip + ":" + p.port, "pair");
          if (!d.ok) { finish(s, "error", d.message); return; }
        }
        finish(s, "error", why || ("Pairing failed: " + String(r.stdout).trim().split(/\r?\n/).pop()));
        return;
      }
      s.state = "connecting"; s.message = "Paired. Connecting\u2026"; s.pairedAt = Date.now();
      return;
    }
    if (s.state === "connecting") {
      // adb often connects to a freshly paired phone by itself
      const devs = await android.devices().catch(() => []);
      const auto = devs.find(d => d.state === "device" && (d.serial.startsWith(s.ip + ":") || /_adb-tls-connect/.test(d.serial)));
      if (auto) { finish(s, "connected", "Connected", auto.serial); return; }
      const c = list.find(x => x.type === "connect" && x.ip === s.ip);
      if (c) {
        const addr = c.ip + ":" + c.port;
        try { await android.connect(addr); finish(s, "connected", "Connected", addr); return; }
        catch (e) { s.lastError = e.message; }
      }
      if (Date.now() - s.pairedAt > 25000)
        finish(s, "error", s.lastError ||
          "Paired, but the phone did not offer a connection. Enter the \u201CIP address & Port\u201D shown at the top of Wireless debugging in \u201CConnect by address\u201D below.");
    }
  } finally { s.busy = false; }
}

function finish(s, state, message, serial) {
  s.state = state; s.message = message; if (serial) s.serial = serial;
  clearInterval(s.timer); s.timer = null;
}

function status() {
  if (!S) return { state: "idle" };
  return { state: S.state, message: S.message, serial: S.serial, name: S.name, mdns: S.mdns, hint: S.hint,
           left: Math.max(0, Math.round((TIMEOUT_MS - (Date.now() - S.at)) / 1000)) };
}
function stop() { if (S && S.timer) clearInterval(S.timer); S = null; return { ok: true }; }

module.exports = { start, status, stop, parseServices, findConnect, ensureMdns };
