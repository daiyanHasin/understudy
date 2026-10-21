/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
 * Optional AI helper: writes or changes a Maestro flow from a sentence.
 *
 *   - Nothing AI ships with Understudy. The helper uses Ollama, a free local
 *     model runner, only if the user installs it from Setup (a few clicks).
 *     Without it Understudy works exactly the same.
 *   - The model runs on this PC (default: qwen2.5-coder 1.5B, about 1 GB).
 *     Prompts, flows and screens never leave the machine.
 *   - It works only with a phone connected by USB: it reads the real screen
 *     elements so the steps it writes target things that exist. (Virtual
 *     devices plus a model at the same time are too heavy for most laptops.)
 *   - The answer is checked as YAML before it is shown; the user decides
 *     whether to apply it.
 */

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { execFile } = require("child_process");
const projects = require("../projects/projects");

const HOST = "http://127.0.0.1:11434";
const MODELS = [
  { id: "qwen2.5-coder:1.5b", label: "Small and fast (about 1 GB, 4 GB RAM)", size: "1.0 GB" },
  { id: "qwen2.5-coder:3b",   label: "Better answers (about 2 GB, 8 GB RAM)", size: "1.9 GB" }
];
const SETTINGS = path.join(projects.CONFIG_DIR, "ai.json");
let YAML = null;
try { YAML = require("yaml"); } catch (_) {}

let pullState = null;     // { model, status, completed, total, error, done }

function settings() {
  try { return Object.assign({ enabled: false, model: MODELS[0].id }, JSON.parse(fs.readFileSync(SETTINGS, "utf8"))); }
  catch (_) { return { enabled: false, model: MODELS[0].id }; }
}
function saveSettings(s) {
  fs.mkdirSync(projects.CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
}

async function call(p, body, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 4000);
  try {
    const r = await fetch(HOST + p, body ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, signal: ctl.signal }
                                         : { signal: ctl.signal });
    if (!r.ok) throw new Error("Ollama answered " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function ollamaExe() {
  const c = [];
  if (process.env.LOCALAPPDATA) c.push(path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"));
  c.push("/usr/local/bin/ollama", "/usr/bin/ollama", "/opt/homebrew/bin/ollama");
  return c.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } }) || null;
}

async function status() {
  const s = settings();
  let running = false, models = [];
  try { const d = await call("/api/tags", null, 1500); running = true; models = (d.models || []).map(m => m.name); } catch (_) {}
  return {
    enabled: s.enabled, model: s.model, installed: running || !!ollamaExe(), running,
    hasModel: models.some(m => m === s.model || m.startsWith(s.model + ":") ), models, choices: MODELS,
    pull: pullState
  };
}

/** Opens the official installer (winget on Windows, the download page elsewhere). */
function install() {
  if (process.platform === "win32") {
    execFile("cmd.exe", ["/c", "start", "Understudy - install Ollama", "cmd", "/k",
      "winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements && echo. && echo Done. You can close this window."],
      { windowsHide: false }, () => {});
    return { ok: true, how: "winget" };
  }
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(opener, ["https://ollama.com/download"], () => {});
  return { ok: true, how: "browser" };
}

/** Start the Ollama app if it is installed but not running. */
function startOllama() {
  const exe = ollamaExe();
  if (!exe) return false;
  try {
    require("child_process").spawn(exe, ["serve"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return true;
  } catch (_) { return false; }
}

async function pull(model) {
  if (!MODELS.some(m => m.id === model)) throw new Error("Unknown model");
  if (pullState && !pullState.done) return pullState;
  pullState = { model, status: "starting", completed: 0, total: 0, error: "", done: false };
  (async () => {
    try {
      try { await call("/api/tags", null, 1500); } catch (_) { startOllama(); await new Promise(r => setTimeout(r, 2500)); }
      const r = await fetch(HOST + "/api/pull", { method: "POST", body: JSON.stringify({ name: model, stream: true }), headers: { "Content-Type": "application/json" } });
      if (!r.ok || !r.body) throw new Error("Ollama is not running. Start it from the Start menu, then try again.");
      const dec = new TextDecoder(); let rest = "";
      for await (const chunk of r.body) {
        rest += dec.decode(chunk, { stream: true });
        const lines = rest.split("\n"); rest = lines.pop();
        for (const l of lines) {
          if (!l.trim()) continue;
          const j = JSON.parse(l);
          if (j.error) throw new Error(j.error);
          pullState.status = j.status || pullState.status;
          if (j.total) { pullState.total = j.total; pullState.completed = j.completed || 0; }
        }
      }
      const s = settings(); s.model = model; s.enabled = true; saveSettings(s);
      pullState.status = "ready";
    } catch (e) { pullState.error = e.message; }
    pullState.done = true;
  })();
  return pullState;
}

async function remove(model) {
  await fetch(HOST + "/api/delete", { method: "DELETE", body: JSON.stringify({ name: model }), headers: { "Content-Type": "application/json" } }).catch(() => {});
  const s = settings(); s.enabled = false; saveSettings(s);
  return { ok: true };
}

function setEnabled(on) { const s = settings(); s.enabled = !!on; saveSettings(s); return s; }

const SYSTEM = `You write Maestro mobile test flows (YAML) for Android.
Answer with ONLY the complete flow YAML, no explanations, no markdown fences.
Format: a header (appId: ..., optional name, tags, env) then a line with three dashes, then a list of commands.
Commands you may use:
- launchApp (or launchApp: {appId: x, clearState: true})
- tapOn: {text: "Login"} or tapOn: {id: "com.app:id/login"} or tapOn: {point: "50%,80%"}
- longPressOn / doubleTapOn (same targets)
- inputText: "hello"   (types into the focused field; tap the field first)
- eraseText: 20
- assertVisible: {text: "Welcome"} / assertNotVisible: {...}
- scrollUntilVisible: {element: {text: "Item"}, direction: DOWN}
- swipe: {start: "50%,80%", end: "50%,20%"} ; scroll ; back ; hideKeyboard ; pressKey: Enter
- extendedWaitUntil: {visible: {text: "Done"}, timeout: 10000}
- waitForAnimationToEnd
- copyTextFrom: {id: "..."} then evalScript: \${output.Code = maestro.copiedText}
- evalScript: \${output.Name = "value"} ; inputText: \${output.Name}
- runFlow: {when: {visible: {text: "Allow"}}, commands: [ ... ]}
- runFlow: {when: {true: \${output.Role == 'admin'}}, commands: [ ... ]}
- repeat: {times: 3, commands: [ ... ]}
- openLink: https://example.com ; launchApp: {appId: com.android.chrome}
- takeScreenshot: name
Rules: keep every existing data line like runScript: "../Scripts/..." and every \${output.X} the user already has.
Prefer ids and visible texts that appear in the SCREEN ELEMENTS list. Keep steps the user did not ask to change.`;

function describeScreen(nodes) {
  if (!Array.isArray(nodes)) return "(no screen available)";
  const lines = [];
  for (const n of nodes) {
    if (!(n.clickable || n.editable || n.text || n.desc)) continue;
    const bits = [];
    if (n.id) bits.push("id=" + n.id);
    if (n.text) bits.push("text=\"" + n.text.slice(0, 60) + "\"");
    if (n.desc) bits.push("label=\"" + n.desc.slice(0, 60) + "\"");
    if (n.hint) bits.push("hint=\"" + n.hint.slice(0, 40) + "\"");
    bits.push(n.editable ? "input field" : n.clickable ? "button" : "text");
    lines.push("- " + bits.join(" "));
    if (lines.length >= 80) break;
  }
  return lines.join("\n") || "(nothing readable on screen)";
}

function cleanAnswer(t) {
  t = String(t || "").trim();
  const fence = t.match(/```(?:ya?ml)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return t + "\n";
}

async function generate(opts) {
  const s = settings();
  if (!s.enabled) throw new Error("Turn on the AI helper in Setup first");
  const user = "CURRENT FLOW:\n" + (opts.yaml && opts.yaml.trim() ? opts.yaml : "(empty: write a new flow for appId " + (opts.appId || "com.example.app") + ")") +
               "\n\nSCREEN ELEMENTS (what is on the phone now):\n" + describeScreen(opts.nodes) +
               "\n\nREQUEST:\n" + String(opts.prompt || "").slice(0, 1500);
  let d;
  try {
    d = await call("/api/chat", { model: s.model, stream: false, options: { temperature: 0.1, num_ctx: 8192 },
                                  messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }, 180000);
  } catch (e) {
    throw new Error(/abort/i.test(e.message) ? "The model took too long. Try a shorter request." : "The AI helper is not running. Start Ollama, or check Setup.");
  }
  const yaml = cleanAnswer(d && d.message && d.message.content);
  let problem = "";
  if (YAML) {
    const docs = YAML.parseAllDocuments(yaml);
    const err = docs.find(x => x.errors && x.errors.length);
    if (err) problem = "The answer is not valid YAML: " + err.errors[0].message.split("\n")[0];
    else if (docs.length < 2 || !/appId\s*:/.test(yaml)) problem = "The answer is missing the appId header or the --- line.";
  }
  return { yaml, problem, model: s.model };
}

module.exports = { status, install, pull, remove, setEnabled, generate, MODELS };
