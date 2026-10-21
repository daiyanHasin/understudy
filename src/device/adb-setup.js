/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * "Phone tools": Google's official platform-tools package (adb, about 8 MB),
 * downloaded into Understudy's own folder (tools/platform-tools). This is all
 * a USB or Wi-Fi phone needs. No Android Studio, no SDK manager, no Java,
 * no admin rights, no PATH or environment changes.
 *
 * The virtual-device tools (emulator + system image, about 1.5 GB) stay a
 * separate, optional install (tools/install-android.ps1).
 *
 * The zip is unpacked with Node's own zlib (no unzip program needed) and only
 * entries under "platform-tools/" are written, never outside the target.
 */

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const zlib  = require("zlib");
const P     = require("../core/paths");

const TOOLS_DIR = path.join(P.APP_DIR, "tools");
const TARGET    = path.join(TOOLS_DIR, "platform-tools");
const HOST      = "https://dl.google.com/android/repository/";
const FILES     = { win32: "platform-tools-latest-windows.zip", darwin: "platform-tools-latest-darwin.zip", linux: "platform-tools-latest-linux.zip" };
const MAX_BYTES = 80 * 1024 * 1024;

let job = { state: "idle", got: 0, total: 0, error: "" };

function localAdb() {
  const p = path.join(TARGET, process.platform === "win32" ? "adb.exe" : "adb");
  return fs.existsSync(p) ? p : null;
}
function status() { return Object.assign({ installed: !!localAdb(), path: localAdb() || "" }, job); }

function download(url, file, redirects) {
  return new Promise((resolve, reject) => {
    if (!/^https:\/\/([a-z0-9-]+\.)*(google\.com|googleapis\.com|gvt1\.com)\//i.test(url)) return reject(new Error("Unexpected download address"));
    const req = https.get(url, { headers: { "User-Agent": "Understudy" }, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 5) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, file, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("Download failed (HTTP " + res.statusCode + ")")); }
      job.total = +res.headers["content-length"] || 0; job.got = 0;
      const out = fs.createWriteStream(file);
      res.on("data", d => {
        job.got += d.length;
        if (job.got > MAX_BYTES) { req.destroy(new Error("The download is larger than expected")); }
      });
      res.pipe(out);
      out.on("finish", () => out.close(resolve));
      res.on("error", reject); out.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("The download stalled. Check the internet connection.")));
    req.on("error", reject);
  });
}

/* Minimal zip reader: central directory, stored + deflated entries. */
function unzip(zipFile, destRoot, prefix) {
  const b = fs.readFileSync(zipFile);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 70000); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("The downloaded file is not a valid zip");
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const root = path.resolve(destRoot);
  let written = 0;
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("Damaged zip");
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20);
    const nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32);
    const extAttr = b.readUInt32LE(p + 38), lho = b.readUInt32LE(p + 42);
    const name = b.toString("utf8", p + 46, p + 46 + nlen).replace(/\\/g, "/");
    p += 46 + nlen + xlen + clen;
    if (!name.startsWith(prefix) || name.includes("..")) continue;
    const full = path.resolve(root, name);
    if (!full.startsWith(root + path.sep)) continue;
    if (name.endsWith("/")) { fs.mkdirSync(full, { recursive: true }); continue; }
    const lnlen = b.readUInt16LE(lho + 26), lxlen = b.readUInt16LE(lho + 28);
    const raw = b.subarray(lho + 30 + lnlen + lxlen, lho + 30 + lnlen + lxlen + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error("Unsupported zip entry: " + name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
    const mode = (extAttr >>> 16) & 0o777;
    if (process.platform !== "win32" && mode) { try { fs.chmodSync(full, mode); } catch (_) {} }
    written++;
  }
  return written;
}

/** Start the install in the background. Poll status() for progress. */
function install() {
  if (job.state === "downloading" || job.state === "unpacking") return status();
  const file = FILES[process.platform];
  if (!file) throw new Error("This operating system is not supported");
  job = { state: "downloading", got: 0, total: 0, error: "" };
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  const zip = path.join(TOOLS_DIR, "platform-tools.zip.part");
  const staging = path.join(TOOLS_DIR, ".staging");
  download(HOST + file, zip)
    .then(() => {
      job.state = "unpacking";
      fs.rmSync(staging, { recursive: true, force: true });
      const n = unzip(zip, staging, "platform-tools/");
      if (!n) throw new Error("The package was empty");
      // Replace the old copy only after the new one unpacked fully
      fs.rmSync(TARGET, { recursive: true, force: true });
      fs.renameSync(path.join(staging, "platform-tools"), TARGET);
      if (!localAdb()) throw new Error("adb was not found in the package");
      job.state = "done";
    })
    .catch(e => { job.state = "error"; job.error = e.message; })
    .finally(() => {
      try { fs.rmSync(zip, { force: true }); } catch (_) {}
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) {}
    });
  return status();
}

module.exports = { install, status, localAdb, unzip, TARGET };
