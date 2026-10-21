/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Input sent to the device (tap, swipe, keys, text) and the device facts that
 * capture.js needs (screen size, touch screen, keyboard area).
 * Every input marks the screen as changed (screen.markChange).
 */
const { shell, int, sleep } = require("./adb");
const { markChange } = require("./screen");

/* ---------- Input ---------- */
const KEYS = { back: 4, home: 3, enter: 66, tab: 61, del: 67, recents: 187, power: 26 };
/*
 * `adb shell input ...` takes 0.3-1.5 s on the phone (it starts a small Java program).
 * Before 2.0.1 the screen was marked "changed" only BEFORE the command, so screenshots
 * taken while the command was still starting counted as "after the tap": the window kept
 * showing the old screen, and a layout of the OLD screen could be cached as current.
 * Now the change is marked before AND after the command has finished (changed()).
 */
function changed(serial, p) {
  markChange(serial);
  return p.then(r => { markChange(serial); return r; }, e => { markChange(serial); throw e; });
}
function tap(serial, x, y) {
  const X = String(int(x, 0, 20000, "x")), Y = String(int(y, 0, 20000, "y"));
  return changed(serial, shell(serial, ["input", "tap", X, Y]));
}
function longPress(serial, x, y) {
  const X = String(int(x, 0, 20000, "x")), Y = String(int(y, 0, 20000, "y"));
  return changed(serial, shell(serial, ["input", "swipe", X, Y, X, Y, "800"]));
}
function swipe(serial, x1, y1, x2, y2, ms) {
  const a = [String(int(x1, 0, 20000, "x")), String(int(y1, 0, 20000, "y")),
             String(int(x2, 0, 20000, "x")), String(int(y2, 0, 20000, "y")),
             String(int(ms || 300, 50, 5000, "duration"))];
  return changed(serial, shell(serial, ["input", "swipe"].concat(a)));
}
function key(serial, name) {
  if (!(name in KEYS)) throw new Error("Unknown key");
  return changed(serial, shell(serial, ["input", "keyevent", String(KEYS[name])]));
}
async function keyboardShown(serial) {
  return /mInputShown=true/.test(await shell(serial, ["dumpsys", "input_method"], { timeout: 8000 }));
}
async function hideKeyboard(serial) { if (await keyboardShown(serial)) await key(serial, "back"); }
function erase(serial, n) {
  const count = int(n || 50, 1, 200, "count");
  return changed(serial, shell(serial, ["input", "keyevent", "123"].concat(new Array(count).fill("67"))));
}

const ADB_IME = "com.android.adbkeyboard/.AdbIME";
function text(serial, value) { return changed(serial, typeText(serial, value)); }
async function typeText(serial, value) {
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

module.exports = {
  KEYS, tap, longPress, swipe, key, keyboardShown, hideKeyboard, erase, text,
  screenSize, touchDevice, keyboardArea
};
