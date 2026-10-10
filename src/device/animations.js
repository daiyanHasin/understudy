/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Phone animations off while recording, back on afterwards.
 *
 * Why: Android describes the screen (uiautomator dump) only once it has been
 * still for a moment. Window transitions, ripples, spinners and Lottie /
 * Compose animations keep it moving, so element capture waits, guesses from
 * an old screen, or gives up ("could not get idle state"). With the three
 * animation scales at 0 the screen settles at once. Maestro recommends the
 * same for test runs.
 *
 * Safety: the phone's own values are saved to logs/animations-restore.json
 * BEFORE anything is changed, and put back when the device is disconnected,
 * when Understudy quits, and at the next start if Understudy was closed
 * without quitting (e.g. the PC was shut down). Only these three settings
 * are touched.
 */

const fs      = require("fs");
const path    = require("path");
const android = require("./android");
const P       = require("../core/paths");

const KEYS = ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"];
const FILE = path.join(P.LOG_DIR, "animations-restore.json");
const VALUE_RE = /^(null|\d{1,2}(\.\d{1,3})?)$/;

function load() {
  try { const o = JSON.parse(fs.readFileSync(FILE, "utf8")); return o && typeof o === "object" ? o : {}; }
  catch (_) { return {}; }
}
function save(o) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    if (Object.keys(o).length) fs.writeFileSync(FILE, JSON.stringify(o, null, 1));
    else fs.rmSync(FILE, { force: true });
  } catch (_) {}
}
const isZero = v => /^0(\.0+)?$/.test(String(v));

/** Turn the three animation scales off. Remembers the phone's own values first. */
async function off(serial) {
  android.checkSerial(serial);
  const saved = load();
  if (!saved[serial]) {
    const prev = {};
    for (const k of KEYS) {
      const v = (await android.shell(serial, ["settings", "get", "global", k], { timeout: 6000 })).trim();
      prev[k] = VALUE_RE.test(v) ? v : "1";
    }
    if (KEYS.every(k => isZero(prev[k]))) return { ok: true, already: true };   // the tester keeps them off anyway
    saved[serial] = prev;
    save(saved);                                    // written before changing anything
  }
  for (const k of KEYS) await android.shell(serial, ["settings", "put", "global", k, "0"], { timeout: 6000 });
  return { ok: true };
}

/** Put the phone's own values back. Keeps the note if the phone can't be reached. */
async function restore(serial) {
  const saved = load();
  const prev = saved[serial];
  if (!prev) return { ok: true, nothing: true };
  try {
    for (const k of KEYS) {
      const v = VALUE_RE.test(String(prev[k])) ? String(prev[k]) : "1";
      if (v === "null") await android.shell(serial, ["settings", "delete", "global", k], { timeout: 6000 });
      else await android.shell(serial, ["settings", "put", "global", k, v], { timeout: 6000 });
    }
  } catch (e) { return { ok: false, error: e.message }; }
  const now = load(); delete now[serial]; save(now);
  return { ok: true };
}

/** Restore every connected device that still has saved values (quit, next start). */
async function restoreAll() {
  const saved = load();
  const serials = Object.keys(saved);
  if (!serials.length) return { ok: true, restored: [] };
  const ready = new Set((await android.devices().catch(() => [])).filter(d => d.state === "device").map(d => d.serial));
  const restored = [];
  for (const s of serials) if (ready.has(s) && (await restore(s)).ok) restored.push(s);
  return { ok: true, restored };
}

function isOff(serial) { return !!load()[serial]; }

module.exports = { off, restore, restoreAll, isOff, KEYS };
