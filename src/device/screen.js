/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Screen frames for the Record tab, and "did the screen change?" tracking.
 *
 * One frame = `adb exec-out screencap`, shrunk on this PC to 540 px wide and sent
 * to the window as raw RGBA.
 *
 * Speed (frames per second) comes from three things:
 *   1. Read-ahead: as soon as one screenshot has arrived from the phone, the next
 *      one is already being taken while this one is decoded, sent and drawn.
 *      Before, those steps ran one after another, so the window waited for all
 *      of them every frame.
 *   2. The best transfer per device: raw (no work on the phone, more to move) or
 *      gzip (phone compresses, ~10x less to move). Over USB raw is often faster,
 *      over Wi-Fi gzip almost always is. The first four frames of a USB device or
 *      emulator try both and keep the faster one. Wi-Fi phones use gzip.
 *   3. gunzip runs off the main thread, so the server stays responsive.
 * Read-ahead is skipped while a test is running, so it never slows Maestro down.
 *
 * Screen changes: a hash of each frame (status bar ignored, a blinking cursor's
 * A-B-A-B ignored) bumps a per-device counter `seq`. A layout (layout.js) is valid
 * for the seq it was read at.
 */
const zlib = require("zlib");
const state = require("../core/state");
const { adb, run, checkSerial, isWifi } = require("./adb");

const TARGET_W  = 540;    // frame width sent to the window
const VIEW_MS   = 1500;   // a window asked for a frame this recently: keep reading ahead
const AHEAD_MAX = 2000;   // a read-ahead frame older than this is not shown
const PROBES    = 2;      // frames timed per transfer mode before choosing

const devState = new Map();

function stateOf(serial) {
  let s = devState.get(serial);
  if (!s) {
    s = { seq: 1, lastChange: Date.now(), recent: [], frameInflight: null, ui: null, dumping: null,
          uiLock: Promise.resolve(), size: null, noGzip: false,
          mode: null, probe: { raw: [], gzip: [] }, ahead: null, lastAsk: 0, inputAt: 0 };
    devState.set(serial, s);
  }
  return s;
}
function forget(serial) { devState.delete(serial); }
function forgetAll() { devState.clear(); }

function bump(s) { s.seq++; s.lastChange = Date.now(); }

/** Something changed the screen (a tap, key, app launch ... we sent). */
function markChange(serial) {
  const s = stateOf(serial);
  bump(s);
  s.inputAt = Date.now();          // a read-ahead frame taken before this is out of date
}

function screenInfo(serial) {
  const s = devState.get(serial);
  if (!s) return { seq: 0, still: false, layoutSeq: 0 };
  return { seq: s.seq, still: Date.now() - s.lastChange > 450, layoutSeq: s.ui ? s.ui.seq : 0, size: s.size };
}

/** Which transfer to use for the next frame: "raw" or "gzip". */
function pickMode(serial, s) {
  if (s.noGzip) return "raw";
  if (s.mode) return s.mode;
  if (isWifi(serial)) return (s.mode = "gzip");          // the network is the slow part
  return s.probe.raw.length <= s.probe.gzip.length ? "raw" : "gzip";
}
function learn(serial, s, mode, ms) {
  if (s.mode || s.noGzip) return;
  s.probe[mode].push(ms);
  if (s.probe.raw.length < PROBES || s.probe.gzip.length < PROBES) return;
  const avg = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  const raw = avg(s.probe.raw), gz = avg(s.probe.gzip);
  s.mode = raw <= gz ? "raw" : "gzip";
  console.log("Screen frames on " + serial + ": raw " + raw + " ms, gzip " + gz + " ms -> using " + s.mode);
}

const gunzip = b => new Promise((resolve, reject) => zlib.gunzip(b, (e, out) => e ? reject(e) : resolve(out)));

/** One screenshot from the device as raw screencap bytes. */
async function grab(serial, s) {
  const mode = pickMode(serial, s);
  const t0 = Date.now();
  let raw;
  if (mode === "gzip") {
    const r = await run(adb(), ["-s", serial, "exec-out", "screencap | gzip -1"], { encoding: "buffer", timeout: 10000 });
    const b = r.stdout;
    if (!(b && b[0] === 0x1f && b[1] === 0x8b)) {       // phone without gzip (older Android): raw from now on
      s.noGzip = true; s.mode = "raw";
      return grab(serial, s);
    }
    raw = await gunzip(b);
  } else {
    raw = (await run(adb(), ["-s", serial, "exec-out", "screencap"], { encoding: "buffer", timeout: 10000 })).stdout;
  }
  learn(serial, s, mode, Date.now() - t0);
  return raw;
}

/** Start taking the next screenshot now, if a window is watching and no test runs. */
function readAhead(serial, s) {
  if (s.ahead || state.busy) return;
  if (Date.now() - s.lastAsk > VIEW_MS) return;
  if (devState.get(serial) !== s) return;               // device was forgotten meanwhile
  const promise = grab(serial, s);
  promise.catch(() => {});                              // reported by the frame() call that uses it
  s.ahead = { promise, startedAt: Date.now() };
}

function fnv(buf, from, to, step) {
  let h = 2166136261 >>> 0;
  for (let i = from; i < to; i += step) { h ^= buf[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/** screencap bytes -> { dw, dh (device px), w, h (sent), data (RGBA, shrunk) } */
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
  s.lastAsk = Date.now();
  if (s.frameInflight) return s.frameInflight;
  const a = s.ahead; s.ahead = null;
  const usable = a && a.startedAt >= s.inputAt && Date.now() - a.startedAt < AHEAD_MAX;
  // An out-of-date read-ahead (taken before a tap) may still be running on the phone.
  // Wait for it instead of starting a second screencap next to it: two at once share the
  // phone's CPU and the USB / Wi-Fi link, so both arrive late (2.0.1).
  const source = usable ? a.promise
               : a ? a.promise.then(() => grab(serial, s), () => grab(serial, s))
               : grab(serial, s);
  s.frameInflight = source
    .then(raw => {
      readAhead(serial, s);                             // next screenshot starts now
      const f = decodeRaw(raw);
      // Skip the status bar (clock, signal) so it never counts as a change
      const from = Math.floor(f.h * 0.045) * f.w * 4;
      const h = fnv(f.data, from, f.data.length, 61);
      // A blinking cursor flips between two images: A B A B is still "still"
      if (s.recent[0] !== h && s.recent[1] !== h) bump(s);
      s.recent = [h, s.recent[0]];
      s.size = { w: f.dw, h: f.dh };
      if (opts && opts.prefetch) require("./layout").prefetch(serial);   // lazy: layout.js requires this file
      return f;
    })
    .finally(() => { s.frameInflight = null; });
  return s.frameInflight;
}

/** How frames are fetched for a device (shown in logs / checks). */
function frameMode(serial) {
  const s = devState.get(serial);
  return s ? { mode: s.mode || (s.noGzip ? "raw" : "probing"), probe: s.probe } : null;
}

module.exports = {
  TARGET_W, devState, stateOf, forget, forgetAll, markChange, screenInfo,
  frame, decodeRaw, frameMode
};
