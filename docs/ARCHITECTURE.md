# Architecture

Understudy (formerly X-Maestro Flow Runner) is a **local web application**: a small Node.js server with no framework, and a browser UI in plain JavaScript with no build step. It drives the **Maestro CLI** installed on the same machine.

```text
┌──────────────────────── Browser (http://understudy.localhost:4545) ───────────────────────┐
│  Run Flows │ Test Data │ Editor │ Dashboard            app/ + src/*/*.ui.js      │
└───────────────▲──────────────────────────────┬────────────────────────────────────────────┘
       live events (SSE /api/stream)           │ REST (fetch /api/...)
┌───────────────┴──────────────────────────────▼───────────── Node.js (web-gui.js) ─────────┐
│ runner.js ── builds jobs, runs `maestro test`, emits events ──► history.js (History/)       │
│   ├─ flow-data.js   which Excel sheets a flow uses, row selections                          │
│   └─ live-steps.js  tails .runs/**/maestro.log → step events, finds failure screenshots     │
│ prepare.js   TestData/*.xlsx → Scripts/<Excel>/<Sheet>.js (+ JsonData/ for previews)        │
│ excel.js     Excel editor (ExcelJS; SheetJS fallback)     flows-io.js  flow files, tags      │
│ suites.js    Suites/suites.json                           state.js     busy / current child  │
└──────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                       │ child process
                               ┌───────▼───────┐        ┌──────────────────────────┐
                               │  Maestro CLI  │ ─────► │ Android device/emulator  │
                               └───────┬───────┘        └──────────────────────────┘
                     writes: Reports/*.html, .runs/**/maestro.log, failure screenshots
```

## Design principles

- **Zero build, few dependencies.** Plain Node `http`, vanilla JS, SVG charts. The only npm packages are for Excel (`xlsx`, `exceljs`).
- **Files are the database.** Flows, Excel, suites and history are ordinary files in the project folder, easy to back up, diff and share.
- **Never lose user work.** Every save of a flow or workbook makes a backup first; history is written with write-then-rename.
- **Local only.** The server binds to `127.0.0.1` and rejects requests whose `Host` isn't `localhost`, `127.0.0.1` or the configured `*.localhost` name (protects against DNS-rebinding).
- **Maestro stays untouched.** Everything goes through the public CLI (`maestro test`) and the files it writes.

## Modules

| File | Responsibility |
|---|---|
| `web-gui.js` | HTTP routes, static files (`/`, `/app.js`, `/src/*/*.ui.js`, `/reports/*`, `/runs/*.png`), Host check, startup data preparation |
| `src/run/runner.js` | Lists flows (path, appId, tags, sheets), expands queue items into jobs, runs Maestro one job at a time, streams events, saves history |
| `src/run/flow-data.js` | Scans a flow's `runScript` lines (and its `runFlow` sub-flows) to find Excel sheets; parses row selections |
| `src/data/prepare.js` | Converts every sheet into a self-contained data script and a JSON copy |
| `src/run/live-steps.js` | Tails `maestro.log` for `RUNNING / COMPLETED / FAILED / SKIPPED / WARNED` lines; finds failure screenshots |
| `src/data/excel.js` | Reads and writes workbooks for the editor: cell edits, row/column insert and delete, new sheets and files |
| `src/data/flows-io.js` | Read, save, duplicate, rename and delete flows (with backups); peeks `appId` and `tags` |
| `src/reports/history.js` | Appends finished runs to `History/history.json` (last 300) |
| `src/run/suites.js` | Saves named suites to `Suites/suites.json` |
| `app.js` | Core UI: tabs, flow list, queue, run control, live panel, results, Excel and flow editors, event hooks |
| `src/run/run-extras.ui.js` | Tags, suites, data preview popup, "data used" panel |
| `src/reports/dashboard.ui.js` | KPIs, SVG charts, flaky tests, compare two runs |

`src/*/*.ui.js` plug into `app.js` through a tiny hook list (`hooks.flowsLoaded`, `hooks.showSteps`, `hooks.runDone`, `hooks.tab`), so new features can be added without growing `app.js`.

## Data-driven testing

### Prepare Data

For each workbook in `TestData/` (recursively) and each sheet:

1. Row 1 is read as column names; blank-named columns are dropped.
2. Every following row with at least one value becomes an object; cells are taken as displayed text (`raw: false`), empty cells as `""`.
3. Two files are written:
   - `JsonData/<Excel>/<Sheet>.json`, used for previews and row counts;
   - `Scripts/<Excel>/<Sheet>.js`, the **data provider** loaded by Maestro:

```js
var data = [ { "email": "alice@example.com", "password": "Secret1" }, ... ];
var ROW_PICK = typeof ROW_LoginData_Valid != 'undefined' ? ROW_LoginData_Valid
             : (typeof ROW_NO != 'undefined' ? ROW_NO : 1);
var index = parseInt(ROW_PICK, 10) - 1;
var row = data[index];
if (!row) throw new Error('Row ' + (index + 1) + ' not found in Valid (' + data.length + ' rows)');
Object.keys(row).forEach(function (key) { output[key] = row[key]; });
```

Data is embedded, so no server is needed while tests run. Generated scripts carry a marker line; scripts for deleted sheets are removed, and hand-written scripts are never touched.

### Row variables

Every sheet has its own variable, `ROW_<Excel>_<Sheet>`. When a job runs row *N* of a flow, the runner passes `-e ROW_<Excel>_<Sheet>=N` for each sheet **the flow itself** loads. Sheets loaded by sub-flows receive nothing and fall back to row 1. `ROW_NO` remains as a global fallback for command-line use.

### Jobs

```text
queue item  { flow: "login.yaml", rows: "2,5-6" }
      │  flow-data.flowSheets() → direct sheet LoginData/Valid (6 rows)
      │  parseRows("2,5-6", 6)  → [2, 5, 6]     (errors stop the run before it starts)
      ▼
jobs  login.yaml#2   env { ROW_LoginData_Valid: 2 }   report Reports/login__row2.html
      login.yaml#5   env { ROW_LoginData_Valid: 5 }   report Reports/login__row5.html
      login.yaml#6   env { ROW_LoginData_Valid: 6 }   report Reports/login__row6.html
```

## Running a job

```text
maestro test "Flows/<flow>" --format html-detailed --output "Reports/<name>.html"
             --debug-output ".runs/<job-id>" -e ROW_<Excel>_<Sheet>=<N>
```

- With `--format`, Maestro runs in *suite mode* and prints little per step. It still writes one line per command to `maestro.log` in the debug folder. `live-steps.js` polls that file every 400 ms and turns lines into `step` events (log timestamps give accurate durations).
- When the process exits, the runner records exit code, duration, the innermost failed step, the report path and a failure screenshot (if Maestro saved one).
- `.runs/` is cleared at the start of each run.

## Live events (Server-Sent Events)

`GET /api/stream` sends JSON messages:

| `type` | Fields | Meaning |
|---|---|---|
| `log` | `text` | Console output (ANSI codes stripped) |
| `queue` | `jobs[{id,label,flow,row}]` | Run starting; the full job list |
| `start` | `id,label,index,total` | A job started |
| `step` | `id,desc,status,ts` | A Maestro command changed state |
| `result` | `id,flow,row,ok,duration,failedStep,report,screenshot` | A job finished |
| `skipped` | `id` | Job skipped (stopped / stop-on-fail) |
| `done` | `passed,failed,skipped,results[]` | Run finished |

## REST API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/flows` | Flows with `appId`, `tags`, `sheets` |
| POST | `/api/setup` | Prepare Data |
| POST | `/api/run` | `{ items:[{flow,rows}], stopOnFail, suite }` |
| POST | `/api/stop` | Stop the current run |
| GET | `/api/reports` | Report file names |
| GET | `/api/data?excel=&sheet=` | Prepared rows of one sheet |
| GET | `/api/history` | Run history |
| GET/POST | `/api/suites`, `/api/suites/save`, `/api/suites/delete` | Test suites |
| GET/POST | `/api/flow/read`, `save`, `duplicate`, `rename`, `delete` | Flow files |
| GET/POST | `/api/excel/files`, `read`, `save`, `newfile`, `newsheet` | Excel editor |
| POST | `/api/open-folder` | Open Reports / TestData / backups in Explorer |

All file paths are resolved and checked to stay inside `Flows/`, `TestData/`, `Reports/` or `.runs/`.

## Stored files

| File | Shape |
|---|---|
| `History/history.json` | `[{ id, started, finished, suite, passed, failed, skipped, jobs:[{ id, flow, row, label, status, duration, failedStep, report }] }]` |
| `Suites/suites.json` | `[{ name, items:[{ flow, rows }], stopOnFail, updated }]` |

## Extending

- **New UI feature:** add `src/<feature>/<feature>.ui.js`, include it in `app/index.html`, and register on `hooks.*`.
- **New API:** add a route in `web-gui.js` and put the logic in `src/<feature>/<feature>.js`.
- **New run behaviour:** extend `buildJobs()` / `runFlows()` in `src/run/runner.js` and emit new event types.


---

## Added in Understudy 1.0

### New modules

| File | Job |
|---|---|
| `src/core/security.js` | Per-start session token, HttpOnly SameSite=Strict cookie, token header + Origin check on every change, Host check (DNS rebinding), body size limits, response headers, sandboxed reports |
| `src/device/android.js` | Finds the Android SDK; adb/emulator wrappers; devices, virtual devices, Wi-Fi phones, snapshots, raw frames, input, layout cache, app launch. Uses `execFile` with argument arrays (no shell); every device-side argument is single-quoted |
| `src/record/recorder.js` | Picks the element under a tap, builds selector candidates, generates Maestro YAML, saves the flow and writes data-driven values into Excel |
| `src/record/capture.js` | "From device" mode: reads touches with `getevent`, keeps only touches in the app, reads typed text back from the layout |
| `src/setup/doctor.js` | Setup checklist (Node, Java, Maestro, SDK, adb, emulator, acceleration, virtual devices) |
| `src/core/app-window.js` | Opens the UI in an Edge/Chrome app window |
| `src/core/secure-fetch.ui.js` | Adds the session token to every state-changing request; shows a reload banner if the server restarted |
| `src/setup/setup.ui.js` | Record/Setup tab switching (without changing `app.js`), Setup checklist, Quit |
| `src/record/recorder.ui.js` | Record tab: device stage, recording modes, value dialog (fixed text or test data), steps, YAML preview, save |
| `Understudy.vbs` | Windows launcher with no console window; first-run install; optional desktop shortcut |

### Request rules

- `GET /`, `/styles.css`, `/app.js`, `/src/*/*.ui.js`, `/assets/*`, `/manifest.webmanifest` are public (no data).
- Everything under `/api/`, `/reports/*.html` and `/runs/` needs the session cookie.
- Every non-GET request also needs the `X-Understudy-Token` header and, if an `Origin` header is present, one of our own origins.
- Report assets (images inside a report) are served without the cookie because the sandboxed report frame has none.

### Recorder endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/doctor` | Setup checks |
| `POST /api/setup/android` | Opens `tools/install-android.ps1` in a PowerShell window |
| `GET /api/device/list` | Devices, virtual devices, and errors of virtual devices that closed while starting |
| `POST /api/device/start` / `stop` | Start a virtual device (window, graphics) / stop it or disconnect a Wi-Fi phone |
| `POST /api/device/connect` | Pair (optional) and connect a phone over Wi-Fi |
| `POST /api/device/snapshot` | Save or load the `understudy_clean` snapshot |
| `GET /api/device/frame?serial=&prefetch=1` | Raw RGBA frame (sizes in `X-Frame-*` / `X-Device-*` headers); reads the layout in the background when the screen is still |
| `POST /api/device/input` | tap, longPress, swipe, key, text, hideKeyboard, erase |
| `GET /api/device/packages?serial=` | Installed apps |
| `GET /api/apk/list`, `POST /api/apk/upload?name=`, `POST /api/apk/install`, `POST /api/apk/delete` | APKs in the local `Apps/` folder (checked, size-limited, never uploaded) |
| `POST /api/app/launch` | Launch an app (optionally with fresh data) |
| `POST /api/rec/inspect` | Element under a point + targets (uses the cached layout when the screen hasn't changed) |
| `POST /api/rec/preview` / `parse` | Steps → YAML / YAML → steps |
| `GET /api/rec/datafiles`, `GET /api/rec/sheets?file=` | Test data files, their sheets and columns |
| `POST /api/rec/save` | Write test data, then the flow, then regenerate data scripts |
| `POST /api/capture/start` / `stop`, `GET /api/capture/poll` | "From device" mode (getevent) |
| `POST /api/shutdown` | Quit |

## Added in Understudy 1.2

### Paths and projects
`src/core/paths.js` is the only place that knows where project folders are. Every
module asks it (`P.flows`, `P.reports`, ...) on each use, so the open project
can change at run time. `src/projects/projects.js` keeps the project list in
`%APPDATA%\Understudy\projects.json` (or `~/.understudy`). The install folder is
registered as "Default project" on first start. `--project <folder>` or
`UNDERSTUDY_PROJECT` opens a specific one.

### Device core
```
 window (src/record/recorder.ui.js)            PC (src/device/android.js)                 device
 canvas <- RGBA frame <- /api/device/frame  <-  gunzip + shrink to 540 px wide  <-  screencap | gzip -1
 click  -> /api/rec/inspect -> element menu  ->  /api/device/input  ->  adb input tap / text / swipe
```
- Frames are fetched one after another (no fixed interval). Phones without
  `gzip` fall back to raw `screencap` automatically, once per device.
- Screen changes: frame hashes that ignore the status bar and A-B-A-B cursor
  blinking bump a per-device counter (`seq`). A layout is cached with the `seq`
  it was read at; `/api/rec/inspect` accepts the `seq` the user was looking at.
- A click in Record mode taps nothing: it opens the element menu, and the chosen
  action is both recorded and sent to the device.
- `uiautomator` calls are queued per device (`withUiLock`). A blocked read
  ("Killed", "could not get idle state" ...) force-stops known holders
  (Maestro and Appium drivers) when no run is active, then retries once.
- Layout dumps use `--windows` where supported; nodes carry their window and
  layer, and `recorder.nodesAt` keeps only the top window under a point.
- Non-English text is typed through the ADB Keyboard app when it is installed.

### Run from a step
`src/run/partial.js` writes `.us-from-<n>-<flow>.yaml` next to the flow: the
header, every `runScript` / `evalScript` (and other setup commands) before
step n, then step n onwards. Dot-files are never listed as flows; the copy is
deleted when the run ends.

### Reports
The runner keeps each job's steps (from `maestro.log`), copies failure
screenshots to `Reports/_shots/<run>/`, stores both in History (steps only
for the newest 40 runs) and writes `Reports/Understudy-Run-<date>.html`
(`src/reports/report.js`, self-contained). The Reports tab reads
`/api/history/run?id=`.

### New endpoints
| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/projects` | project list |
| POST | `/api/projects/open\|create\|add\|rename\|forget` | manage projects (blocked during runs) |
| GET  | `/api/device/layout?serial=` | every element on screen (hover inspector) |
| GET  | `/api/device/apps?serial=` | launchable + user apps |
| POST | `/api/device/wifi` | USB phone -> Wi-Fi |
| POST | `/api/device/openlink` | open a URL on the device |
| GET/POST | `/api/system/processes`, `/api/system/free` | emulator / adb / Studio memory |
| GET  | `/api/flow/commands?path=` | top-level steps (run-from-step picker) |
| GET  | `/api/history/run?id=` | one run with steps |
| POST | `/api/report/write` | (re)write a run's HTML report |
| GET/POST | `/api/ai/status\|install\|pull\|remove\|enable\|generate` | optional AI helper |

## Added before the 1.2.0 release

| Module | Role |
|---|---|
| `src/device/wifi.js` | Plain-language reason a Wi-Fi phone can't be reached: TCP probe (3 s) plus a check of the PC's own networks. Used by `android.pair()`, `android.connect()`, `pairing.js` and `POST /api/device/wifi-check`. |
| `src/device/animations.js` | Phone animation scales to 0 while recording (`POST /api/device/animations`), saved first to `logs/animations-restore.json`, restored on disconnect, quit and the next start. |
| `tools/install-deps.ps1` | First-start `npm install` that works behind HTTPS inspection: builds `tools/certs/company-ca.pem`, used through `NODE_EXTRA_CA_CERTS` by npm and by Understudy. |

Selectors now follow Maestro's matching rules (`recorder.matches()`): text matches text, label or hint; the deepest match wins; `index` counts top-to-bottom, then left-to-right. Candidates: ID, text/label/placeholder, ID + text (same element), Nth match (`index`), screen position.

For "which file do I change for X", see the folder map in the [README](../README.md#where-things-live).
