/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Local security for the Understudy server.
 *
 * Threats this covers (the server only listens on 127.0.0.1, but any web
 * page open in the user's browser can still try to send it requests):
 *   - DNS rebinding         -> Host header must be one of our local names
 *   - Cross-site requests   -> per-process session token, sent as an
 *                              HttpOnly SameSite=Strict cookie AND, for
 *                              every state-changing call, as a header that
 *                              other sites cannot set without a CORS
 *                              preflight (which we never approve)
 *   - Foreign origins       -> Origin header, when present, must be ours
 *   - Oversized bodies      -> hard limits on JSON and uploads
 *   - Report pages          -> served sandboxed so their scripts cannot
 *                              reach the app or its API
 */

const crypto = require("crypto");

const TOKEN       = crypto.randomBytes(32).toString("hex");   // new every start
const COOKIE_NAME = "us_session";
const JSON_LIMIT  = 5 * 1024 * 1024;                          // 5 MB

let allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
let port = 0;

function configure(opts) {
  port = opts.port;
  allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]"].concat(opts.hostNames || []));
}

function hostOk(req) {
  const raw  = String(req.headers.host || "").toLowerCase();
  const host = raw.replace(/:\d+$/, "");
  const p    = (raw.match(/:(\d+)$/) || [])[1];
  if (p && Number(p) !== port) return false;
  return allowedHosts.has(host);
}

function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;              // same-origin GETs and old clients send none
  if (origin === "null") return false;   // sandboxed frames, file:// pages
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && allowedHosts.has(u.hostname.toLowerCase()) &&
           Number(u.port || 80) === port;
  } catch (_) { return false; }
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function same(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(TOKEN);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Session cookie present and valid (used for every /api, /reports, /runs request). */
function sessionOk(req) { return same(parseCookies(req)[COOKIE_NAME]); }

/** State-changing requests must also carry the token header. */
function csrfOk(req) {
  if (req.method === "GET" || req.method === "HEAD") return true;
  return same(req.headers["x-understudy-token"]) && originOk(req);
}

function sessionCookie() {
  return COOKIE_NAME + "=" + TOKEN + "; HttpOnly; SameSite=Strict; Path=/";
}

/* ---------- Response headers ---------- */
const APP_CSP = [
  "default-src 'self'",
  // inline handlers in index.html; esm.sh = optional CodeMirror editor
  "script-src 'self' 'unsafe-inline' https://esm.sh",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://cdn.jsdelivr.net",
  "connect-src 'self' https://esm.sh",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'"
].join("; ");

function baseHeaders(extra) {
  return Object.assign({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), usb=(), payment=()"
  }, extra || {});
}

const headers = {
  app:    t => baseHeaders({ "Content-Type": t, "Content-Security-Policy": APP_CSP, "X-Frame-Options": "SAMEORIGIN" }),
  api:    t => baseHeaders({ "Content-Type": t || "application/json; charset=utf-8", "Cache-Control": "no-store" }),
  // Maestro reports run in an opaque origin: no cookies, no access to the parent page
  report: t => baseHeaders({ "Content-Type": t, "Content-Security-Policy": "sandbox allow-scripts allow-popups; default-src 'self' 'unsafe-inline' data: blob:", "Cache-Control": "no-store" }),
  plain:  t => baseHeaders({ "Content-Type": t })
};

/* ---------- Bodies ---------- */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers["content-type"] || "");
    if (req.method !== "GET" && ct && !/^application\/json\b/i.test(ct)) {
      const e = new Error("Expected JSON"); e.status = 415; return reject(e);
    }
    let size = 0, tooBig = false; const chunks = [];
    req.on("data", c => {
      if (tooBig) return;                       // keep draining so the 413 reply can be read
      size += c.length;
      if (size > JSON_LIMIT) { tooBig = true; chunks.length = 0; const e = new Error("Request too large"); e.status = 413; reject(e); }
      else chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) return;
      const txt = Buffer.concat(chunks).toString("utf8");
      if (!txt) return resolve({});
      try { resolve(JSON.parse(txt)); }
      catch (_) { const e = new Error("Invalid JSON"); e.status = 400; reject(e); }
    });
    req.on("error", reject);
  });
}

module.exports = {
  TOKEN, configure, hostOk, originOk, sessionOk, csrfOk, sessionCookie,
  headers, readJson, JSON_LIMIT
};
