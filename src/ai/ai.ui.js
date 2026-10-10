/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Optional AI helper (lib/ai.js). Nothing here is required:
   without Ollama installed, the panel only explains how to add it.
   ============================================================ */

var AI = (function () {
  var A = { st: null, timer: null, busy: false };

  function api(url, body) {
    var o = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || "Request failed"); return d; });
    });
  }
  function refresh() {
    return api("/api/ai/status").then(function (s) { A.st = s; paintSetup(); paintPane(); return s; }).catch(function () {});
  }
  function pollPull() {
    clearInterval(A.timer);
    A.timer = setInterval(function () {
      refresh().then(function (s) { if (!s || !s.pull || s.pull.done) { clearInterval(A.timer); if (s && s.pull && s.pull.error) toast(s.pull.error, "err"); } });
    }, 1500);
  }

  function setupBody(box, compact) {
    var s = A.st;
    box.innerHTML = "";
    if (!s) { box.appendChild(el("div", "empty", "Checking\u2026")); return; }
    if (!compact) box.appendChild(el("p", "prose", "Describe a change in plain words (\u201Clog in with the test user, then open Orders and check the first order is visible\u201D) and a small model running on this PC writes or edits the flow for you. It is not part of Understudy: you add it only if you want it, and Understudy works the same without it. It needs a phone connected by USB, because it reads the real screen to target the right buttons."));
    var steps = el("div", "aisteps");
    function stepRow(done, title, detail, btn) {
      var r = el("div", "aistep" + (done ? " done" : ""));
      r.appendChild(el("span", "mark", done ? "\u2713" : "\u2022"));
      var b = el("div", ""); b.appendChild(el("b", "", title)); if (detail) b.appendChild(el("span", "dim", " " + detail));
      r.appendChild(b); if (btn) r.appendChild(btn);
      steps.appendChild(r);
    }
    var inst = null;
    if (!s.installed) { inst = el("button", "btn mini solid", "Install Ollama"); inst.onclick = install; }
    stepRow(s.installed, "1. Ollama (free, local model runner)", s.running ? "running" : s.installed ? "installed, not running: start it from the Start menu" : "about 200 MB", inst);

    var pulling = s.pull && !s.pull.done;
    var dl = null;
    if (s.installed && !s.hasModel && !pulling) {
      dl = el("span", "");
      var sel = document.createElement("select");
      s.choices.forEach(function (c) { var o = document.createElement("option"); o.value = c.id; o.textContent = c.label; sel.appendChild(o); });
      sel.value = s.model;
      var go = el("button", "btn mini solid", "Download");
      go.onclick = function () { api("/api/ai/pull", { model: sel.value }).then(function () { refresh(); pollPull(); }).catch(function (e) { toast(e.message, "err"); }); };
      dl.appendChild(sel); dl.appendChild(go);
    }
    var pdetail = pulling ? (s.pull.total ? Math.round(100 * s.pull.completed / s.pull.total) + "% of " + (s.pull.total / 1073741824).toFixed(2) + " GB" : s.pull.status) : (s.hasModel ? s.model : "");
    stepRow(s.hasModel, "2. Model", pdetail, dl);
    if (pulling) { var pb = el("div", "pbar"); var f = el("div", ""); f.style.width = (s.pull.total ? 100 * s.pull.completed / s.pull.total : 3) + "%"; pb.appendChild(f); steps.appendChild(pb); }

    var tg = null;
    if (s.hasModel) {
      tg = el("button", "btn mini" + (s.enabled ? "" : " solid"), s.enabled ? "Turn off" : "Turn on");
      tg.onclick = function () { api("/api/ai/enable", { on: !s.enabled }).then(refresh); };
    }
    stepRow(s.enabled && s.hasModel, "3. Helper", s.enabled ? "on: the AI tab on Record is ready" : "off", tg);
    box.appendChild(steps);
    if (s.hasModel && !compact) {
      var rm = el("button", "btn mini ghost", "Remove the model (frees disk space)");
      rm.onclick = function () { modal({ title: "Remove the AI model?", text: "Frees about " + (s.model.indexOf("3b") >= 0 ? "2" : "1") + " GB. You can download it again later.", ok: "Remove" })
        .then(function (v) { if (v) api("/api/ai/remove", { model: s.model }).then(refresh); }); };
      box.appendChild(rm);
    }
  }
  function paintSetup() { var b = $("aiSetup"); if (b) setupBody(b, false); }

  function paintPane() {
    var box = $("aiPane"); if (!box || $("pane-ai").hidden) return;
    var s = A.st;
    if (!s || !s.enabled || !s.hasModel) {
      box.innerHTML = "";
      box.appendChild(el("p", "fhint", "Optional. Write or change the flow from a sentence, with a small model on this PC."));
      setupBody(box.appendChild(el("div", "")), true);
      return;
    }
    if (box.querySelector("#aiPrompt")) return;        // keep what the user typed
    box.innerHTML = "";
    box.appendChild(el("div", "fhint", "Uses the flow on the left and what is on the phone right now. Phone over USB only. Check the result before applying."));
    var ta = document.createElement("textarea"); ta.id = "aiPrompt"; ta.className = "yaml small"; ta.rows = 4;
    ta.placeholder = "e.g. After login, open Settings, turn on Dark mode and check \u201CDark theme\u201D is visible";
    box.appendChild(ta);
    var bar = el("div", "racts");
    var go = el("button", "btn mini solid", "Write the flow"); go.id = "aiGo";
    go.onclick = generate;
    bar.appendChild(go); box.appendChild(bar);
    var out = el("div", ""); out.id = "aiOut"; box.appendChild(out);
    ta.addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); generate(); } });
  }

  function generate() {
    if (A.busy) return;
    var prompt = $("aiPrompt").value.trim();
    if (!prompt) { toast("Describe what the flow should do.", "err"); return; }
    if (!Rec.serial()) { toast("Connect a phone by USB first.", "err"); return; }
    A.busy = true; $("aiGo").disabled = true; $("aiGo").textContent = "Thinking\u2026 (can take a minute)";
    var out = $("aiOut"); out.innerHTML = "";
    api("/api/ai/generate", { serial: Rec.serial(), yaml: Rec.yaml(), prompt: prompt, appId: Rec.appId() }).then(function (d) {
      out.innerHTML = "";
      if (d.problem) out.appendChild(el("div", "derr", d.problem));
      var pre = document.createElement("textarea"); pre.className = "yaml small"; pre.rows = 12; pre.value = d.yaml; pre.spellcheck = false;
      out.appendChild(pre);
      var bar = el("div", "racts");
      var ap = el("button", "btn mini solid", "Apply to the flow");
      ap.onclick = function () { Rec.setYaml(pre.value).then(function (ok) { if (ok) { toast("Applied. Check the steps, then save.", "ok"); Rec.panel("flow"); } }); };
      var cp = el("button", "btn mini", "Discard"); cp.onclick = function () { out.innerHTML = ""; };
      bar.appendChild(ap); bar.appendChild(cp); out.appendChild(bar);
    }).catch(function (e) { out.appendChild(el("div", "derr", e.message)); })
      .finally(function () { A.busy = false; $("aiGo").disabled = false; $("aiGo").textContent = "Write the flow"; });
  }

  function install() {
    modal({ title: "Install Ollama?", text: "Opens a window that installs Ollama from its official source (winget). About 200 MB. When it finishes, come back here and press Download for the model.", ok: "Install" })
      .then(function (v) { if (v) api("/api/ai/install", {}).then(function () { toast("The installer is running in its own window.", "ok"); setTimeout(refresh, 20000); }); });
  }

  hooks.tab.push(function (name) { if (name === "setup") refresh(); });
  return { render: function () { refresh(); }, refresh: refresh };
})();
