/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Safety net: `npm run check`. Run it after every change, before every commit.
 * No phone, no Maestro, no network needed. Takes a few seconds.
 *
 *   1. Every .js file is valid JavaScript (server files and browser files)
 *   2. Every server module loads (catches a wrong require path after moving a file)
 *   3. Routes: no route is registered twice, and every /api/... address the
 *      browser calls exists on the server (catches renamed or deleted routes)
 *   4. Pure logic: screen frame decoding, layout parsing, Wi-Fi addresses,
 *      row selections, element picking
 *   5. Flows: every flow in Flows/ survives YAML -> steps -> YAML -> steps
 *      unchanged (the editor never silently changes what the tester wrote)
 *
 * Exit code 0 = all good. Any failure prints what broke and exits with 1.
 */
const fs   = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
let failed = 0, passed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; results.push("  ok    " + name); }
  catch (e) { failed++; results.push("  FAIL  " + name + "\n        " + String(e && e.message || e).split("\n").join("\n        ")); }
}
function walk(dir, out) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === "node_modules" || f.name.startsWith(".")) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = p => path.relative(ROOT, p).split(path.sep).join("/");

(async () => {
  const jsFiles = ["web-gui.js", "app/app.js"].map(f => path.join(ROOT, f))
    .concat(walk(path.join(ROOT, "src"), []).filter(f => f.endsWith(".js")))
    .concat(walk(path.join(ROOT, "tools"), []).filter(f => f.endsWith(".js")));
  const uiFiles = jsFiles.filter(f => f.endsWith(".ui.js") || rel(f) === "app/app.js");
  const serverFiles = jsFiles.filter(f => !uiFiles.includes(f) && rel(f).startsWith("src/"));

  /* 1. Syntax */
  await test("syntax of " + jsFiles.length + " JavaScript files", () => {
    const bad = [];
    for (const f of jsFiles) {
      try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
      catch (e) { bad.push(rel(f) + ": " + String(e.stderr || e.message).split("\n").slice(0, 5).join(" | ")); }
    }
    assert.deepStrictEqual(bad, []);
  });

  /* 2. Modules load */
  await test("every server module loads (" + serverFiles.length + " files)", () => {
    const bad = [];
    for (const f of serverFiles) { try { require(f); } catch (e) { bad.push(rel(f) + ": " + e.message); } }
    assert.deepStrictEqual(bad, []);
  });

  /* 3. Routes */
  let routes = [];
  await test("routes register without duplicates", () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, "web-gui.js"), "--list-routes", "--no-open"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    routes = out.split(/\r?\n/).filter(l => /^(GET|POST) \/api\//.test(l)).map(l => l.split(" ")[1]);
    assert.ok(routes.length > 50, "only " + routes.length + " routes found");
  });
  await test("every /api/... the browser calls exists on the server", () => {
    const html = fs.readFileSync(path.join(ROOT, "app", "index.html"), "utf8");
    const called = new Set();
    for (const f of uiFiles) for (const m of fs.readFileSync(f, "utf8").matchAll(/["'](\/api\/[a-z0-9/-]+)/gi)) called.add(m[1]);
    for (const m of html.matchAll(/["'](\/api\/[a-z0-9/-]+)/gi)) called.add(m[1]);
    const missing = [...called].filter(p => !routes.includes(p) && !routes.some(r => r.startsWith(p) && p.endsWith("/")));
    assert.deepStrictEqual(missing, [], "the browser calls routes the server does not have");
  });
  await test("every <script> in index.html exists and is served", () => {
    const html = fs.readFileSync(path.join(ROOT, "app", "index.html"), "utf8");
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    const bad = srcs.filter(s => {
      const file = s === "app.js" ? path.join(ROOT, "app", "app.js") : path.join(ROOT, s);
      const served = s === "app.js" || /^src\/[a-z]+\/[a-z0-9-]+\.ui\.js$/.test(s);
      return !fs.existsSync(file) || !served;
    });
    assert.deepStrictEqual(bad, [], "missing, or the name does not match what web-gui serves (src/<feature>/<name>.ui.js)");
  });

  /* 4. Pure logic */
  const screen = require("../src/device/screen");
  await test("screen frames: RGBA, BGRA and RGB565 decode and shrink to 540 px", () => {
    const make = (w, h, fmt, bpp, px) => {
      const head = Buffer.alloc(16); head.writeUInt32LE(w, 0); head.writeUInt32LE(h, 4); head.writeUInt32LE(fmt, 8);
      const body = Buffer.alloc(w * h * bpp);
      for (let i = 0; i < w * h; i++) px.copy(body, i * bpp);
      return Buffer.concat([head, body]);
    };
    let f = screen.decodeRaw(make(1080, 2400, 1, 4, Buffer.from([10, 20, 30, 255])));
    assert.deepStrictEqual([f.w, f.h, f.dw, f.dh, ...f.data.subarray(0, 4)], [540, 1200, 1080, 2400, 10, 20, 30, 255]);
    f = screen.decodeRaw(make(720, 1600, 5, 4, Buffer.from([30, 20, 10, 255])));      // BGRA
    assert.deepStrictEqual([f.w, ...f.data.subarray(0, 3)], [360, 10, 20, 30]);
    f = screen.decodeRaw(make(480, 800, 4, 2, Buffer.from([0x00, 0xf8])));           // RGB565 pure red
    assert.deepStrictEqual([f.w, ...f.data.subarray(0, 3)], [480, 248, 0, 0]);
    assert.throws(() => screen.decodeRaw(Buffer.alloc(4)), /No screen image/);
  });
  const android = require("../src/device/android");
  await test("screen layout XML parses (windows, nesting, entities)", () => {
    const xml = '<?xml version="1.0"?><hierarchy><window layer="2" type="TYPE_APPLICATION"><node text="A &amp; B" resource-id="x:id/a" class="android.widget.EditText" clickable="true" bounds="[0,0][100,50]"><node text="child" bounds="[10,10][20,20]" /></node></window></hierarchy>';
    const n = android.parseHierarchy(xml);
    assert.strictEqual(n.length, 2);
    assert.strictEqual(n[0].text, "A & B");
    assert.strictEqual(n[0].editable, true);
    assert.strictEqual(n[1].parent, 0);
    assert.strictEqual(n[1].layer, 2);
  });
  await test("Wi-Fi addresses", () => {
    assert.strictEqual(android.normAddr(" 192.168.0.12 "), "192.168.0.12:5555");
    assert.strictEqual(android.normAddr("192.168.0.12:37123/"), "192.168.0.12:37123");
    const ip = "1: lo: <LOOPBACK>\n    inet 127.0.0.1/8\n5: rmnet0: <UP>\n    inet 10.1.2.3/30\n30: wlan0: <UP>\n    inet 192.168.1.44/24\n";
    assert.strictEqual(android.phoneWifiIp(ip), "192.168.1.44");
  });
  await test("row selections (2,5-6 / all / errors)", () => {
    const { parseRows } = require("../src/run/flow-data");
    assert.deepStrictEqual(parseRows("2,5-6", 6), [2, 5, 6]);
    assert.deepStrictEqual(parseRows("", 6), [1]);
    assert.deepStrictEqual(parseRows("all", 3), [1, 2, 3]);
    assert.throws(() => parseRows("9", 6), /does not exist/);
    assert.throws(() => parseRows("x", 6), /not a row number/);
  });
  const recorder = require("../src/record/recorder");
  await test("element picking prefers the ID and follows Maestro's text rules", () => {
    const N = (o) => Object.assign({ text: "", id: "", desc: "", hint: "", cls: "android.view.View", pkg: "a.b", clickable: false, win: 1, layer: 0, wtype: "" }, o);
    const nodes = [
      N({ i: 0, parent: -1, x1: 0, y1: 0, x2: 1080, y2: 2400 }),
      N({ i: 1, parent: 0, text: "Log in", id: "a.b:id/login", cls: "android.widget.Button", clickable: true, x1: 100, y1: 1000, x2: 980, y2: 1150 }),
      N({ i: 2, parent: 0, text: "Log in", x1: 100, y1: 1300, x2: 980, y2: 1400 })];
    const r = recorder.inspect(nodes, 500, 1050);
    assert.ok(r && Array.isArray(r.candidates) && r.candidates.length, "no selector choices");
    assert.strictEqual(r.candidates[0].kind, "id");
    assert.strictEqual(recorder.matches(nodes, { kind: "text", value: "Log in", exact: true }).length, 2);
  });
  await test("text field without placeholder: found next to its label (below \u201CPassword\u201D), as Maestro picks it", async () => {
    const N = (o) => Object.assign({ text: "", id: "", desc: "", hint: "", cls: "android.view.View", pkg: "a.b", clickable: false, win: 1, layer: 0, wtype: "" }, o);
    const nodes = [
      N({ i: 0, parent: -1, x1: 0, y1: 0, x2: 1080, y2: 2400 }),
      N({ i: 1, parent: 0, text: "Email", cls: "android.widget.TextView", x1: 40, y1: 400, x2: 300, y2: 460 }),
      N({ i: 2, parent: 0, cls: "android.widget.EditText", editable: true, clickable: true, x1: 40, y1: 470, x2: 1040, y2: 600 }),
      N({ i: 3, parent: 0, text: "Password", cls: "android.widget.TextView", x1: 40, y1: 650, x2: 300, y2: 710 }),
      N({ i: 4, parent: 0, cls: "android.widget.EditText", editable: true, clickable: true, password: true, x1: 40, y1: 720, x2: 1040, y2: 850 }),
      N({ i: 5, parent: 0, text: "Sign in", cls: "android.widget.Button", clickable: true, x1: 40, y1: 950, x2: 1040, y2: 1080 })];
    const sel = require("../src/record/selectors");
    const r = recorder.inspect(nodes, 500, 780);
    const c = r.candidates[0];
    assert.ok(c.rel && c.rel.dir === "below" && c.rel.value === "Password", "expected below Password, got " + JSON.stringify(c));
    assert.strictEqual(sel.maestroFind(nodes, c)[0].i, 4, "Maestro would pick another element");
    const y = recorder.buildYaml({ appId: "a.b", flow: "t.yaml", steps: [{ type: "tap", sel: c }] }).yaml;
    assert.ok(/- tapOn:\s*\n\s+below: "Password"/.test(y), "YAML:\n" + y);
    const back = await recorder.parseYaml(y, []);
    assert.strictEqual(back.steps[0].sel.kind, "rel");
    assert.strictEqual(recorder.buildYaml(Object.assign({ flow: "t.yaml" }, back)).yaml, y, "changed after a round trip");
  });
  await test("the app open on the phone is found from the layout (not the home screen, keyboard or status bar)", () => {
    const apps = require("../src/device/apps");
    const N = (o) => Object.assign({ x1: 0, y1: 0, x2: 1080, y2: 2400, layer: 0, wtype: "" }, o);
    const nodes = [
      N({ pkg: "com.android.systemui", win: 1, layer: 3, wtype: "TYPE_SYSTEM", y2: 80 }),
      N({ pkg: "com.google.android.inputmethod.latin", win: 2, layer: 2, wtype: "TYPE_INPUT_METHOD", y1: 1500 }),
      N({ pkg: "com.shop.app", win: 3, layer: 1, wtype: "TYPE_APPLICATION" }),
      N({ pkg: "com.sec.android.app.launcher", win: 4, layer: 0, wtype: "TYPE_APPLICATION" })];
    assert.strictEqual(apps.appFromNodes(nodes, "com.sec.android.app.launcher"), "com.shop.app");
    assert.strictEqual(apps.appFromNodes(nodes.filter(n => n.pkg !== "com.shop.app"), "com.sec.android.app.launcher"), "");
  });
  await test("live video: picture size and changed-picture counting", () => {
    const stream = require("../src/device/stream");
    assert.deepStrictEqual(stream.videoSize(1080, 2400), { w: 720, h: 1600 });
    assert.deepStrictEqual(stream.videoSize(2400, 1080), { w: 1600, h: 720 });
    const c = stream.sliceCounter();
    // SPS (7), IDR slice (5, not counted), then a 10-byte P slice (1) split over two chunks
    c.feed(Buffer.from([0, 0, 0, 1, 0x67, 9, 9, 0, 0, 1, 0x65, 8, 8, 8, 0, 0, 1, 0x41, 1, 2, 3]));
    c.feed(Buffer.from([4, 5, 6, 7, 8, 9, 10]));
    assert.strictEqual(c.take(), 10);
  });
  await test("YAML editor keeps steps it understands and unknown commands word for word", async () => {
    const y = "appId: a.b\n---\n- launchApp\n- tapOn: \"Hi\"\n- someFutureCommand:\n    foo: bar\n";
    const r = await recorder.parseYaml(y, []);
    assert.deepStrictEqual(r.steps.map(s => s.type), ["launch", "tap", "raw"]);
    const back = recorder.buildYaml(Object.assign({ flow: "t.yaml" }, r)).yaml;
    assert.ok(/someFutureCommand:\s*\n\s+foo: bar/.test(back), "unknown command changed:\n" + back);
  });

  /* 5. Every flow round-trips */
  const flowsDir = path.join(ROOT, "Flows");
  const flows = fs.existsSync(flowsDir) ? walk(flowsDir, []).filter(f => /\.ya?ml$/i.test(f) && !path.basename(f).startsWith(".")) : [];
  for (const f of flows) {
    await test("flow round-trip: " + rel(f), async () => {
      const a = await recorder.parseYaml(fs.readFileSync(f, "utf8"), []);
      const yaml = recorder.buildYaml(Object.assign({ flow: path.relative(flowsDir, f) }, a)).yaml;
      const b = await recorder.parseYaml(yaml, a.steps);
      assert.deepStrictEqual(b.steps, a.steps, "steps changed after saving once");
    });
  }

  console.log("\nUnderstudy check\n" + results.join("\n"));
  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed ? 1 : 0);
})();
