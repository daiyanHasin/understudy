/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * One self-contained HTML report per run: Reports/Understudy-Run-<date>.html
 *
 * No external files, fonts or scripts from the internet: it opens the same
 * way from the app, from Explorer, from an e-mail attachment or a USB stick.
 * Failure screenshots are embedded (data: URIs). Each test links to the
 * detailed Maestro report that sits next to it.
 */

const fs   = require("fs");
const path = require("path");
const P    = require("../core/paths");

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
const dur = ms => {
  ms = Math.max(0, Number(ms) || 0);
  if (ms < 1000) return ms + " ms";
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + " s";
  const m = Math.floor(s / 60);
  return m + "m " + String(Math.round(s % 60)).padStart(2, "0") + "s";
};
const stamp = t => {
  const d = new Date(t), p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
};

function fileName(run) { return "Understudy-Run-" + stamp(run.started) + ".html"; }

function shotData(rel) {
  if (!rel) return "";
  try {
    const full = path.resolve(P.reports, decodeURIComponent(String(rel).replace(/^\/reports\//, "")));
    if (!full.startsWith(P.reports + path.sep)) return "";
    const b = fs.readFileSync(full);
    return b.length < 3 * 1024 * 1024 ? "data:image/png;base64," + b.toString("base64") : "";
  } catch (_) { return ""; }
}

function donut(passed, failed, skipped) {
  const total = Math.max(1, passed + failed + skipped);
  const r = 46, c = 2 * Math.PI * r;
  let off = 0;
  const seg = (n, color) => {
    if (!n) return "";
    const len = c * n / total;
    const s = '<circle r="' + r + '" cx="60" cy="60" fill="none" stroke="' + color + '" stroke-width="13" stroke-dasharray="' +
              len.toFixed(2) + " " + (c - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 60 60)"/>';
    off += len; return s;
  };
  const rate = Math.round(100 * passed / Math.max(1, passed + failed));
  return '<svg viewBox="0 0 120 120" class="donut" aria-hidden="true"><circle r="' + r + '" cx="60" cy="60" fill="none" stroke="var(--track)" stroke-width="13"/>' +
    seg(passed, "var(--ok)") + seg(failed, "var(--bad)") + seg(skipped, "var(--skip)") +
    '<text x="60" y="58" text-anchor="middle" class="dv">' + rate + '%</text><text x="60" y="76" text-anchor="middle" class="dl">pass rate</text></svg>';
}

const CSS = `
:root{--bg:#f6f5f2;--card:#fff;--ink:#17181c;--mute:#5d626c;--dim:#8d929b;--line:#e6e4df;--ok:#16834f;--bad:#c2342a;--skip:#9aa0a8;--track:#eceae5;--spot:#d98a1c;--chip:#f1efea}
@media (prefers-color-scheme:dark){:root{--bg:#0c0d10;--card:#15171b;--ink:#eceef1;--mute:#a8adb6;--dim:#6f7580;--line:#24272d;--ok:#4cc38a;--bad:#f0857a;--skip:#6f7580;--track:#24272d;--spot:#e9a23b;--chip:#1c1f24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 "Segoe UI",Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:36px 28px 60px}
.hero{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:center;background:linear-gradient(135deg,#16181d,#272a31);color:#f4f2ee;border-radius:20px;padding:30px 34px;position:relative;overflow:hidden}
.hero:after{content:"";position:absolute;right:-60px;top:-80px;width:320px;height:320px;background:radial-gradient(circle,rgba(233,162,59,.35),transparent 65%)}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:.02em;color:#e9a23b;font-size:12px;text-transform:uppercase}
.brand i{width:9px;height:9px;border-radius:50%;background:#e9a23b;box-shadow:0 0 12px #e9a23b}
h1{margin:10px 0 4px;font:600 30px/1.15 Georgia,"Times New Roman",serif;letter-spacing:-.01em}
.sub{color:#c3c0b9;font-size:13px}
.verdict{display:inline-block;margin-top:14px;padding:5px 14px;border-radius:999px;font-weight:600;font-size:12.5px}
.verdict.pass{background:rgba(76,195,138,.18);color:#7fe0b0}.verdict.fail{background:rgba(240,133,122,.18);color:#ffb0a6}
.donut{width:150px;height:150px;position:relative;z-index:1}.donut .dv{font:700 22px Segoe UI,sans-serif;fill:#fff}.donut .dl{font:11px Segoe UI,sans-serif;fill:#c3c0b9}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:18px 0 26px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}.kpi b{display:block;font-size:22px;font-weight:650}.kpi span{color:var(--dim);font-size:12px}
.kpi.ok b{color:var(--ok)}.kpi.bad b{color:var(--bad)}
.bar{display:flex;gap:8px;align-items:center;margin:0 0 12px}.bar h2{margin:0;font-size:16px;flex:1}
.filters button{border:1px solid var(--line);background:var(--card);color:var(--mute);border-radius:999px;padding:4px 12px;font:500 12px inherit;cursor:pointer}
.filters button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.job{background:var(--card);border:1px solid var(--line);border-radius:14px;margin-bottom:10px;overflow:hidden}
.job>summary{list-style:none;display:grid;grid-template-columns:auto 1fr auto auto;gap:14px;align-items:center;padding:14px 18px;cursor:pointer}
.job>summary::-webkit-details-marker{display:none}
.st{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-weight:700;font-size:13px}
.st.pass{background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok)}.st.fail{background:color-mix(in srgb,var(--bad) 15%,transparent);color:var(--bad)}
.st.skipped,.st.stopped{background:var(--chip);color:var(--dim)}
.nm{font-weight:600;word-break:break-all}.nm small{display:block;color:var(--dim);font-weight:400;font-size:12px}
.chip{background:var(--chip);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--mute);white-space:nowrap}
.body{border-top:1px solid var(--line);padding:16px 18px;display:grid;grid-template-columns:1fr 240px;gap:18px}
.body.noshot{grid-template-columns:1fr}
.why{background:color-mix(in srgb,var(--bad) 9%,transparent);border-left:3px solid var(--bad);padding:9px 12px;border-radius:8px;margin-bottom:12px;font-size:13px}
ol.steps{margin:0;padding:0;list-style:none;font:12.5px/1.5 Consolas,"JetBrains Mono",monospace}
ol.steps li{display:grid;grid-template-columns:20px 1fr auto;gap:8px;padding:4px 6px;border-radius:6px}
ol.steps li:nth-child(odd){background:var(--chip)}
ol.steps .i{text-align:center}ol.steps .COMPLETED .i{color:var(--ok)}ol.steps .FAILED{background:color-mix(in srgb,var(--bad) 13%,transparent)!important}ol.steps .FAILED .i{color:var(--bad)}
ol.steps .t{color:var(--dim)}
.shot img{width:100%;border-radius:12px;border:1px solid var(--line);box-shadow:0 10px 30px -12px rgba(0,0,0,.35)}
.shot span{display:block;color:var(--dim);font-size:11.5px;margin-top:6px;text-align:center}
a{color:var(--spot)}.links{margin-top:12px;font-size:12.5px}
footer{color:var(--dim);font-size:12px;text-align:center;margin-top:30px}
@media(max-width:760px){.hero{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}.body{grid-template-columns:1fr}}
@media print{.filters{display:none}.job{break-inside:avoid}details{open:true}}
`;

function render(run, opts) {
  opts = opts || {};
  const jobs = run.jobs || [];
  const total = jobs.length;
  const took = (run.finished || run.started) - run.started;
  const ok = !run.failed;
  const rows = jobs.map((j, i) => {
    const icon = { pass: "\u2713", fail: "\u2717", skipped: "\u21B7", stopped: "\u25A0" }[j.status] || "\u2022";
    const steps = (j.steps || []).map(s =>
      '<li class="' + esc(s.status) + '" style="padding-left:' + (6 + (s.depth || 0) * 14) + 'px"><span class="i">' +
      ({ COMPLETED: "\u2713", FAILED: "\u2717", SKIPPED: "\u21B7", WARNED: "!" }[s.status] || "\u2022") + "</span><span>" + esc(s.desc) +
      '</span><span class="t">' + (s.ms != null ? dur(s.ms) : "") + "</span></li>").join("");
    const img = j.status === "fail" ? shotData(j.screenshot) : "";
    const link = j.report ? '<div class="links"><a href="' + esc(j.report.replace(/^\/reports\//, "")) + '">Detailed Maestro report \u2192</a></div>' : "";
    return '<details class="job" data-s="' + esc(j.status) + '"' + (j.status === "fail" ? " open" : "") + "><summary>" +
      '<span class="st ' + esc(j.status) + '">' + icon + '</span><span class="nm">' + esc(j.flow) +
      "<small>" + (j.row ? "Excel row " + esc(j.row) : "No test data") + (j.fromStep ? " \u00b7 started at step " + esc(j.fromStep) : "") + "</small></span>" +
      '<span class="chip">' + esc(j.status === "pass" ? "Passed" : j.status === "fail" ? "Failed" : j.status === "stopped" ? "Stopped" : "Skipped") + "</span>" +
      '<span class="chip">' + dur(j.duration) + "</span></summary>" +
      '<div class="body' + (img ? "" : " noshot") + '"><div>' +
      (j.failedStep ? '<div class="why"><b>Failed at:</b> ' + esc(j.failedStep) + "</div>" : "") +
      (steps ? '<ol class="steps">' + steps + "</ol>" : '<div class="sub" style="color:var(--dim)">No step details were recorded for this test.</div>') +
      link + "</div>" +
      (img ? '<div class="shot"><img src="' + img + '" alt="Screen when the test failed"><span>Screen at the failure</span></div>' : "") +
      "</div></details>";
  }).join("");

  return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Test run " + esc(new Date(run.started).toLocaleString()) + " \u00b7 Understudy</title><style>" + CSS + "</style></head><body><div class=\"wrap\">" +
    '<section class="hero"><div><div class="brand"><i></i>Understudy test report</div>' +
    "<h1>" + esc(run.suite ? "Suite: " + run.suite : (total === 1 ? jobs[0].flow : total + " tests")) + "</h1>" +
    '<div class="sub">' + esc(new Date(run.started).toLocaleString()) + " \u00b7 " + dur(took) +
    (run.device ? " \u00b7 device " + esc(run.device) : "") + (opts.project ? " \u00b7 project " + esc(opts.project) : "") + "</div>" +
    '<div class="verdict ' + (ok ? "pass" : "fail") + '">' + (ok ? "All tests passed" : run.failed + " of " + total + " failed") + "</div></div>" +
    donut(run.passed || 0, run.failed || 0, run.skipped || 0) + "</section>" +
    '<div class="kpis"><div class="kpi"><b>' + total + '</b><span>Tests</span></div><div class="kpi ok"><b>' + (run.passed || 0) +
    '</b><span>Passed</span></div><div class="kpi bad"><b>' + (run.failed || 0) + '</b><span>Failed</span></div><div class="kpi"><b>' +
    (run.skipped || 0) + '</b><span>Skipped / stopped</span></div><div class="kpi"><b>' + dur(took) + "</b><span>Duration</span></div></div>" +
    '<div class="bar"><h2>Tests</h2><span class="filters"><button class="on" data-f="all">All</button> <button data-f="fail">Failed</button> <button data-f="pass">Passed</button></span></div>' +
    rows + "<footer>Made with Understudy \u00b7 runs 100% locally</footer></div>" +
    "<script>document.querySelectorAll('.filters button').forEach(function(b){b.onclick=function(){document.querySelectorAll('.filters button').forEach(function(x){x.classList.toggle('on',x===b)});" +
    "var f=b.getAttribute('data-f');document.querySelectorAll('.job').forEach(function(j){j.style.display=f==='all'||j.getAttribute('data-s')===f?'':'none'})}})</script>" +
    "</body></html>";
}

/* ---------- Maestro's own report, made self-contained ----------
 * `maestro test --format html-detailed` writes a page whose ONLY styling is Bootstrap
 * loaded from the internet (cdn.jsdelivr.net), and whose fold-out sections need
 * Bootstrap's script from the same place. That page shows as bare HTML lines when:
 *   - it is opened from the Reports folder, an e-mail or a USB stick on a PC that is
 *     offline or behind a company proxy (Netskope / Zscaler block or break the CDN)
 *   - it is opened inside Understudy: the report frame's security policy only allows
 *     its own files, so the CDN is refused there too.
 * fixMaestroReport() replaces those two CDN tags with a small built-in stylesheet for the
 * Bootstrap classes Maestro uses and a few lines of script for the fold-outs. Idempotent:
 * a report that was already fixed is left alone.
 */
const MAESTRO_MARK = "<!-- understudy:self-contained -->";
const CDN_LINK_RE   = /<link\b[^>]*href="https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap[^"]*"[^>]*>(\s*<\/link>)?/gi;
const CDN_SCRIPT_RE = /<script\b[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap[^"]*"[^>]*>\s*<\/script>/gi;

const MAESTRO_CSS = `
:root{--bg:#f6f5f2;--card:#fff;--ink:#17181c;--mute:#5d626c;--line:#e2e0da;--ok:#16834f;--bad:#c2342a;--info:#2f6fb3;--chip:#f1efea}
@media (prefers-color-scheme:dark){:root{--bg:#0c0d10;--card:#15171b;--ink:#eceef1;--mute:#a8adb6;--line:#2a2d33;--ok:#3fae7a;--bad:#e2685d;--info:#5b9ad8;--chip:#1c1f24}}
*{box-sizing:border-box}
body{margin:0 auto;max-width:1080px;padding:24px 20px 48px;background:var(--bg);color:var(--ink);font:14px/1.55 "Segoe UI",Inter,system-ui,-apple-system,sans-serif}
h1,h2,h3,h4,h5,h6{margin:0 0 .5rem;font-weight:600;line-height:1.2}
h1{font-size:28px}h3{font-size:26px}h5{font-size:16px}h6{font-size:14px}
p{margin:0 0 1rem}b{font-weight:650}a{color:var(--info)}time{font-variant-numeric:tabular-nums}
.card{position:relative;display:flex;flex-direction:column;min-width:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.card-body{flex:1 1 auto;padding:16px 18px}
.card-header{padding:10px 14px;background:var(--chip);border-bottom:1px solid var(--line)}
.card-title{margin-bottom:.5rem}.card-text:last-child{margin-bottom:0}
.card-group{display:flex;flex-wrap:wrap;gap:12px}.card-group>.card{flex:1 1 180px}
.text-center{text-align:center}.text-white{color:#fff!important}.text-dark{color:#17181c!important}
.text-danger{color:var(--bad)!important}
.bg-danger{background:var(--bad)!important;border-color:var(--bad)}.bg-success{background:var(--ok)!important;border-color:var(--ok)}
.bg-primary{background:var(--info)!important;color:#fff}.bg-light{background:#eef0f2!important}
.border-danger{border-color:var(--bad)!important}
.mb-0{margin-bottom:0!important}.mb-2{margin-bottom:.5rem!important}.mb-3{margin-bottom:1rem!important}.mb-4{margin-bottom:1.5rem!important}
.mt-3{margin-top:1rem!important}.mt-5{margin-top:1.5rem!important}.me-1{margin-right:.25rem!important}
.px-3{padding-left:1rem!important;padding-right:1rem!important}.pb-3{padding-bottom:1rem!important}
.d-flex{display:flex!important}.justify-content-between{justify-content:space-between!important}.align-items-center{align-items:center!important}
.btn{display:inline-block;width:100%;text-align:left;font:600 14px/1.4 inherit;font-family:inherit;padding:8px 14px;border:1px solid transparent;border-radius:8px;color:#fff;cursor:pointer;word-break:break-all}
.btn-success{background:var(--ok)}.btn-danger{background:var(--bad)}.btn:focus-visible{outline:2px solid var(--info);outline-offset:2px}
.btn::before{content:"\\25B8  ";display:inline}.btn[aria-expanded="true"]::before{content:"\\25BE  "}
.badge{display:inline-block;padding:2px 8px;font-size:12px;font-weight:600;line-height:1.4;border-radius:999px;white-space:nowrap}
.collapse{display:none}.collapse.show{display:block}
.table-responsive{overflow-x:auto}
.table{width:100%;border-collapse:collapse;margin-bottom:1rem}.table th,.table td{padding:6px 10px;text-align:left;vertical-align:top}
.table-sm th,.table-sm td{padding:4px 8px}.table-bordered th,.table-bordered td{border:1px solid var(--line)}
.alert{padding:12px 16px;border:1px solid var(--line);border-radius:10px}.alert-info{border-color:var(--info);background:color-mix(in srgb,var(--info) 10%,transparent)}
.font-monospace{font-family:Consolas,"JetBrains Mono",monospace}
@media print{.collapse{display:block!important}.btn::before{content:""}}
`;
const MAESTRO_JS =
  "document.querySelectorAll('[data-bs-toggle=\"collapse\"]').forEach(function(b){" +
  "var t=document.querySelector(b.getAttribute('data-bs-target'));if(!t)return;" +
  // failed flows open by default, so the reason is visible at once
  "if(b.classList.contains('btn-danger')){t.classList.add('show');b.setAttribute('aria-expanded','true');}" +
  "b.addEventListener('click',function(){var o=t.classList.toggle('show');b.setAttribute('aria-expanded',o?'true':'false');});});";

/** Make a Maestro HTML report readable offline and inside Understudy. Returns true when the file changed. */
function fixMaestroReport(file) {
  let html;
  try { html = fs.readFileSync(file, "utf8"); } catch (_) { return false; }
  const out = fixMaestroHtml(html);
  if (out === html) return false;
  fs.writeFileSync(file, out, "utf8");
  return true;
}
/** Same, on the text of the page (used by fixMaestroReport and by tools/check.js). */
function fixMaestroHtml(html) {
  if (html.includes(MAESTRO_MARK)) return html;
  if (!/cdn\.jsdelivr\.net\/npm\/bootstrap/i.test(html)) return html;     // not a Maestro report
  let out = html.replace(CDN_LINK_RE, "").replace(CDN_SCRIPT_RE, "");
  const style = MAESTRO_MARK + "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>" + MAESTRO_CSS + "</style>";
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, m => m + style) : style + out;
  const script = "<script>" + MAESTRO_JS + "</script>";
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, script + "</body>") : out + script;
  return out;
}

/** Fix every Maestro report already in Reports/ (reports from before 2.0.1). Returns how many changed. */
function fixAllMaestroReports() {
  let n = 0;
  try {
    for (const f of fs.readdirSync(P.reports)) {
      if (/\.html?$/i.test(f) && !f.startsWith("Understudy-Run-") && fixMaestroReport(path.join(P.reports, f))) n++;
    }
  } catch (_) {}
  return n;
}

/** Write the report for a run; returns its file name inside Reports/. */
function write(run) {
  fs.mkdirSync(P.reports, { recursive: true });
  const name = fileName(run);
  fs.writeFileSync(path.join(P.reports, name), render(run, { project: path.basename(P.root) }), "utf8");
  return name;
}

module.exports = { render, write, fileName, fixMaestroReport, fixMaestroHtml, fixAllMaestroReports };
