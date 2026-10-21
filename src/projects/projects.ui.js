/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/* ============================================================
   Projects: install Understudy once, switch between projects here.
   Switching reloads the window so every tab shows the new project.
   ============================================================ */

var Projects = (function () {
  var P = { list: null };

  function api(url, body) {
    var o = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || "Request failed"); return d; });
    });
  }

  function load() {
    return api("/api/projects").then(function (d) {
      P.list = d;
      var cur = d.projects.filter(function (p) { return p.current; })[0];
      $("projName").textContent = cur ? cur.name : "Project";
      $("projBtn").title = cur ? cur.path : "";
      return d;
    }).catch(function () {});
  }

  function render() {
    var pop = $("projPop"); pop.innerHTML = "";
    var d = P.list || { projects: [] };
    pop.appendChild(el("div", "phead", "Projects"));
    d.projects.forEach(function (p) {
      var row = el("div", "prow" + (p.current ? " cur" : "") + (p.missing ? " missing" : ""));
      var open = el("button", "popen");
      open.appendChild(el("b", "", p.name + (p.isDefault ? "  \u00b7 install folder" : "")));
      open.appendChild(el("span", "", p.missing ? "Folder not found: " + p.path : p.flows + " flow" + (p.flows === 1 ? "" : "s") + "  \u00b7  " + p.path));
      open.title = p.path;
      open.disabled = p.current || p.missing;
      open.onclick = function () { openProject(p.path); };
      row.appendChild(open);
      var more = el("button", "btn mini ghost", "\u22EF");
      more.title = "Rename or remove from the list";
      more.onclick = function (e) { e.stopPropagation(); manage(p); };
      row.appendChild(more);
      pop.appendChild(row);
    });
    var bar = el("div", "pbar2");
    var nw = el("button", "btn mini solid", "+ New project"); nw.onclick = createProject;
    var add = el("button", "btn mini", "Add existing folder\u2026"); add.onclick = addExisting;
    var fold = el("button", "btn mini", "Open folder"); fold.onclick = function () { openFolder("project"); };
    bar.appendChild(nw); bar.appendChild(add); bar.appendChild(fold);
    pop.appendChild(bar);
    pop.appendChild(el("div", "pnote", "Understudy is installed once. Each project keeps its own flows, test data, reports and history."));
  }

  function toggle(force) {
    var pop = $("projPop");
    var show = force !== undefined ? force : pop.hidden;
    if (!show) { pop.hidden = true; return; }
    load().then(function () { render(); pop.hidden = false; });
  }

  function switched(d) {
    toast("Opening " + (d.project ? d.project.name : "project") + "\u2026", "ok");
    setTimeout(function () { location.reload(); }, 300);
  }
  function openProject(path) {
    if (typeof running !== "undefined" && running) { toast("Stop the run before switching projects.", "err"); return; }
    api("/api/projects/open", { path: path }).then(switched).catch(function (e) { toast(e.message, "err"); });
  }
  function createProject() {
    toggle(false);
    modal({
      title: "New project",
      text: "A folder with Flows, TestData and Reports is created. The examples are copied in so you can try it at once.",
      fields: [
        { id: "name", label: "Project name", placeholder: "Shop App" },
        { id: "folder", label: "Create it in", value: (P.list && P.list.home) || "", hint: "Any folder on this PC. The project gets its own folder inside it." }
      ],
      ok: "Create and open",
      validate: function (v) { return /^[\p{L}\p{N} _\-.()]{1,60}$/u.test(v.name) ? "" : "Name: letters, numbers, spaces, - _ . ( )"; }
    }).then(function (v) {
      if (!v) return;
      api("/api/projects/create", { name: v.name, folder: v.folder, examples: true }).then(switched).catch(function (e) { toast(e.message, "err"); });
    });
  }
  function addExisting() {
    toggle(false);
    modal({
      title: "Add an existing project folder",
      text: "For example a folder you copied from a colleague, or an older Understudy / X-Maestro folder. Missing Flows, TestData and Reports folders are created.",
      fields: [{ id: "folder", label: "Folder", placeholder: "C:\\Users\\me\\Documents\\MyTests" }, { id: "name", label: "Name (optional)" }],
      ok: "Add and open"
    }).then(function (v) {
      if (!v || !v.folder) return;
      api("/api/projects/add", { folder: v.folder, name: v.name }).then(switched).catch(function (e) { toast(e.message, "err"); });
    });
  }
  function manage(p) {
    toggle(false);
    modal({
      title: p.name, text: p.path + "\n\nRemoving a project from the list never deletes its folder.",
      fields: [{ id: "name", label: "Name", value: p.name }, { id: "remove", label: "Type REMOVE to take it off the list", value: "" }],
      ok: "Save"
    }).then(function (v) {
      if (!v) return;
      var job = v.remove === "REMOVE" ? api("/api/projects/forget", { path: p.path }) :
                v.name && v.name !== p.name ? api("/api/projects/rename", { path: p.path, name: v.name }) : null;
      if (job) job.then(function () { toast("Saved.", "ok"); load(); }).catch(function (e) { toast(e.message, "err"); });
    });
  }

  document.addEventListener("click", function (e) {
    var box = document.querySelector(".projbox");
    if (box && !box.contains(e.target) && !$("projPop").hidden) $("projPop").hidden = true;
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("projPop").hidden) $("projPop").hidden = true; });
  load();

  return { toggle: toggle, load: load };
})();
