/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Flow Editor tab
   ============================================================ */
var ed = {
  current: null,     // path
  orig: "",          // server content at open
  val: "",           // current textarea value
  cm: null,          // CodeMirror view if upgraded
  cmTried: false
};

function edDirty() { return !!ed.current && ed.val !== ed.orig; }

function renderFlowEditorList() {
  var box = $("edList");
  if (!box) return;
  box.innerHTML = "";
  if (!flows.length) {
    box.appendChild(el("div", "empty", "No flows found."));
    return;
  }
  var q = ($("edFilter").value || "").trim().toLowerCase();
  var shown = q ? flows.filter(function (f) { return f.path.toLowerCase().indexOf(q) >= 0; }) : flows;
  if (!shown.length) { box.appendChild(el("div", "empty", "No flows match the filter.")); return; }

  var groups = {}, order = [];
  shown.forEach(function (f) {
    var i = f.path.lastIndexOf("/");
    var g = i >= 0 ? f.path.slice(0, i) : "";
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(f);
  });

  order.forEach(function (g) {
    var list = groups[g];
    box.appendChild(el("div", "folder", "Flows/" + g));
    list.forEach(function (f) {
      var row = el("div", "flow");
      if (ed.current === f.path) row.className += " sel";
      var nm = el("div", "fname");
      nm.title = f.path + (f.appId ? "\nappId: " + f.appId : "");
      nm.appendChild(el("span", "fn", f.path.slice(f.path.lastIndexOf("/") + 1)));
      if (f.appId) nm.appendChild(el("small", "fapp", f.appId));
      nm.onclick = function () { openFlowForEdit(f.path); };
      row.appendChild(nm);
      var acts = el("div", "flowacts");
      var dup = el("button", "btn mini", "\u29C9"); dup.title = "Duplicate";
      dup.onclick = function () { duplicateFlowDialog(f.path); };
      var ren = el("button", "btn mini", "\u270E"); ren.title = "Rename";
      ren.onclick = function () { renameFlowDialog(f.path); };
      var del = el("button", "btn mini", "\u2715"); del.title = "Delete";
      del.onclick = function () { deleteFlowDialog(f.path); };
      acts.appendChild(dup); acts.appendChild(ren); acts.appendChild(del);
      row.appendChild(acts);
      box.appendChild(row);
    });
  });
}

async function openFlowForEdit(p) {
  if (edDirty()) {
    var go = await modal({ title: "Discard changes?", text: "You have unsaved changes in " + ed.current + ".", ok: "Discard" });
    if (!go) return;
  }
  var r = await fetch("/api/flow/read?path=" + encodeURIComponent(p));
  var d = await r.json();
  if (!r.ok) { toast(d.error || "Could not read flow", "err"); return; }
  ed.current = d.path;
  ed.orig = d.content;
  ed.val = d.content;
  $("edTitle").textContent = p;
  renderFlowEditorList();
  $("edWrap").hidden = false;
  $("edHint").hidden = false;
  var meta = $("edMeta");
  var f = flowByPath(p);
  meta.hidden = !(f && f.appId);
  if (f && f.appId) meta.textContent = "appId: " + f.appId;
  mountEditor();
}

/* Try CodeMirror once. If offline, fall back to textarea silently. */
function mountEditor() {
  var area = $("edArea");
  if (!area) return;
  // Always keep the textarea as the source of truth
  area.value = ed.val;
  if (ed.cm) { ed.cm.destroy(); ed.cm = null; }
  updateEditorButtons();

  if (ed.cmTried) return;
  ed.cmTried = true;

  // Fire-and-forget: try to load CodeMirror 6 from CDN; silently give up on failure.
  tryLoadCodeMirror().then(function (ok) {
    if (!ok) return; // offline -> plain textarea is fine
    // Re-enter: hide textarea, mount CM
    mountCodeMirror();
  }).catch(function () {});
}

async function tryLoadCodeMirror() {
  // Quick reachability probe with a timeout so we don't hang on a dead network.
  return new Promise(function (resolve) {
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; resolve(false); } }, 1500);
    var img = new Image();
    img.onload = img.onerror = function () {
      if (done) return;
      done = true; clearTimeout(t);
      resolve(true); // any response (even error) means we're online enough
    };
    // tiny transparent GIF from jsdelivr
    img.src = "https://cdn.jsdelivr.net/npm/codemirror@6.0.1/package.json?probe=" + Date.now();
  });
}

function mountCodeMirror() {
  // CodeMirror 6 via esm.sh as a single ESM bundle. If this fails, textarea stays.
  var area = $("edArea");
  import("https://esm.sh/codemirror@6.0.1")
    .then(function (CM) {
      import("https://esm.sh/@codemirror/lang-yaml@6.0.0")
        .then(function (YAML) {
          try {
            area.style.display = "none";
            var parent = area.parentElement;
            var host = document.createElement("div");
            host.style.minHeight = "480px";
            parent.appendChild(host);
            ed.cm = new CM.EditorView({
              doc: ed.val,
              extensions: [
                CM.basicSetup,
                YAML.yaml(),
                CM.EditorView.lineWrapping,
                CM.EditorView.updateListener.of(function (u) {
                  if (u.docChanged) {
                    ed.val = u.state.doc.toString();
                    updateEditorButtons();
                  }
                })
              ],
              parent: host
            });
            updateEditorButtons();
          } catch (e) { area.style.display = ""; }
        })
        .catch(function () {});
    })
    .catch(function () {});
}

function updateEditorButtons() {
  var dirty = edDirty();
  $("edSave").disabled = running || !dirty;
  $("edRevert").disabled = running || !dirty;
  $("edRun").disabled = running || !ed.current;
  if ($("edRunFrom")) $("edRunFrom").disabled = running || !ed.current;
  var w = $("edWrap");
  if (w) w.className = "editorbox" + (dirty ? " dirty" : "");
  var t = $("edTitle");
  if (t && ed.current) t.textContent = ed.current + (dirty ? " *" : "");
}

/* Keep textarea edits synced */
document.addEventListener("input", function (e) {
  if (e.target && e.target.id === "edArea") {
    ed.val = e.target.value;
    updateEditorButtons();
  }
});

async function saveFlow() {
  if (!ed.current || !edDirty()) return;
  try {
    var r = await fetch("/api/flow/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ed.current, content: ed.val })
    });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Save failed", "err"); return; }
    ed.orig = ed.val;
    toast("Saved " + ed.current, "ok");
    updateEditorButtons();
    loadFlows();
  } catch (e) { toast("Save failed", "err"); }
}

async function revertFlow() {
  if (!ed.current || !edDirty()) return;
  var go = await modal({ title: "Revert changes?", text: "Discard unsaved changes to " + ed.current + "?", ok: "Revert" });
  if (!go) return;
  ed.val = ed.orig;
  if (ed.cm) { ed.cm.destroy(); ed.cm = null; }
  var area = $("edArea");
  area.style.display = "";
  // remove CM host if any
  var host = area.parentElement.querySelector("div[style*='min-height']");
  if (host) host.remove();
  area.value = ed.val;
  ed.cmTried = false; // allow re-mount
  mountEditor();
}

function runCurrentFlow() {
  if (!ed.current) return;
  showTab("run");
  runFlows([ed.current]);
}

async function newFlowDialog() {
  var v = await modal({
    title: "New flow",
    text: "Creates a minimal Maestro YAML. Fill appId and steps.",
    fields: [
      { id: "path", label: "Flow path (inside Flows/)", placeholder: "sub/my-flow.yaml" },
      { id: "appId", label: "appId", placeholder: "com.example.app" }
    ],
    ok: "Create",
    validate: function (v) {
      if (!v.path) return "Please enter a path.";
      return "";
    }
  });
  if (!v) return;
  var appId = v.appId || "com.example.app";
  var body = "appId: " + appId + "\n---\n- launchApp\n";
  try {
    var r = await fetch("/api/flow/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: v.path, content: body })
    });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Could not create flow", "err"); return; }
    toast("Created " + v.path, "ok");
    await loadFlows();
    openFlowForEdit(v.path);
  } catch (e) { toast("Could not create flow", "err"); }
}

async function duplicateFlowDialog(from) {
  var v = await modal({
    title: "Duplicate flow",
    text: from,
    fields: [{ id: "to", label: "New path", value: from.replace(/\.ya?ml$/i, "-copy.yaml") }],
    ok: "Duplicate",
    validate: function (v) { return v.to ? "" : "Please enter a new path."; }
  });
  if (!v) return;
  try {
    var r = await fetch("/api/flow/duplicate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: from, to: v.to }) });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Duplicate failed", "err"); return; }
    toast("Duplicated to " + v.to, "ok");
    loadFlows();
  } catch (e) { toast("Duplicate failed", "err"); }
}

async function renameFlowDialog(from) {
  var v = await modal({
    title: "Rename flow",
    text: "Old reports for this flow become orphaned (they keep the old name).",
    fields: [{ id: "to", label: "New path", value: from }],
    ok: "Rename",
    validate: function (v) { return v.to ? "" : "Please enter a new path."; }
  });
  if (!v) return;
  try {
    var r = await fetch("/api/flow/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: from, to: v.to }) });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Rename failed", "err"); return; }
    toast("Renamed to " + v.to, "ok");
    if (ed.current === from) { ed.current = null; ed.orig = ""; ed.val = ""; $("edWrap").hidden = true; $("edTitle").textContent = "Select a flow to begin"; }
    loadFlows();
  } catch (e) { toast("Rename failed", "err"); }
}

async function deleteFlowDialog(p) {
  var go = await modal({ title: "Delete flow?", text: p + " will be backed up to FlowBackups/ then removed.", ok: "Delete" });
  if (!go) return;
  try {
    var r = await fetch("/api/flow/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) });
    var d = await r.json();
    if (!r.ok) { toast(d.error || "Delete failed", "err"); return; }
    toast("Deleted " + p, "ok");
    if (ed.current === p) { ed.current = null; ed.orig = ""; ed.val = ""; $("edWrap").hidden = true; $("edTitle").textContent = "Select a flow to begin"; }
    loadFlows();
  } catch (e) { toast("Delete failed", "err"); }
}

