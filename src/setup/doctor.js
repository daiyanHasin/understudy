/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Setup checks shown on the Setup tab. Each check says what is wrong and
 * exactly how to fix it. Nothing is installed without the user pressing a button.
 * Required for phones: Node, Java, Maestro, phone tools (adb).
 * Virtual devices (emulator) are optional.
 */

const { exec } = require("child_process");
const android = require("../device/android");

function maestroVersion() {
  // maestro is a .bat on Windows, so it needs a shell. The command is a fixed string.
  return new Promise(resolve => {
    exec("maestro --version", { timeout: 30000, windowsHide: true }, (err, out) =>
      resolve(err ? null : String(out).trim().split(/\r?\n/).pop()));
  });
}

async function javaVersion() {
  try {
    const r = await android.run("java", ["-version"], { timeout: 15000 });
    const t = String(r.stderr || r.stdout);
    const m = t.match(/version "([^"]+)"/);
    return m ? m[1] : t.split(/\r?\n/)[0];
  } catch (_) { return null; }
}

async function check() {
  const out = [];
  const add = (id, label, ok, detail, fix, link, optional, action) =>
    out.push({ id, label, ok: !!ok, detail: detail || "", fix: ok ? "" : (fix || ""), link: ok ? "" : (link || ""),
               optional: !!optional, action: ok ? "" : (action || "") });

  const nodeMajor = +process.versions.node.split(".")[0];
  add("node", "Node.js 18 or newer", nodeMajor >= 18, "v" + process.versions.node,
      "Install the LTS version of Node.js.", "https://nodejs.org");

  const java = await javaVersion();
  const javaMajor = java ? parseInt(java.replace(/^1\./, ""), 10) : 0;
  add("java", "Java 17 or newer", javaMajor >= 17, java || "Not found",
      "Install Temurin JDK 17 (free) and restart Understudy.", "https://adoptium.net");

  const maestro = await maestroVersion();
  add("maestro", "Maestro CLI", !!maestro, maestro ? "Version " + maestro : "Not found on PATH",
      "Install the Maestro CLI. Understudy uses it to run your flows. Maestro Studio is not needed.",
      "https://docs.maestro.dev/getting-started/installing-maestro");

  // Phone tools (adb): all a USB or Wi-Fi phone needs. Installed in-app, about 8 MB.
  let adbOk = false;
  try {
    const r = await android.run(android.adb(), ["version"], { timeout: 10000 });
    adbOk = true;
    const src = android.adbSource();
    add("adb", "Phone tools (adb)", true, String(r.stdout).split(/\r?\n/)[0].replace(/^Android Debug Bridge /, "") +
        (src === "understudy" ? " \u00b7 installed by Understudy" : src === "sdk" ? " \u00b7 from the Android SDK" : " \u00b7 from PATH"));
  } catch (e) {
    add("adb", "Phone tools (adb)", false, "Not installed",
        "Press \u201CInstall phone tools\u201D. Downloads Google's official platform-tools (about 8 MB) into Understudy's folder. No Android Studio needed.", "", false, "adb");
  }

  if (adbOk) {
    try {
      const list = await android.devices();
      const ready = list.filter(d => d.state === "device" && d.booted);
      const waiting = list.filter(d => d.state === "unauthorized");
      add("device", "Device connected", ready.length > 0,
          ready.length ? ready.map(d => d.avd || d.model || d.serial).join(", ")
                       : waiting.length ? "A phone is waiting for permission" : "No device connected",
          waiting.length ? "Unlock the phone and tap Allow on \u201CAllow USB debugging?\u201D."
                         : "Open Record and press Connect device. A phone by USB or Wi-Fi is the fastest option.", "", true, "connect");
    } catch (_) {}
  }

  // Virtual devices: optional, heavy (about 1.5 GB download, 2+ GB RAM while running)
  const root = android.sdkRoot();
  let emuOk = false;
  try { await android.run(android.emulator(), ["-version"], { timeout: 15000 }); emuOk = true; } catch (_) {}
  if (!emuOk) {
    add("emulator", "Virtual devices (optional)", false, root ? "Emulator not installed" : "Not installed",
        "Only needed if you want to test without a phone. About 1.5 GB to download and 2 GB of RAM while running.", "", true, "android");
  } else {
    add("emulator", "Virtual devices (optional)", true, "Emulator installed");
    try {
      const r = await android.run(android.emulator(), ["-accel-check"], { timeout: 20000 });
      const t = String(r.stdout);
      const good = /accel:\s*0\b/.test(t) || /is installed and usable/i.test(t);
      add("accel", "Hardware acceleration", good, t.split(/\r?\n/).filter(Boolean).slice(-1)[0] || "",
          "Turn on virtualization in BIOS, then enable \u201CWindows Hypervisor Platform\u201D in Windows Features and restart.",
          "https://developer.android.com/studio/run/emulator-acceleration", true);
    } catch (e) {
      add("accel", "Hardware acceleration", false, e.message,
          "Turn on virtualization in BIOS, then enable \u201CWindows Hypervisor Platform\u201D in Windows Features and restart.",
          "https://developer.android.com/studio/run/emulator-acceleration", true);
    }
    const avds = await android.avds();
    add("avd", "Virtual device", avds.length > 0, avds.length ? avds.join(", ") : "None created",
        "Install virtual-device tools creates a light one called Understudy_Pixel.", "", true, "android");
  }

  add("aapt", "APK reader (optional)", !!android.aaptPath(), android.aaptPath() ? "Found" : "Not found",
      "Lets Understudy read the app ID from an APK file. Without it, the app ID is read from the device after installing.", "", true);
  return out;
}

module.exports = { check };
