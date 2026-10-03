/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Opens the UI in its own window without browser tabs or address bar
 * (Edge or Chrome "app mode"), so Understudy looks and feels like a desktop
 * app. Falls back to the default browser.
 */

const fs   = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");

function candidates() {
  const pf   = process.env["ProgramFiles"] || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const lad  = process.env.LOCALAPPDATA || "";
  if (process.platform === "win32") return [
    path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf,   "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf,   "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    lad && path.join(lad, "Google", "Chrome", "Application", "chrome.exe")
  ].filter(Boolean);
  if (process.platform === "darwin") return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ];
  return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
}

function open(url, mode) {
  if (mode !== "browser") {
    const exe = candidates().find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
    if (exe) {
      try {
        spawn(exe, ["--app=" + url, "--window-size=1440,900", "--no-first-run"],
              { detached: true, stdio: "ignore", windowsHide: false }).unref();
        return "app";
      } catch (_) {}
    }
  }
  if (process.platform === "win32") execFile("cmd", ["/c", "start", "", url], { windowsHide: true }, () => {});
  else execFile(process.platform === "darwin" ? "open" : "xdg-open", [url], () => {});
  return "browser";
}

module.exports = { open };
