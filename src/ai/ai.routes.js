/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * HTTP routes - Optional local AI helper (Ollama).
 * Routes only read the request, call the feature module and answer.
 * The logic lives in the modules required below.
 */
const security = require("../core/security");
const android = require("../device/android");
const ai = require("../ai/ai");

module.exports = function register(r, ctx) {
  const { GET, POST, json } = r;

  /* ----- Optional AI helper (Ollama, local) ----- */
  GET("/api/ai/status", async (req, res) => json(res, 200, await ai.status()));
  POST("/api/ai/install", async (req, res) => json(res, 200, ai.install()));
  POST("/api/ai/pull", async (req, res) => { const b = await security.readJson(req); json(res, 200, await ai.pull(String(b.model || ""))); });
  POST("/api/ai/remove", async (req, res) => { const b = await security.readJson(req); json(res, 200, await ai.remove(String(b.model || ""))); });
  POST("/api/ai/enable", async (req, res) => { const b = await security.readJson(req); json(res, 200, ai.setEnabled(!!b.on)); });
  POST("/api/ai/generate", async (req, res) => {
    const b = await security.readJson(req);
    const serial = String(b.serial || "");
    const devs = await android.devices().catch(() => []);
    const d = devs.find(x => x.serial === serial && x.state === "device");
    if (!d || d.emulator || d.wifi) return json(res, 400, { error: "The AI helper works with a phone connected by USB. Plug in a phone and choose it." });
    let nodes = null;
    try { nodes = (await android.layout(serial)).nodes; } catch (_) {}
    json(res, 200, await ai.generate({ yaml: String(b.yaml || "").slice(0, 40000), prompt: String(b.prompt || ""), appId: String(b.appId || ""), nodes }));
  });
};
