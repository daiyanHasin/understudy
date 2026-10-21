/* Understudy website - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. */

/* ===== Edit these two lines after you publish ===== */
var GITHUB_URL   = "https://github.com/daiyanHasin/understudy";
var DOWNLOAD_URL = GITHUB_URL + "/archive/refs/heads/main.zip";
/* ================================================= */

(function () {
  var root = document.documentElement;

  // Links that point at GitHub
  document.querySelectorAll("[data-gh]").forEach(function (a) {
    var path = a.getAttribute("data-gh");
    a.href = GITHUB_URL + (path && path !== "true" ? path : "");
  });
  document.querySelectorAll("[data-download]").forEach(function (a) { a.href = DOWNLOAD_URL; });
  document.querySelectorAll("[data-year]").forEach(function (e) { e.textContent = new Date().getFullYear(); });

  // Theme
  function setTheme(t) {
    root.setAttribute("data-theme", t);
    try { localStorage.setItem("us-site-theme", t); } catch (_) {}
    var b = document.getElementById("themeBtn");
    if (b) b.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }
  var tb = document.getElementById("themeBtn");
  if (tb) tb.addEventListener("click", function () { setTheme(root.getAttribute("data-theme") === "light" ? "dark" : "light"); });

  // Mobile menu
  var mb = document.getElementById("menuBtn"), nl = document.querySelector(".nav-links");
  if (mb && nl) mb.addEventListener("click", function () {
    var open = nl.classList.toggle("open"); mb.setAttribute("aria-expanded", open);
  });

  // Copy buttons on code blocks
  document.querySelectorAll(".code").forEach(function (box) {
    var pre = box.querySelector("pre"); if (!pre) return;
    var b = document.createElement("button");
    b.className = "copy-btn"; b.type = "button"; b.textContent = "Copy";
    b.addEventListener("click", function () {
      navigator.clipboard.writeText(pre.innerText).then(function () {
        b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1400);
      });
    });
    box.appendChild(b);
  });

  // Reveal on scroll
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });

  // Lightbox
  var lb = document.getElementById("lightbox");
  if (lb) {
    var lbImg = lb.querySelector("img");
    document.querySelectorAll("[data-zoom]").forEach(function (b) {
      b.addEventListener("click", function () {
        lbImg.src = b.getAttribute("data-zoom"); lbImg.alt = b.querySelector("img").alt;
        lb.classList.add("open"); lb.focus();
      });
    });
    function close() { lb.classList.remove("open"); lbImg.src = ""; }
    lb.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  // Docs: sidebar toggle, search filter, scroll spy, on-this-page
  var side = document.querySelector(".dside");
  var dt = document.getElementById("docsMenu");
  if (side && dt) {
    dt.addEventListener("click", function () { var o = side.classList.toggle("open"); dt.setAttribute("aria-expanded", o); });
    side.addEventListener("click", function (e) { if (e.target.tagName === "A") side.classList.remove("open"); });
  }
  var search = document.getElementById("docSearch");
  if (search && side) search.addEventListener("input", function () {
    var q = search.value.trim().toLowerCase();
    side.querySelectorAll(".group").forEach(function (g) {
      var any = false;
      g.querySelectorAll("a").forEach(function (a) {
        var sec = document.getElementById(a.getAttribute("href").slice(1));
        var hit = !q || a.textContent.toLowerCase().indexOf(q) >= 0 || (sec && sec.textContent.toLowerCase().indexOf(q) >= 0);
        a.hidden = !hit; if (hit) any = true;
      });
      g.hidden = !any;
    });
  });
  var sections = Array.prototype.slice.call(document.querySelectorAll(".dmain > section[id]"));
  var toc = document.querySelector(".dtoc");
  function buildToc(sec) {
    if (!toc) return;
    var list = toc.querySelector(".list"); list.innerHTML = "";
    sec.querySelectorAll("h3[id]").forEach(function (h) {
      var a = document.createElement("a"); a.href = "#" + h.id; a.textContent = h.textContent; list.appendChild(a);
    });
    toc.style.visibility = list.children.length ? "visible" : "hidden";
  }
  if (sections.length && "IntersectionObserver" in window) {
    var current = null;
    var spy = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting || current === e.target) return;
        current = e.target;
        document.querySelectorAll(".dside a").forEach(function (a) {
          a.classList.toggle("active", a.getAttribute("href") === "#" + current.id);
        });
        buildToc(current);
      });
    }, { rootMargin: "-80px 0px -70% 0px" });
    sections.forEach(function (s) { spy.observe(s); });
    buildToc(sections[0]);
  }
})();
