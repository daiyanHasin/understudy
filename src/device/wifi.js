/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Wi-Fi phones: find out WHY a connection fails and say what to do.
 *
 * adb's own messages ("failed to connect", "Connection refused", "10060")
 * don't tell a tester what is wrong. Before adb pair / adb connect, this
 * module opens a plain TCP connection to the phone (3 s) and checks the
 * PC's own networks, so the answer is one of:
 *
 *   reachable   the phone answers on that port                 -> go ahead
 *   refused     the phone answers, but nothing listens there   -> wrong / old port
 *   timeout     nothing answers                                -> different network,
 *               office/guest Wi-Fi that keeps devices apart, VPN or firewall
 *   network     the phone is on another network than this PC
 *
 * Pure Node (net, os). No adb, no shell, nothing leaves the local network.
 */

const net = require("net");
const os  = require("os");

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const ADDR = /^(\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*):(\d{2,5})$/;
const VIRTUAL_IF = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Bluetooth|vpn|\btap\b|\btun\b|Netskope|Zscaler|Cisco|Fortinet|GlobalProtect|Tailscale|ZeroTier|WireGuard|OpenVPN/i;

function toInt(ip) {
  const m = String(ip).match(IPV4);
  if (!m || m.slice(1).some(x => +x > 255)) return null;
  return ((+m[1] << 24) >>> 0) + (+m[2] << 16) + (+m[3] << 8) + (+m[4]);
}

/** IPv4 networks of this PC: [{ name, address, netmask, virtual }] */
function pcNetworks() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.internal || !(a.family === "IPv4" || a.family === 4)) continue;
      if (/^169\.254\./.test(a.address)) continue;               // no network (self-assigned)
      out.push({ name, address: a.address, netmask: a.netmask, virtual: VIRTUAL_IF.test(name) });
    }
  }
  return out;
}

/** The PC network the phone's IP belongs to, or null. */
function sameNetwork(ip, nets) {
  const t = toInt(ip);
  if (t === null) return null;
  return (nets || pcNetworks()).find(n => {
    const a = toInt(n.address), m = toInt(n.netmask);
    return a !== null && m !== null && ((a & m) >>> 0) === ((t & m) >>> 0);
  }) || null;
}

/** Can this PC open a TCP connection to host:port? { ok, code } */
function probe(host, port, ms) {
  return new Promise(resolve => {
    let done = false;
    const s = net.connect({ host, port: +port });
    const end = r => { if (done) return; done = true; clearTimeout(t); s.destroy(); resolve(r); };
    const t = setTimeout(() => end({ ok: false, code: "TIMEOUT" }), ms || 3000);
    s.on("connect", () => end({ ok: true, code: "OK" }));
    s.on("error", e => end({ ok: false, code: e.code || "ERROR" }));
  });
}

function split(address) {
  const m = String(address || "").trim().match(ADDR);
  return m ? { host: m[1], port: +m[2] } : null;
}

const HOTSPOT_TIP = "Ways around it: connect the phone to this PC's Mobile hotspot (Windows Settings \u203a Network \u203a Mobile hotspot), " +
                    "or plug the phone in by USB once and press \u201CSwitch the USB phone to Wi-Fi\u201D, or simply record over USB.";

/**
 * One clear answer for an address. kind: reachable | refused | timeout | network | invalid
 * `what` = "pair" or "connect" (only changes the wording).
 */
async function diagnose(address, what) {
  const a = split(address);
  if (!a) return { ok: false, kind: "invalid", message: "Enter the address as IP:port, for example 192.168.0.12:37123." };
  const nets = pcNetworks();
  const real = nets.filter(n => !n.virtual);
  const pcList = (real.length ? real : nets).map(n => n.address).join(", ") || "none";
  const same = IPV4.test(a.host) ? sameNetwork(a.host, nets) : null;
  const r = await probe(a.host, a.port, 3000);
  const detail = { phone: a.host, port: a.port, pc: pcList, sameNetwork: !!same, via: same ? same.name : "", probe: r.code };

  if (r.ok) return { ok: true, kind: "reachable", detail,
    message: "This PC reaches the phone at " + a.host + ":" + a.port + "." };

  if (r.code === "ECONNREFUSED") return { ok: false, kind: "refused", detail,
    message: "The phone answered but refused port " + a.port + ". " +
      (what === "pair"
        ? "The pairing code and port are only valid while the \u201CPair device with pairing code\u201D window is open on the phone. Open it again and use the new code and port."
        : a.port === 5555
          ? "Port 5555 only works after \u201CSwitch the USB phone to Wi-Fi\u201D, and it closes when the phone restarts. Do that again, or use Wireless debugging."
          : "Wireless debugging picks a new port every time it is turned on, and the pairing port is not the connection port. On the phone open Wireless debugging and copy the \u201CIP address & Port\u201D shown at the top.") };

  if (IPV4.test(a.host) && !same && nets.length) return { ok: false, kind: "network", detail,
    message: "The phone (" + a.host + ") and this PC (" + pcList + ") are on different networks. Connect both to the same Wi-Fi. " +
             "If the PC uses a cable, it must be the same office network as the phone's Wi-Fi. " + HOTSPOT_TIP };

  return { ok: false, kind: "timeout", detail,
    message: "This PC can't reach the phone at " + a.host + ". Usually the Wi-Fi keeps devices apart (common on office and guest Wi-Fi: \u201Cclient isolation\u201D), " +
             "a VPN or security client on this PC blocks local traffic, or the phone's Wi-Fi went to sleep (unlock it). " + HOTSPOT_TIP };
}

/** adb's short error text -> what to do, or "" when there is nothing better to say. */
function explainAdb(text, what) {
  const t = String(text || "");
  if (/Wrong password|wrong pairing code|Failed: Wrong/i.test(t))
    return "Wrong pairing code, or it expired. On the phone open \u201CPair device with pairing code\u201D again and use the new code and port.";
  if (/failed to authenticate|unauthorized|not paired/i.test(t))
    return "The phone has not paired with this PC yet. Pair it first (QR code or 6-digit code), then connect.";
  if (/refused|10061/i.test(t))
    return what === "pair" ? "The phone refused the pairing port. Open \u201CPair device with pairing code\u201D again and use the new port."
                           : "The phone refused that port. Copy the \u201CIP address & Port\u201D from the top of Wireless debugging (not the pairing port).";
  if (/timed out|10060|unreachable|No route|10065|10051/i.test(t))
    return "This PC can't reach the phone. Check that both are on the same Wi-Fi and that the network allows devices to talk to each other.";
  if (/protocol fault|Unable to start pairing client|connection reset/i.test(t))
    return "The phone dropped the connection. Turn Wireless debugging off and on, then try again.";
  return "";
}

module.exports = { pcNetworks, sameNetwork, probe, diagnose, explainAdb, split };
