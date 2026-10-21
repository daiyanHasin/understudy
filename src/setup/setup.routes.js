/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * HTTP routes - Setup: checklist, phone tools (adb) install, Android SDK installer, heavy processes.
 * Routes only read the request, call the feature module and answer.
 * The logic lives in the modules required below.
 */
const fs   = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const security = require("../core/security");
const state = require("../core/state");
const android = require("../device/android");
const doctor = require("../setup/doctor");
const capture = require("../record/capture");
const adbSetup = require("../device/adb-setup");
const P = require("../core/paths");
const APP_DIR = P.APP_DIR;

module.exports = function register(r, ctx) {
  const { GET, POST, json } = r;

  /* ----- Setup checks ----- */
  GET("/api/doctor", async (req, res) => json(res, 200, { checks: await doctor.check() }));
  /* Phone tools (adb) installed into Understudy's own folder */
  GET("/api/adb/status", (req, res) => json(res, 200, Object.assign(adbSetup.status(), { source: android.adbSource() })));
  POST("/api/adb/install", (req, res) => json(res, 200, adbSetup.install()));
  /* Heavy Android processes on this PC (emulator, adb, Android Studio) */
  GET("/api/system/processes", async (req, res) => json(res, 200, { groups: await android.processes() }));
  POST("/api/system/free", async (req, res) => {
    if (state.busy) return json(res, 409, { error: "A run is using the device. Stop it first." });
    const b = await security.readJson(req);
    capture.stopAll();
    json(res, 200, await android.endProcesses(b.kinds));
  });
  /* Android SDK setup without Android Studio (opens a visible PowerShell window) */
  POST("/api/setup/android", (req, res) => {
    if (process.platform !== "win32") return json(res, 400, { error: "This installer is for Windows" });
    const script = path.join(APP_DIR, "tools", "install-android.ps1");
    if (!fs.existsSync(script)) return json(res, 404, { error: "tools/install-android.ps1 is missing" });
    execFile("cmd.exe", ["/c", "start", "Understudy - Android setup", "powershell.exe",
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: false, cwd: APP_DIR }, () => {});
    json(res, 200, { ok: true });
  });
};
