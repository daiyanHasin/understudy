# Architecture

Understudy (formerly X-Maestro Flow Runner) is a **local web application**: a small Node.js server with no framework, and a browser UI in plain JavaScript with no build step. It drives the **Maestro CLI** installed on the same machine.

```text
┌──────────────────────── Browser (http://understudy.localhost:4545) ───────────────────────┐
│  Run Flows │ Test Data │ Editor │ Dashboard            app.js + ui/*.js + styles.css      │
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
| `web-gui.js` | HTTP routes, static files (`/`, `/app.js`, `/ui/*.js`, `/reports/*`, `/runs/*.png`), Host check, startup data preparation |
| `lib/runner.js` | Lists flows (path, appId, tags, sheets), expands queue items into jobs, runs Maestro one job at a time, streams events, saves history |
| `lib/flow-data.js` | Scans a flow's `runScript` lines (and its `runFlow` sub-flows) to find Excel sheets; parses row selections |
| `lib/prepare.js` | Converts every sheet into a self-contained data script and a JSON copy |
| `lib/live-steps.js` | Tails `maestro.log` for `RUNNING / COMPLETED / FAILED / SKIPPED / WARNED` lines; finds failure screenshots |
| `lib/excel.js` | Reads and writes workbooks for the editor: cell edits, row/column insert and delete, new sheets and files |
| `lib/flows-io.js` | Read, save, duplicate, rename and delete flows (with backups); peeks `appId` and `tags` |
| `lib/history.js` | Appends finished runs to `History/history.json` (last 300) |
| `lib/suites.js` | Saves named suites to `Suites/suites.json` |
| `app.js` | Core UI: tabs, flow list, queue, run control, live panel, results, Excel and flow editors, event hooks |
| `ui/run-extras.js` | Tags, suites, data preview popup, "data used" panel |
| `ui/dashboard.js` | KPIs, SVG charts, flaky tests, compare two runs |

`ui/*.js` plug into `app.js` through a tiny hook list (`hooks.flowsLoaded`, `hooks.showSteps`, `hooks.runDone`, `hooks.tab`), so new features can be added without growing `app.js`.

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

- **New UI feature:** add `ui/<feature>.js`, include it in `index.html`, and register on `hooks.*`.
- **New API:** add a route in `web-gui.js` and put the logic in `lib/<feature>.js`.
- **New run behaviour:** extend `buildJobs()` / `runFlows()` in `lib/runner.js` and emit new event types.


---

## Added in Understudy 1.0

### New modules

| File | Job |
|---|---|
| `lib/security.js` | Per-start session token, HttpOnly SameSite=Strict cookie, token header + Origin check on every change, Host check (DNS rebinding), body size limits, response headers, sandboxed reports |
| `lib/android.js` | Finds the Android SDK; adb/emulator wrappers; devices, virtual devices, Wi-Fi phones, snapshots, raw frames, input, layout cache, app launch. Uses `execFile` with argument arrays (no shell); every device-side argument is single-quoted |
| `lib/recorder.js` | Picks the element under a tap, builds selector candidates, generates Maestro YAML, saves the flow and writes data-driven values into Excel |
| `lib/capture.js` | "From device" mode: reads touches with `getevent`, keeps only touches in the app, reads typed text back from the layout |
| `lib/doctor.js` | Setup checklist (Node, Java, Maestro, SDK, adb, emulator, acceleration, virtual devices) |
| `lib/app-window.js` | Opens the UI in an Edge/Chrome app window |
| `ui/secure-fetch.js` | Adds the session token to every state-changing request; shows a reload banner if the server restarted |
| `ui/setup.js` | Record/Setup tab switching (without changing `app.js`), Setup checklist, Quit |
| `ui/recorder.js` | Record tab: device stage, recording modes, value dialog (fixed text or test data), steps, YAML preview, save |
| `Understudy.vbs` | Windows launcher with no console window; first-run install; optional desktop shortcut |

### Request rules

- `GET /`, `/styles.css`, `/app.js`, `/ui/*.js`, `/assets/*`, `/manifest.webmanifest` are public (no data).
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
