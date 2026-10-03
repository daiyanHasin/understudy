/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Setup checks shown on the Setup tab. Each check says what is wrong and
 * exactly how to fix it. Nothing is installed automatically.
 */

const { exec } = require("child_process");
const android = require("./android");

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

  const root = android.sdkRoot();
  add("sdk", "Android SDK", !!root, root || "Not found",
      "Press \u201CInstall Android tools\u201D below. It installs only what Understudy needs (no Android Studio).", "", false, "android");

  let adbOk = false;
  try {
    const r = await android.run(android.adb(), ["version"], { timeout: 10000 });
    adbOk = true;
    add("adb", "ADB (platform-tools)", true, String(r.stdout).split(/\r?\n/)[0]);
  } catch (e) {
    add("adb", "ADB (platform-tools)", false, "Not found",
        "Press \u201CInstall Android tools\u201D below.", "", false, "android");
  }

  let emuOk = false;
  try {
    await android.run(android.emulator(), ["-version"], { timeout: 15000 });
    emuOk = true;
    add("emulator", "Android Emulator", true, "Installed");
  } catch (_) {
    add("emulator", "Android Emulator", false, "Not found",
        "Press \u201CInstall Android tools\u201D below.", "", false, "android");
  }

  if (emuOk) {
    try {
      const r = await android.run(android.emulator(), ["-accel-check"], { timeout: 20000 });
      const t = String(r.stdout);
      const good = /accel:\s*0\b/.test(t) || /is installed and usable/i.test(t);
      add("accel", "Hardware acceleration", good, t.split(/\r?\n/).filter(Boolean).slice(-1)[0] || "",
          "Turn on virtualization in BIOS, then enable \u201CWindows Hypervisor Platform\u201D in Windows Features and restart.",
          "https://developer.android.com/studio/run/emulator-acceleration");
    } catch (e) {
      add("accel", "Hardware acceleration", false, e.message,
          "Turn on virtualization in BIOS, then enable \u201CWindows Hypervisor Platform\u201D in Windows Features and restart.",
          "https://developer.android.com/studio/run/emulator-acceleration");
    }
    const avds = await android.avds();
    add("avd", "Virtual device", avds.length > 0, avds.length ? avds.join(", ") : "None created",
        "Press \u201CInstall Android tools\u201D below. It creates a light virtual device called Understudy_Pixel.", "", false, "android");
  }

  add("aapt", "APK reader (build-tools)", !!android.aaptPath(), android.aaptPath() ? "Found" : "Not found",
      "Optional. Lets Understudy read the app ID from an APK. Install Android tools adds it.", "", true, "android");

  if (adbOk) {
    try {
      const list = await android.devices();
      const ready = list.filter(d => d.state === "device" && d.booted);
      add("device", "Device ready", ready.length > 0,
          ready.length ? ready.map(d => d.avd || d.model || d.serial).join(", ") : "No running device",
          "Start a virtual device on the Record tab, or connect a phone by USB or Wi-Fi.", "", true);
    } catch (_) {}
  }
  return out;
}

module.exports = { check };
