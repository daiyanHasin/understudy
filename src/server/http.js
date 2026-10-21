/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Small HTTP toolkit shared by every *.routes.js file.
 *
 *   const r = createRouter();
 *   r.GET("/api/x", (req, res, url) => r.json(res, 200, {...}));
 *   r.find("GET", "/api/x")  -> the handler, or undefined
 *
 * Handlers may be async and may throw: the server turns an Error into
 * { error: message } with e.status (default 400).
 */
const security = require("../core/security");
const state    = require("../core/state");

function json(res, status, obj) {
  res.writeHead(status, security.headers.api());
  res.end(JSON.stringify(obj));
}

function fail(res, e) {
  const status = e && e.status ? e.status : 400;
  json(res, status, { error: (e && e.message) || "Request failed" });
}

/** Throw a 409 when a test run owns the device (used before any device input). */
function deviceFree() {
  if (state.busy) { const e = new Error("A test run is using the device. Wait for it to finish or stop it."); e.status = 409; throw e; }
}

function createRouter() {
  const routes = {};
  const add = method => (p, fn) => {
    const key = method + " " + p;
    if (routes[key]) throw new Error("Route registered twice: " + key);   // catches copy-paste mistakes at start
    routes[key] = fn;
  };
  return {
    GET: add("GET"),
    POST: add("POST"),
    find: (method, p) => routes[method + " " + p],
    list: () => Object.keys(routes).sort(),
    json, fail, deviceFree,
    readJson: security.readJson
  };
}

module.exports = { createRouter, json, fail, deviceFree };
