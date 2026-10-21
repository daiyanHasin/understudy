/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * HTTP routes - Recorder: element under a tap, steps <-> YAML, save; capture taps made on the phone.
 * Routes only read the request, call the feature module and answer.
 * The logic lives in the modules required below.
 */
const security = require("../core/security");
const state = require("../core/state");
const android = require("../device/android");
const recorder = require("../record/recorder");
const capture = require("../record/capture");

module.exports = function register(r, ctx) {
  const { GET, POST, json, deviceFree } = r;

  /* ----- Recorder ----- */
  POST("/api/rec/inspect", async (req, res) => {
    deviceFree();
    const b = await security.readJson(req);
    const t0 = Date.now();
    let l;
    try { l = await android.layout(b.serial, b.seq); }
    catch (e) {
      // The layout can't be read (moving screen, slow phone): still record the step with
      // the screen position and say why, instead of losing the tap.
      if (/busy|Killed/.test(e.message)) throw e;
      const size = android.screenInfo(String(b.serial)).size || await android.screenSize(String(b.serial)).catch(() => null);
      if (!size) throw e;
      const r = recorder.pointOnly(Number(b.x), Number(b.y), size, e.message);
      r.ms = Date.now() - t0;
      return json(res, 200, r);
    }
    const r = recorder.inspect(l.nodes, Number(b.x), Number(b.y));
    r.cached = l.cached; r.ms = Date.now() - t0;
    json(res, 200, r);
  });
  POST("/api/rec/preview", async (req, res) => {
    const b = await security.readJson(req);
    try { json(res, 200, { yaml: recorder.buildYaml(b).yaml }); }
    catch (e) { json(res, 200, { yaml: "", problem: e.message }); }
  });
  POST("/api/rec/parse", async (req, res) => {
    const b = await security.readJson(req);
    json(res, 200, await recorder.parseYaml(String(b.yaml || ""), Array.isArray(b.steps) ? b.steps : []));
  });
  GET("/api/rec/datafiles", (req, res) => json(res, 200, { files: recorder.dataFiles() }));
  GET("/api/rec/sheets", async (req, res, u) => json(res, 200, { sheets: await recorder.sheets(u.searchParams.get("file")) }));
  POST("/api/rec/save", async (req, res) => {
    if (state.busy) return json(res, 409, { error: "Another task is running. Wait for it to finish." });
    const b = await security.readJson(req);
    state.busy = true;
    try { json(res, 200, await recorder.save(b.recording, { overwrite: !!b.overwrite })); }
    catch (e) { json(res, e.code === "EXISTS" ? 409 : 400, { error: e.message, code: e.code }); }
    finally { state.busy = false; }
  });
  /* ----- Capture taps made on the device itself ----- */
  POST("/api/capture/start", async (req, res) => {
    deviceFree();
    const b = await security.readJson(req);
    json(res, 200, await capture.start(String(b.serial || ""), String(b.appId || ""), { follow: !!b.follow }));
  });
  POST("/api/capture/stop", async (req, res) => {
    const b = await security.readJson(req);
    json(res, 200, capture.stop(String(b.serial || "")));
  });
  GET("/api/capture/poll", (req, res, u) => json(res, 200, capture.poll(String(u.searchParams.get("serial") || ""))));
};
