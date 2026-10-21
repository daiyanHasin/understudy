# Decisions (ADRs)

One short record per important choice: what we decided, why, and what we gave up. Add a new one instead of editing an old one; mark the old one "Replaced by ADR-n".

---
### ADR-001 · Local web app, no framework, no build step
**Decided:** Node `http` server + plain HTML/CSS/JS in the browser.
**Why:** nothing to compile; colleagues behind Netskope can't always run npm tools; easy to read.
**Gave up:** framework conveniences (components, reactivity). UI code is longer than with Svelte/React.
**Revisit:** when building the desktop app (after v3).

### ADR-002 · Files are the database
**Decided:** flows, Excel, suites, history are ordinary files in the project folder.
**Why:** testers can back up, diff and share them; no database to install.
**Gave up:** queries across runs are done in code (`history.js`), history capped at 300 runs.

### ADR-003 · Drive Maestro only through its public CLI
**Decided:** run `maestro test` as a child process; read its report, `maestro.log` and screenshots.
**Why:** Maestro updates don't break us as long as the CLI stays the same.
**Gave up:** fine control inside a run (live steps come from tailing a log file).

### ADR-004 · Screenshots, not live video
**Decided:** dropped scrcpy (2.0.0). Frames are `screencap`, raw or gzip, with read-ahead.
**Why:** nothing is copied to the phone; simpler; fewer failure modes.
**Gave up:** smooth video. The ceiling is how fast the phone takes a screenshot (often 3–5 fps over USB).

### ADR-005 · Keep Maestro for v3 (own engine later, maybe)
**Decided:** no own test engine before v3.
**Why:** the setup burden (Java, Maestro CLI) is real, but replacing a test engine is months of work and the main risk to stability.
**Revisit when:** the desktop installer can't bundle Java + Maestro, or Maestro blocks a needed feature.

### ADR-006 · Backend stays in Node.js
**Decided:** keep Node. Maestro's JS/YAML don't require it (Maestro runs flow JS in its own engine), but generated data scripts are JS, and the code already works.
**Gave up:** nothing material. Another language would mean a rewrite.

### ADR-007 · Desktop app after v3 by wrapping, not rewriting
**Decided:** package the existing server and window (Electron is the shortest path for a Node server; Tauri is smaller but needs the server as a sidecar).
**Why:** the same code keeps working; the installer can bundle Node and ends npm/Netskope trouble.

### ADR-008 · Routes, logic and window code in separate files (2.x)
**Decided:** `x.routes.js` (HTTP only), `x.js` (logic only), `x.ui.js` (window). Big files split by job; `android.js` and `recorder.js` stay as index files so callers don't change.
**Why:** to find "where is X" by the file name; to change one part without reading 800 lines.
**Rule:** `npm run check` must pass before every commit.

### ADR-009 · Optional AI helper, local only, USB only
**Decided:** Ollama on this PC, installed by the user from Setup; never shipped; works only with a USB phone.
**Why:** privacy (nothing leaves the PC), laptops under 16 GB can't run an emulator and a model together.
