# Architecture

How Understudy fits together **today**. Version history lives in `CHANGELOG.md`; the reasons behind big choices live in `DECISIONS.md`; every file is listed in `FILE-MAP.md`.

Understudy is a **local web application**: a small Node.js server with no framework, and a browser UI in plain JavaScript with no build step. It drives the **Maestro CLI** and **adb** installed on the same PC. Nothing leaves the machine.

```text
┌───────────────────────── Window (Edge/Chrome app mode, http://understudy.localhost:4545) ─────────────────────────┐
│  app/index.html + app/app.js (helpers, tabs)  +  src/<feature>/*.ui.js (one file per screen)                       │
└──────────────▲───────────────────────────────────────────────┬─────────────────────────────────────────────────────┘
   live events │ SSE  GET /api/stream                          │ fetch /api/...  (session cookie + token header)
┌──────────────┴───────────────────────────────────────────────▼──────────────────────────── Node.js ───────────────┐
│ web-gui.js         starts everything; security checks on every request                                           │
│ src/server/        router, json helpers, static files                                                            │
│ src/<f>/<f>.routes.js   HTTP only: read the request, call the feature, answer                                    │
│ src/<f>/*.js            the logic (no HTTP):                                                                     │
│   record/  steps · selectors · yaml-write · yaml-read · recorder (save) · capture                                │
│   device/  adb · screen · layout · input · apps · emulator · wifi-connect · wifi · pairing · animations           │
│   run/     runner · flow-data · live-steps · partial · suites        data/  excel · prepare · flows-io            │
│   reports/ history · report      setup/ doctor      projects/      ai/ (optional, Ollama)      core/ paths, state │
└──────────────┬──────────────────────────────────────────┬─────────────────────────────────────────────────────────┘
               │ child process `maestro test`             │ child process `adb ...`
       ┌───────▼───────┐                          ┌───────▼────────────────────────┐
       │  Maestro CLI  │ ───────────────────────► │ Android phone (USB / Wi-Fi)    │
       └───────────────┘                          │ or virtual device              │
                                                  └────────────────────────────────┘
   Files on disk (the project folder): Flows/ TestData/ Scripts/ JsonData/ Reports/ History/ Suites/ .runs/
```

## Design rules

1. **Zero build, few dependencies.** Plain Node `http`, vanilla JS, SVG charts. npm packages: `exceljs`, `xlsx` (fallback), `yaml`.
2. **Files are the database.** Flows, Excel, suites and history are ordinary files in the project folder: easy to back up, diff and share.
3. **Never lose user work.** Every save of a flow or workbook makes a backup first; history is written with write-then-rename; YAML commands Understudy doesn't understand are kept word for word.
4. **Local only.** The server binds to `127.0.0.1`. See `THREAT-MODEL.md`.
5. **Maestro stays untouched.** Only its public CLI and the files it writes are used.
6. **One job per file.** Routes don't hold logic; logic doesn't touch HTTP; a `*.ui.js` file owns one screen.

## The four layers of a request

```text
button in app/index.html
  → src/record/recorder.ui.js          window code: collects input, calls fetch
  → POST /api/rec/save                 (cookie + X-Understudy-Token checked in web-gui.js)
  → src/record/record.routes.js        reads JSON, checks "busy", calls the feature
  → src/record/recorder.js save()      writes Excel, then the flow, then data scripts
```

When something breaks, find the layer first: wrong on screen → `*.ui.js`; error message from the server → `*.routes.js` then the feature file; wrong on the phone → `src/device/`.

## Writing flows (Record tab)

```text
 window (recorder.ui.js)                        PC                                              device
 canvas  ◄─ RGBA frame ◄─ GET /api/device/frame ◄─ screen.js: screencap (raw or gzip), shrink to 540 px ◄─ screencap
 click   ─► POST /api/rec/inspect ─► layout.js (cached uiautomator dump) ─► selectors.inspect() ─► element menu
 action  ─► POST /api/device/input ─► input.js ─► adb input tap / text / swipe ─────────────────────────────► phone
 steps   ─► POST /api/rec/preview ─► steps.normalize() ─► yaml-write.buildYaml() ─► YAML preview
 save    ─► POST /api/rec/save ─► recorder.save(): Excel values → flow file → Prepare Data
```

- **Frames** (`device/screen.js`): read-ahead (the next screenshot is taken while the current one is shown), the faster of raw / gzip per device, read-ahead paused during test runs. Phones without `gzip` use raw automatically. The ceiling is how fast the phone takes a screenshot (`npm run frame-speed`).
- **Screen changes:** a hash of each frame (status bar and A-B-A-B cursor blinks ignored) bumps a per-device counter `seq`. A layout is cached with the `seq` it was read at; `/api/rec/inspect` accepts the `seq` the user was looking at.
- **Layouts** (`device/layout.js`): one `uiautomator` call per device at a time (`withUiLock`). A blocked read ("Killed" ...) releases Maestro/Appium drivers when no run is active, then retries once. `--windows` is used where supported; `selectors.nodesAt` keeps only the top window under a point.
- **A click in Record mode taps nothing:** it opens the element menu; the chosen action is both recorded and sent to the device.
- **Selectors** (`record/selectors.js`) follow Maestro's matching rules: text matches text, label or hint; the deepest match wins; `index` counts top-to-bottom, then left-to-right. Candidates in order: ID, text/label/placeholder, ID + text, Nth match, screen position.
- **Two-way editing:** `yaml-read.parseYaml` turns hand-edited YAML back into steps; unknown commands become `raw` steps. `npm run check` proves every flow in `Flows/` survives YAML → steps → YAML → steps unchanged.
- **From phone** (`record/capture.js`): reads touches with `getevent`, keeps touches inside the app, reads typed text back from the layout.
- Non-English text is typed through the ADB Keyboard app when it is installed. Phone animations are turned off while recording (`device/animations.js`) and restored on disconnect, quit and next start.

## Executing flows (Run tab)

### Data-driven testing
**Prepare Data** (`data/prepare.js`) turns every sheet of every workbook in `TestData/` into:
- `JsonData/<Excel>/<Sheet>.json` for previews and row counts;
- `Scripts/<Excel>/<Sheet>.js`, the data provider Maestro loads with `runScript`:

```js
var data = [ { "email": "alice@example.com", "password": "Secret1" }, ... ];
var ROW_PICK = typeof ROW_LoginData_Valid != 'undefined' ? ROW_LoginData_Valid
             : (typeof ROW_NO != 'undefined' ? ROW_NO : 1);
var row = data[parseInt(ROW_PICK, 10) - 1];
if (!row) throw new Error('Row ... not found');
Object.keys(row).forEach(function (key) { output[key] = row[key]; });
```

Row 1 is column names; cells are taken as displayed text. Data is embedded, so nothing serves data while tests run. Generated scripts carry a marker line; hand-written scripts are never touched.

### Jobs
```text
queue item  { flow: "login.yaml", rows: "2,5-6" }
      │  flow-data.flowSheets() → the flow's own sheet LoginData/Valid (6 rows)
      │  parseRows("2,5-6", 6)  → [2, 5, 6]      (bad selections stop the run before it starts)
      ▼
jobs  login.yaml#2  env { ROW_LoginData_Valid: 2 } ... one job per row
```
Only sheets the flow itself loads get a row variable; sub-flows fall back to row 1.

### Running a job (`run/runner.js`)
```text
maestro test "Flows/<flow>" --format html-detailed --output "Reports/<n>.html"
             --debug-output ".runs/<job-id>" -e ROW_<Excel>_<Sheet>=<N> [--device <serial>]
```
- One job at a time; `state.busy` blocks device input, flow and Excel saves, and project switches while a run is active.
- `live-steps.js` polls `.runs/**/maestro.log` every 400 ms and turns `RUNNING / COMPLETED / FAILED / SKIPPED / WARNED` lines into `step` events.
- On exit: exit code, duration, innermost failed step, report path, failure screenshot (copied to `Reports/_shots/<run>/`).
- **Stop** kills the Maestro process tree. **Run from step** (`partial.js`) writes a temporary `.us-from-<n>-<flow>.yaml` with the header, the data scripts, then step n onwards; it is deleted when the run ends.
- Each run is saved to `History/history.json` and as `Reports/Understudy-Run-<date>.html` (`reports/report.js`, self-contained).

### Live events (`GET /api/stream`)
| `type` | Fields | Meaning |
|---|---|---|
| `log` | `text` | Console output (ANSI stripped) |
| `queue` | `jobs[{id,label,flow,row}]` | Run starting |
| `start` | `id,label,index,total` | A job started |
| `step` | `id,desc,status,ts` | A Maestro command changed state |
| `result` | `id,flow,row,ok,duration,failedStep,report,screenshot` | A job finished |
| `skipped` | `id` | Job skipped (stopped / stop-on-fail) |
| `done` | `passed,failed,skipped,results[]` | Run finished |

## HTTP API by feature

Each group lives in its own routes file. `node web-gui.js --list-routes` prints them all.

| File | Paths |
|---|---|
| `core/app.routes.js` | `/api/session`, `/api/shutdown`, `/api/stream`, `/api/open-folder` |
| `projects/projects.routes.js` | `/api/project`, `/api/projects`, `/api/projects/open\|create\|add\|rename\|forget` |
| `run/run.routes.js` | `/api/flows`, `/api/run`, `/api/stop`, `/api/suites*`, `/api/flow/commands` |
| `data/data.routes.js` | `/api/setup` (Prepare Data), `/api/data`, `/api/flow/read\|save\|duplicate\|rename\|delete`, `/api/excel/*` |
| `reports/reports.routes.js` | `/api/history`, `/api/history/run`, `/api/report/write`, `/api/reports` |
| `setup/setup.routes.js` | `/api/doctor`, `/api/adb/*`, `/api/setup/android`, `/api/system/*` |
| `device/device.routes.js` | `/api/device/*`, `/api/pair/*`, `/api/app/launch`, `/api/apk/*` |
| `record/record.routes.js` | `/api/rec/*`, `/api/capture/*` |
| `ai/ai.routes.js` | `/api/ai/*` |

Request rules (`core/security.js`):
- Public, no data: `/`, `/styles.css`, `/app.js`, `/src/<feature>/<name>.ui.js`, `/assets/*`, `/manifest.webmanifest`.
- Session cookie required: everything under `/api/`, `/reports/*.html`, `/runs/`.
- Every non-GET also needs the `X-Understudy-Token` header and, if `Origin` is present, our own origin.
- Report assets inside a report are served without the cookie (the sandboxed report frame has none).
- All file paths are resolved and checked to stay inside their folder.

## Where things are stored

| Where | What |
|---|---|
| Project folder | `Flows/`, `TestData/`, `Scripts/`, `JsonData/`, `Reports/`, `History/history.json`, `Suites/suites.json`, `FlowBackups/`, `ExcelBackups/`, `Apps/`, `.runs/` |
| Install folder | code, `assets/`, `node_modules/`, `logs/` (`understudy.log`, `install.log`, `emulator-*.log`, `animations-restore.json`), `tools/platform-tools/`, `tools/certs/` |
| User profile | `%APPDATA%\Understudy\projects.json` (or `~/.understudy`): the project list |

`src/core/paths.js` is the only file that knows these locations; modules ask it on every use, so the open project can change at run time.

## Extending

- **New screen:** add `src/<feature>/<name>.ui.js` (lowercase, dashes), add a `<script>` in `app/index.html`, register on `hooks.*` from `app/app.js` (`flowsLoaded`, `showSteps`, `runDone`, `tab`).
- **New API:** add it to `src/<feature>/<feature>.routes.js`; put the logic in a feature file. A new routes file must be added to the list in `web-gui.js`.
- **New device ability:** add it to the right file in `src/device/` and export it from `android.js`.
- **New step type:** `steps.js` (normStep) → `yaml-write.js` (stepLines) → `yaml-read.js` (fromCommand) → `recorder.ui.js` (stepRow). Add a flow using it to `Flows/examples/` so `npm run check` round-trips it.
- After any change: `npm run check`.
