/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * HTTP routes - Projects: the open project and the project list (install once, many projects).
 * Routes only read the request, call the feature module and answer.
 * The logic lives in the modules required below.
 */
const security = require("../core/security");
const state = require("../core/state");
const capture = require("../record/capture");
const P = require("../core/paths");
const projects = require("../projects/projects");
const prepare = require("../data/prepare");

module.exports = function register(r, ctx) {
  const { GET, POST, json } = r;

  /* Project */
  GET("/api/project", (req, res) => {
    res.writeHead(200, security.headers.api("text/plain; charset=utf-8"));
    res.end(P.root);
  });
  /* Projects: install once, many projects */
  GET("/api/projects", (req, res) => json(res, 200, projects.list()));
  function projectChange(fn) {
    return async (req, res) => {
      if (state.busy) return json(res, 409, { error: "A run is in progress. Stop it before switching projects." });
      const b = await security.readJson(req);
      const before = P.root;
      const r = await fn(b);
      if (P.root !== before) {
        capture.stopAll();
        try { prepare.prepareData(() => {}); } catch (_) {}
      }
      json(res, 200, Object.assign({ ok: true, root: P.root }, r && typeof r === "object" ? { project: r } : {}));
    };
  }
  POST("/api/projects/open",   projectChange(b => projects.open(b.path)));
  POST("/api/projects/create", projectChange(b => projects.create(b.name, b.folder, b.examples !== false)));
  POST("/api/projects/add",    projectChange(b => projects.addExisting(b.folder, b.name)));
  POST("/api/projects/rename", projectChange(b => projects.rename(b.path, b.name)));
  POST("/api/projects/forget", projectChange(b => projects.forget(b.path)));
};
