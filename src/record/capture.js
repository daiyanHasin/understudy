/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * "Use the device" capture: the tester taps and types on the phone (or in the
 * emulator's own window) and Understudy turns those touches into steps.
 *
 *   - Touches are read with `getevent` from the touch screen only.
 *   - Only touches on the chosen app are kept. Touches on other apps, the
 *     launcher, system dialogs and the on-screen keyboard are discarded.
 *   - After a tap on a text field, the typed text is read from the screen
 *     layout before the next tap, and becomes a Type step.
 *
 * The element is looked up in the layout that was on screen when the finger
 * went DOWN (before the button's own press animation changed the screen),
 * so taps are no longer flagged "the screen was still changing" just because
 * the tap itself animated something.
 *
 * With "follow other apps" on, taps in other apps (a browser, the camera, a
 * second app of yours) are recorded too, and an "Open app" step is added
 * whenever the app in front changes.
 *
 * Limits (shown in the UI): taps made while the screen is still moving may
 * only get a screen position; hidden (password) text can't be read.
 */

const { spawn } = require("child_process");
const android  = require("../device/android");
const recorder = require("./recorder");

const sessions = new Map();   // serial -> session

function contains(r, x, y) { return r && x >= r.x1 && x < r.x2 && y >= r.y1 && y < r.y2; }
function pct(v, t) { return Math.max(0, Math.min(100, Math.round(v / t * 100))); }

const SYSTEM_PKGS = /^(com\.android\.systemui|com\.android\.launcher\d*|com\.google\.android\.apps\.nexuslauncher|com\.sec\.android\.app\.launcher|com\.miui\.home|com\.huawei\.android\.launcher|com\.oppo\.launcher|com\.android\.inputmethod.*|com\.google\.android\.inputmethod.*|com\.samsung\.android\.honeyboard|com\.touchtype\.swiftkey)$/;

async function start(serial, appId, opts) {
  android.checkSerial(serial);
  android.checkPkg(appId);
  opts = opts || {};
  stop(serial);
  const touch = await android.touchDevice(serial);
  const size  = await android.screenSize(serial);
  if (!/^\/dev\/input\/event\d+$/.test(touch.dev)) throw new Error("Unexpected touch device");

  const child = spawn(android.adb(), ["-s", serial, "shell", "getevent -lt " + touch.dev],
                      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  const s = {
    serial, appId, child, touch, size, events: [], discarded: 0, field: null, keyboard: null,
    follow: !!opts.follow, currentApp: appId, downSnap: null,
    cur: { x: 0, y: 0 }, down: false, startPt: null, startAt: 0, lastPt: null, error: null
  };
  sessions.set(serial, s);

  let buf = "";
  child.stdout.on("data", d => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { line(s, buf.slice(0, i)); buf = buf.slice(i + 1); }
  });
  child.on("exit", () => { if (sessions.get(serial) === s) s.error = s.error || "Capture stopped (device disconnected?)"; });
  child.on("error", e => { s.error = e.message; });
  return { ok: true };
}

function stop(serial) {
  const s = sessions.get(serial);
  if (!s) return { ok: true };
  sessions.delete(serial);
  try { s.child.kill(); } catch (_) {}
  if (s.field) finishTyping(s);
  return { ok: true, events: s.events.splice(0) };
}

/** Events collected since the last poll. */
function poll(serial) {
  const s = sessions.get(serial);
  if (!s) return { active: false, events: [] };
  return { active: true, events: s.events.splice(0), discarded: s.discarded, error: s.error, typing: !!s.field };
}

/* ---------- getevent parsing ---------- */
function line(s, l) {
  const m = l.match(/(EV_\w+)\s+(\w+)\s+(\w+)\s*$/);
  if (!m) return;
  const [, type, code, value] = m;
  if (type === "EV_ABS") {
    const v = parseInt(value, 16);
    if (code === "ABS_MT_POSITION_X") s.cur.x = v;
    else if (code === "ABS_MT_POSITION_Y") s.cur.y = v;
    else if (code === "ABS_MT_TRACKING_ID") {
      if (value === "ffffffff") up(s); else if (!s.down) down(s);
    }
  } else if (type === "EV_KEY" && code === "BTN_TOUCH") {
    if (value === "DOWN" && !s.down) down(s);
    else if (value === "UP") up(s);
  } else if (type === "EV_SYN" && code === "SYN_REPORT" && s.down) {
    const p = toScreen(s);
    if (!s.startPt) s.startPt = p;
    s.lastPt = p;
  }
}
function toScreen(s) {
  return { x: Math.round(s.cur.x / s.touch.maxX * s.size.w), y: Math.round(s.cur.y / s.touch.maxY * s.size.h) };
}
function down(s) {
  s.down = true; s.startPt = null; s.lastPt = null; s.startAt = Date.now();
  // What was on screen when the finger touched it
  const snap = android.lastLayout(s.serial);
  s.downSnap = snap ? { nodes: snap.nodes, fresh: snap.fresh || snap.stillFor > 350 } : null;
}
function up(s) {
  if (!s.down) return;
  s.down = false;
  const a = s.startPt || toScreen(s), b = s.lastPt || a;
  gesture(s, a, b, Date.now() - s.startAt);
}

/* ---------- Turning touches into steps ---------- */
function gesture(s, a, b, ms) {
  // On-screen keyboard: never a step
  if (s.keyboard && contains(s.keyboard, a.x, a.y)) return;

  const snap = s.downSnap || android.lastLayout(s.serial);
  s.downSnap = null;
  const nodes = snap ? snap.nodes : null;
  const under = nodes ? recorder.nodesAt(nodes, a.x, a.y) : [];
  const pkg = under.length ? under[under.length - 1].pkg : "";
  if (nodes && pkg && pkg !== s.currentApp) {
    if (!s.follow || SYSTEM_PKGS.test(pkg) || !android.PKG_RE.test(pkg)) { s.discarded++; return; }
    // Another app came to the front: switch to it in the flow
    s.events.push({ type: "openApp", appId: pkg });
    s.currentApp = pkg;
  }

  if (s.field) finishTyping(s);

  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist > 30) {
    s.events.push({ type: "swipe", from: pct(a.x, s.size.w) + "%," + pct(a.y, s.size.h) + "%",
                    to: pct(b.x, s.size.w) + "%," + pct(b.y, s.size.h) + "%" });
    return;
  }
  const info = nodes ? recorder.inspect(nodes, a.x, a.y)
                     : { element: null, candidates: [{ kind: "point", value: pct(a.x, s.size.w) + "%," + pct(a.y, s.size.h) + "%", unique: true, count: 1, label: "Screen position" }] };
  s.events.push({ type: ms > 600 ? "longPress" : "tap", info, unsure: !snap || !snap.fresh });

  if (info.element && info.element.editable) {
    s.field = { el: info.element, column: info.suggestedColumn, at: Date.now() };
    s.keyboard = null;
    setTimeout(() => {
      android.keyboardArea(s.serial).then(r => { if (s.field) s.keyboard = r; }).catch(() => {});
    }, 900);
  }
}

// Read what was typed into the last field from the latest screen layout
function finishTyping(s) {
  const f = s.field;
  s.field = null; s.keyboard = null;
  const snap = android.lastLayout(s.serial);
  let value = "", found = false;
  if (snap) {
    const b = f.el.bounds;
    const n = snap.nodes.find(x => x.editable && (f.el.id ? x.id === f.el.id
              : (x.x1 === b[0] && x.y1 === b[1] && x.x2 === b[2] && x.y2 === b[3])));
    if (n) { found = true; value = n.text; }
  }
  const placeholder = f.el.placeholder || f.el.hint || "";
  if (found && (!value || value === placeholder)) return;    // nothing typed
  s.events.push({
    type: "input", value: f.el.password ? "" : value, column: f.column, password: !!f.el.password,
    needsValue: f.el.password || !found
  });
}

function stopAll() { [...sessions.keys()].forEach(stop); }

module.exports = { start, stop, stopAll, poll };
