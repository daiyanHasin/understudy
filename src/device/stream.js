/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Live screen video for the Record tab (2.0.1).
 *
 * Why: screenshots (screen.js) cost one full-size `screencap` per picture - about 10 MB on a
 * 1080x2400 phone - so the picture updated about once a second. Here the phone's own video
 * encoder does the work, the way scrcpy and Android Studio's mirroring do:
 *
 *   adb exec-out screenrecord --output-format=h264 --size WxH --bit-rate N -
 *
 * The phone sends a small H.264 stream (only what changed), the window decodes it with the
 * browser's built-in video decoder (WebCodecs) and draws every frame. 20-60 frames per second
 * instead of about 1, with far less work on the phone.
 *
 * Details:
 *   - screenrecord stops after 3 minutes; the window simply opens the stream again.
 *   - "Did the screen change?" (for the element layout, layout.js) comes from the stream too:
 *     the phone only sends frames when something changes, so this file counts the bytes of
 *     changed pictures. Tiny updates (a blinking cursor, the clock) stay under the threshold.
 *     When the screen has been still for a moment, the layout is read (prefetch), as before.
 *   - Not while a test runs (Maestro gets the phone), one stream per device.
 *   - Anything that fails (old Android, no WebCodecs, an encoder that refuses the size) makes
 *     the window go back to screenshots by itself.
 */
const { spawn } = require("child_process");
const state = require("../core/state");
const { adb, checkSerial, isWifi } = require("./adb");
const screen = require("./screen");

const SHORT_SIDE = 720;            // video size: the short side, the long side follows the screen
const CHANGE_BYTES = 1200;         // more than this in one tick of changed pictures = the screen changed
const TICK_MS = 200;
const active = new Map();          // serial -> { child, stop() }

const even16 = v => Math.max(16, Math.round(v / 16) * 16);   // video encoders want multiples of 16

/** Video size for a screen of dw x dh: same shape, short side SHORT_SIDE (never larger than the screen). */
function videoSize(dw, dh) {
  const k = Math.min(1, SHORT_SIDE / Math.min(dw, dh));
  return { w: even16(dw * k), h: even16(dh * k) };
}

/* Counts bytes of non-key picture data (NAL type 1) in an H.264 Annex-B stream, across chunks. */
function sliceCounter() {
  let zeros = 0, inNal = false, wantType = false, type = 0, bytes = 0;
  return {
    feed(buf) {
      for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (wantType) { type = b & 31; wantType = false; inNal = true; continue; }
        if (b === 0) { zeros++; if (inNal && type === 1) bytes++; continue; }
        if (b === 1 && zeros >= 2) { wantType = true; zeros = 0; continue; }
        zeros = 0;
        if (inNal && type === 1) bytes++;
      }
    },
    take() { const b = bytes; bytes = 0; return b; }
  };
}

function stop(serial) {
  const a = active.get(serial);
  if (a) a.stop();
}
function stopAll() { Array.from(active.keys()).forEach(stop); }

/**
 * Stream the screen of `serial` into the HTTP response `res`.
 * size = { dw, dh } in device pixels (the window knows them from its first screenshot).
 */
function pipe(serial, size, req, res, headers) {
  checkSerial(serial);
  if (state.busy) { const e = new Error("A test is running"); e.status = 409; throw e; }
  const dw = Math.round(Number(size.dw)), dh = Math.round(Number(size.dh));
  if (!(dw >= 100 && dw <= 8000 && dh >= 100 && dh <= 8000)) { const e = new Error("Unknown screen size"); e.status = 400; throw e; }
  stop(serial);                                            // one stream per device

  const v = videoSize(dw, dh);
  const rate = isWifi(serial) ? 3000000 : 8000000;
  const child = spawn(adb(), ["-s", serial, "exec-out", "screenrecord", "--output-format=h264",
                              "--size", v.w + "x" + v.h, "--bit-rate", String(rate), "--time-limit", "180", "-"],
                      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const counter = sliceCounter();
  const s = screen.stateOf(serial);
  let started = false, ended = false, errText = "";

  const tick = setInterval(() => {
    if (state.busy) { finish(); return; }                  // a test started: give Maestro the phone
    if (counter.take() > CHANGE_BYTES) screen.streamChange(serial);
    else require("./layout").prefetch(serial);             // still: read the layout in the background
  }, TICK_MS);

  function finish() {
    if (ended) return; ended = true;
    clearInterval(tick);
    try { child.kill(); } catch (_) {}
    if (active.get(serial) && active.get(serial).child === child) active.delete(serial);
    try { res.end(); } catch (_) {}
  }
  active.set(serial, { child, stop: finish });
  s.size = { w: dw, h: dh };

  child.stdout.on("data", chunk => {
    if (!started) {
      started = true;
      const h = Object.assign({}, headers, { "X-Video-W": v.w, "X-Video-H": v.h,
        "Access-Control-Expose-Headers": "X-Video-W, X-Video-H" });
      res.writeHead(200, h);
    }
    counter.feed(chunk);
    res.write(chunk);
  });
  child.stderr.on("data", d => { errText = (errText + d).slice(-400); });
  child.on("error", e => { errText = e.message; });
  child.on("close", () => {
    if (!started && !res.headersSent) {
      res.writeHead(502, Object.assign({}, headers, { "Content-Type": "application/json; charset=utf-8" }));
      res.end(JSON.stringify({ error: "No live video from this device" + (errText.trim() ? ": " + errText.trim().split(/\r?\n/).pop() : "") }));
      ended = true; clearInterval(tick); active.delete(serial);
      return;
    }
    finish();
  });
  res.on("close", finish);                                  // the window went away or opened a new stream
}

// Understudy quits: end the phone-side recordings too (they would run on for up to 3 minutes)
process.on("exit", stopAll);

module.exports = { pipe, stop, stopAll, videoSize, sliceCounter };
