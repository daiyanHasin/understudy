/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Files the browser loads:
 *   - public UI files (index.html, app.js, styles.css, src/<feature>/*.ui.js, assets/)
 *   - files behind the session: Reports/* and failure screenshots in .runs/
 * Every path is resolved and checked to stay inside its folder.
 */
const fs   = require("fs");
const path = require("path");
const security = require("../core/security");
const P        = require("../core/paths");

const APP_DIR = P.APP_DIR;

const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".gif": "image/gif",
  ".webp": "image/webp", ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json"
};

function sendStatic(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, security.headers.plain("text/plain")); return res.end("Not found"); }
    const h = security.headers.app(STATIC_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
    // Code is re-checked every start (no-cache); images and fonts are cached
    h["Cache-Control"] = /\.(woff2|png|ico|gif|webp)$/i.test(file) ? "max-age=604800" : "no-cache";
    res.writeHead(200, h);
    res.end(data);
  });
}

function sendIndex(res) {
  fs.readFile(path.join(APP_DIR, "app", "index.html"), "utf8", (err, html) => {
    if (err) { res.writeHead(500); return res.end("index.html missing"); }
    const h = security.headers.app("text/html; charset=utf-8");
    h["Set-Cookie"] = security.sessionCookie();
    h["Cache-Control"] = "no-store";
    res.writeHead(200, h);
    res.end(html.replace("__US_TOKEN__", security.TOKEN));
  });
}

/** Public files (no data in them). Returns true when it answered. */
function servePublic(req, res, p) {
  if (req.method !== "GET") return false;
  if (p === "/" || p === "/index.html") { sendIndex(res); return true; }
  if (p === "/styles.css" || p === "/app.js") { sendStatic(res, path.join(APP_DIR, "app", p.slice(1))); return true; }
  if (p === "/app.config.json" || p === "/manifest.webmanifest") { sendStatic(res, path.join(APP_DIR, p.slice(1))); return true; }
  if (/^\/src\/[a-z]+\/[a-z0-9-]+\.ui\.js$/.test(p)) { sendStatic(res, path.join(APP_DIR, p)); return true; }
  if (/^\/assets\/[a-z0-9-]+\.(svg|png|ico|gif|webp)$/.test(p)) { sendStatic(res, path.join(APP_DIR, p)); return true; }
  if (/^\/assets\/fonts\/[a-z0-9-]+\.woff2$/.test(p)) { sendStatic(res, path.join(APP_DIR, p)); return true; }
  if (p === "/favicon.ico") { sendStatic(res, path.join(APP_DIR, "assets", "understudy.ico")); return true; }
  return false;
}

function serveReport(req, res, p) {
  const rel = decodeURIComponent(p.slice("/reports/".length));
  const REPORTS_DIR = P.reports;
  const filePath = path.resolve(REPORTS_DIR, rel);
  if (!filePath.startsWith(REPORTS_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const types = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
                    ".css": "text/css", ".js": "application/javascript", ".json": "application/json" };
    res.writeHead(200, security.headers.report(types[path.extname(filePath).toLowerCase()] || "application/octet-stream"));
    res.end(data);
  });
}

function serveRunShot(req, res, p) {
  const rel = p.slice("/runs/".length).split("/").map(decodeURIComponent).join(path.sep);
  const filePath = path.resolve(P.runs, rel);
  if (!filePath.startsWith(P.runs + path.sep) || !/\.png$/i.test(filePath)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, security.headers.api("image/png"));
    res.end(data);
  });
}

module.exports = { servePublic, sendStatic, sendIndex, serveReport, serveRunShot };
