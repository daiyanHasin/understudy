/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * How fast can this phone send screen pictures?   npm run frame-speed
 *   (or: node tools/frame-speed.js <serial>  when several devices are connected)
 *
 * Measures, on the phone that is connected now:
 *   raw    `screencap`             nothing to do on the phone, ~10 MB to move
 *   gzip   `screencap | gzip -1`   phone compresses, ~1 MB to move
 *   window what the Record tab gets (best mode + read-ahead), in frames per second
 *
 * Close Understudy first, or at least leave the Record tab, so nothing else is
 * using the phone while it measures.
 */
const android = require("../src/device/android");
const zlib = require("zlib");

const N = 5;
const ms = t => Math.round(t) + " ms";

(async () => {
  const list = (await android.devices()).filter(d => d.state === "device");
  const serial = process.argv[2] || (list[0] && list[0].serial);
  if (!serial) { console.log("No device found. Connect a phone (USB debugging on) and try again."); process.exit(1); }
  const how = android.isWifi(serial) ? "Wi-Fi" : serial.startsWith("emulator-") ? "emulator" : "USB";
  console.log("Device " + serial + " (" + how + ")\n");

  async function time(args, unzip) {
    const t = [];
    let bytes = 0;
    for (let i = 0; i < N; i++) {
      const t0 = Date.now();
      const r = await android.run(android.adb(), ["-s", serial, "exec-out"].concat(args), { encoding: "buffer", timeout: 15000 });
      bytes = r.stdout.length;
      if (unzip) zlib.gunzipSync(r.stdout);
      t.push(Date.now() - t0);
    }
    t.sort((a, b) => a - b);
    return { median: t[Math.floor(N / 2)], bytes };
  }

  const raw = await time(["screencap"], false);
  console.log("raw   " + ms(raw.median) + " per picture, " + (raw.bytes / 1048576).toFixed(1) + " MB");
  let gz = null;
  try {
    gz = await time(["screencap | gzip -1"], true);
    console.log("gzip  " + ms(gz.median) + " per picture, " + (gz.bytes / 1048576).toFixed(1) + " MB");
  } catch (e) { console.log("gzip  not available on this phone (" + e.message + ")"); }

  // What the Record tab sees: frame() picks the mode itself and reads ahead
  const DRAW_MS = 60;                       // time the window needs to receive and draw one frame
  for (let i = 0; i < 6; i++) await android.frame(serial);          // let it choose raw or gzip
  const frames = 15, t0 = Date.now();
  for (let i = 0; i < frames; i++) { await android.frame(serial); await new Promise(r => setTimeout(r, DRAW_MS)); }
  const fps = frames * 1000 / (Date.now() - t0);
  console.log("\nRecord tab: about " + fps.toFixed(1) + " frames per second");

  const best = gz && gz.median < raw.median ? gz.median : raw.median;
  console.log("Upper limit for this phone with screenshots: about " + (1000 / best).toFixed(1) + " frames per second.");
  if (best > 400) console.log("\nThe phone itself is slow to take screenshots. Lowering its screen resolution\n" +
                              "(Settings > Display > Screen resolution) or closing heavy apps helps most.");
  process.exit(0);
})().catch(e => { console.log("Failed: " + e.message); process.exit(1); });
