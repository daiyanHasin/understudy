/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Screen layout: what elements are on screen (uiautomator dump), cached per
 * screen change.
 *
 *   - The layout (1-3 s to read) is read in the background as soon as the screen
 *     stops changing, so a tap usually finds it ready (prefetch).
 *   - Every change of the screen bumps a counter (seq, screen.js); a layout is
 *     valid for the seq it was read at.
 *   - Only ONE uiautomator command runs per device at a time (a second one makes
 *     Android kill the first: the "Killed" message) - withUiLock.
 *   - If something else holds UI automation (Maestro Studio, a leftover Maestro
 *     driver), it is released and the read is retried.
 *   - Layouts include every window (dialogs, keyboard, system bars) where
 *     Android supports `uiautomator dump --windows`.
 */
const state = require("../core/state");
const { adb, run, shell, checkSerial, sleep } = require("./adb");
const screen = require("./screen");
const { stateOf, devState } = screen;

const layoutListeners = [];
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

module.exports = {
  layout, lastLayout, refreshLayout, parseHierarchy, prefetch, onLayout, releaseUiAutomation, withUiLock
};
