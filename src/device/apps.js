/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Apps on the device: list, the app in front, launch, open a link, install an APK.
 */
const { PKG_RE, adb, aaptPath, run, shell, checkSerial, checkPkg } = require("./adb");
const { markChange } = require("./screen");

async function packages(serial) {
  const out = await shell(serial, ["pm", "list", "packages", "-3"]);
  return out.split(/\r?\n/).map(l => l.replace(/^package:/, "").trim()).filter(p => PKG_RE.test(p)).sort();
}

/**
 * Apps on the device that have an icon in the launcher (includes Chrome,
 * Settings, Camera ... which `pm list -3` leaves out), plus where each comes from.
 *   [{ id, user: true|false }]
 */
async function apps(serial) {
  checkSerial(serial);
  const user = new Set(await packages(serial).catch(() => []));
  let launch = [];
  try {
    const out = await shell(serial, ["cmd", "package", "query-activities", "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER"], { timeout: 15000 });
    launch = [...out.matchAll(/^\s*([A-Za-z][\w.]*)\/[\w.$]+\s*$/gm)].map(m => m[1]);
    if (!launch.length) launch = [...out.matchAll(/packageName=([A-Za-z][\w.]*)/g)].map(m => m[1]);
  } catch (_) {}
  const all = new Set([...launch.filter(p => PKG_RE.test(p)), ...user]);
  return [...all].sort((a, b) => (user.has(b) - user.has(a)) || a.localeCompare(b)).map(id => ({ id, user: user.has(id) }));
}

/** The app in front right now (package name), or "". */
async function foreground(serial) {
  checkSerial(serial);
  try {
    const out = await shell(serial, ["dumpsys", "window", "displays"], { timeout: 6000 });
    const m = out.match(/mCurrentFocus=.*?\s([A-Za-z][\w.]*)\/[\w.$]+/) || out.match(/mFocusedApp=.*?\s([A-Za-z][\w.]*)\/[\w.$]+/);
    if (m && PKG_RE.test(m[1])) return m[1];
  } catch (_) {}
  try {
    const out = await shell(serial, ["dumpsys", "activity", "activities"], { timeout: 8000 });
    const m = out.match(/(?:mResumedActivity|topResumedActivity|ResumedActivity)[^\n]*?\s([A-Za-z][\w.]*)\/[\w.$]+/);
    if (m && PKG_RE.test(m[1])) return m[1];
  } catch (_) {}
  return "";
}
/* ---------- The app being used, from the screen layout (2.0.1) ----------
 * The Record tab fills in "App" by itself with the app the tester opens on the phone.
 * The layout is read anyway (hover outlines), so no extra command runs on the phone: the
 * app is the package of the top application window, ignoring the home screen, the status
 * bar / notification shade, the keyboard and permission dialogs (which sit on top of the app).
 */
const homeCache = new Map();          // serial -> home screen (launcher) package
async function homePackage(serial) {
  checkSerial(serial);
  if (homeCache.has(serial)) return homeCache.get(serial);
  let pkg = "";
  try {
    const out = await shell(serial, ["cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN",
                                     "-c", "android.intent.category.HOME"], { timeout: 8000 });
    const m = out.match(/^\s*([A-Za-z][\w.]*)\/[\w.$]+\s*$/m) || out.match(/packageName=([A-Za-z][\w.]*)/);
    if (m && PKG_RE.test(m[1])) pkg = m[1];
  } catch (_) {}
  homeCache.set(serial, pkg);
  return pkg;
}
const NOT_THE_APP = /^(android|com\.android\.systemui|com\.android\.(permissioncontroller|packageinstaller)|com\.google\.android\.(permissioncontroller|packageinstaller|inputmethod\.\w+)|com\.samsung\.android\.honeyboard|com\.sec\.android\.inputmethod|com\.touchtype\.swiftkey|com\.android\.inputmethod\.\w+)$/;
function appFromNodes(nodes, home) {
  const byWin = new Map();
  (nodes || []).forEach(n => {
    if (!n.pkg || !PKG_RE.test(n.pkg) || NOT_THE_APP.test(n.pkg) || n.pkg === home) return;
    if (/INPUT_METHOD|SYSTEM|ACCESSIBILITY|MAGNIFICATION/.test(n.wtype || "")) return;
    const w = n.win || 0;
    if (!byWin.has(w)) byWin.set(w, { layer: n.layer || 0, pkg: n.pkg, area: 0 });
    const e = byWin.get(w);
    if (e.pkg === n.pkg) e.area = Math.max(e.area, (n.x2 - n.x1) * (n.y2 - n.y1));
  });
  // Top window first; a tiny window (a toast, a bubble) does not count as the app
  const list = Array.from(byWin.values()).filter(e => e.area > 40000).sort((a, b) => b.layer - a.layer || b.area - a.area);
  return list.length ? list[0].pkg : "";
}
async function appInFront(serial, nodes) {
  return appFromNodes(nodes, await homePackage(serial).catch(() => ""));
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
  markChange(serial);
  if (clearState) await shell(serial, ["pm", "clear", pkg]);
  await shell(serial, ["monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
  return { ok: true };
}

/** Open a web address on the device (browser or the app that handles it). */
async function openLink(serial, url) {
  if (!/^(https?:\/\/|[a-z][a-z0-9+.-]*:\/\/)[^\s'"]{1,2000}$/i.test(String(url || ""))) throw new Error("Enter a full link, e.g. https://example.com");
  markChange(serial);
  await shell(serial, ["am", "start", "-a", "android.intent.action.VIEW", "-d", String(url)]);
  return { ok: true };
}

module.exports = {
  packages, apps, foreground, apkPackage, install, launch, openLink, homePackage, appFromNodes, appInFront
};
