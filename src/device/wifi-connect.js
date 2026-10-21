/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Phones over Wi-Fi: pair (6-digit code), connect (IP:port), usbToWifi (one click
 * from a USB phone). Plain-language reasons for failures come from wifi.js.
 */
const { ADDR_RE, adb, run, shell, checkSerial, sleep, devices, isWifi } = require("./adb");
const wifi = require("./wifi");

/* ---------- Phones over Wi-Fi (Android 11+ wireless debugging) ---------- */
async function pair(address, code) {
  if (!ADDR_RE.test(String(address || ""))) throw new Error("Enter the pairing address as IP:port");
  if (!/^\d{6}$/.test(String(code || ""))) throw new Error("The pairing code has 6 digits");
  // Reachable at all? Answers in 3 s instead of adb's long silent wait.
  const pre = await wifi.diagnose(address, "pair");
  if (!pre.ok) throw new Error(pre.message);
  let out = "";
  try { out = String((await run(adb(), ["pair", address, code], { timeout: 30000 })).stdout); }
  catch (e) { out = e.message; }
  if (!/success/i.test(out)) throw new Error(wifi.explainAdb(out, "pair") || out.trim() || "Pairing failed");
  return { ok: true, ip: wifi.split(address).host };
}
/* USB phone -> Wi-Fi with one click (works on every Android version):
   `adb tcpip 5555`, read the phone's IP, `adb connect IP:5555`. */
async function usbToWifi(serial) {
  checkSerial(serial);
  if (isWifi(serial) || serial.startsWith("emulator-")) throw new Error("Choose a phone connected by USB first");
  let ip = phoneWifiIp(await shell(serial, ["ip", "-f", "inet", "addr", "show"], { timeout: 8000 }).catch(() => ""));
  if (!ip) {
    const r = await shell(serial, ["ip", "route"], { timeout: 8000 }).catch(() => "");
    ip = (r.match(/src (\d+\.\d+\.\d+\.\d+)/) || [])[1];
  }
  if (!ip) throw new Error("The phone is not on Wi-Fi. Connect it to the same Wi-Fi as this PC and try again.");
  const nets = wifi.pcNetworks();
  if (nets.length && !wifi.sameNetwork(ip, nets))
    throw new Error("The phone (" + ip + ") and this PC (" + nets.filter(n => !n.virtual).map(n => n.address).join(", ") +
                    ") are on different networks. Connect both to the same Wi-Fi, then try again. The phone stays on USB.");
  await run(adb(), ["-s", serial, "tcpip", "5555"], { timeout: 15000 });
  await sleep(1500);
  const address = ip + ":5555";
  let lastErr = null;
  for (let i = 0; i < 5; i++) {               // the phone restarts its adb service: the first tries are often refused
    try { await connect(address); return { ok: true, address }; }
    catch (e) { lastErr = e; await sleep(1200); }
  }
  throw new Error(lastErr ? lastErr.message : "Could not connect over Wi-Fi.");
}

/* The phone's Wi-Fi address from `ip -f inet addr show`: wlan first, never
   mobile data (rmnet, ccmni), loopback or VPN interfaces. */
function phoneWifiIp(out) {
  const found = [];
  let dev = "";
  String(out || "").split(/\r?\n/).forEach(l => {
    const h = l.match(/^\d+:\s+([^:@\s]+)/); if (h) { dev = h[1]; return; }
    const m = l.match(/inet (\d+\.\d+\.\d+\.\d+)/); if (m && dev) found.push({ dev, ip: m[1] });
  });
  const ok = found.filter(x => !/^(lo|rmnet|ccmni|dummy|tun|ppp|r_rmnet|v4-|clat|ip6tnl|sit)/i.test(x.dev) && !/^127\./.test(x.ip));
  const w = ok.find(x => /^(wlan|swlan|wifi|eth)/i.test(x.dev)) || ok[0];
  return w ? w.ip : "";
}

/** "192.168.0.12" -> "192.168.0.12:5555"; spaces and a trailing slash removed. */
function normAddr(a) {
  let s = String(a || "").trim().replace(/\s+/g, "").replace(/\/+$/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) s += ":5555";
  return s;
}

async function connect(address) {
  address = normAddr(address);
  if (!ADDR_RE.test(address)) throw new Error("Enter the address as IP:port, e.g. 192.168.0.12:37123");
  // Reachable at all? A clear reason in 3 s instead of adb's “failed to connect” after 20 s.
  const pre = await wifi.diagnose(address, "connect");
  if (!pre.ok) throw new Error(pre.message);
  let t = "";
  try { t = String((await run(adb(), ["connect", address], { timeout: 20000 })).stdout).trim(); }
  catch (e) { t = e.message; }
  if (!/connected to/i.test(t) || /fail|unable|cannot/i.test(t)) throw new Error(wifi.explainAdb(t, "connect") || t || "Could not connect");
  // Connected is not the same as allowed: wait a moment for the phone's answer
  for (let i = 0; i < 8; i++) {
    const d = (await devices().catch(() => [])).find(x => x.serial === address);
    if (d && d.state === "device") return { ok: true, address };
    if (d && d.state === "unauthorized" && i >= 3) {
      throw new Error("Connected, but the phone has not allowed this PC. Unlock the phone and tap Allow, or pair it first (QR code or 6-digit code).");
    }
    await sleep(500);
  }
  return { ok: true, address };
}

module.exports = {
  pair, connect, usbToWifi, normAddr, phoneWifiIp
};
