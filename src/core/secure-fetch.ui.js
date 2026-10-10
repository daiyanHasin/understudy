/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Loaded before app.js. Adds this window's session token to every request
 * that changes something, so other websites can't drive Understudy.
 * When the server restarts the token changes: show a reload banner.
 */
(function () {
  var meta = document.querySelector('meta[name="us-token"]');
  var TOKEN = meta ? meta.getAttribute("content") : "";
  var nativeFetch = window.fetch.bind(window);
  var warned = false;

  function sameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (_) { return false; }
  }

  function sessionLost() {
    if (warned) return;
    warned = true;
    var bar = document.createElement("div");
    bar.className = "sessionbar";
    bar.setAttribute("role", "alert");
    bar.innerHTML = "Understudy was restarted. <button class=\"btn mini solid\">Reload</button>";
    bar.querySelector("button").onclick = function () { location.reload(); };
    document.body.appendChild(bar);
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    init = init || {};
    var method = String(init.method || (input && input.method) || "GET").toUpperCase();
    if (sameOrigin(url)) {
      init.credentials = "same-origin";
      if (method !== "GET" && method !== "HEAD") {
        var h = new Headers(init.headers || {});
        h.set("X-Understudy-Token", TOKEN);
        init.headers = h;
      }
    }
    return nativeFetch(input, init).then(function (r) {
      if (r.status === 401 && sameOrigin(url)) sessionLost();
      return r;
    });
  };
  window.US_TOKEN = TOKEN;
})();
