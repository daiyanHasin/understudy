# File map

Every file in Understudy, one line each. **Keep this up to date:** when you add, move or delete a file, change this list in the same commit.

Naming: in each feature folder, `x.js` = logic on the PC, `x.routes.js` = its HTTP routes, `x.ui.js` = its window code.

## Start-up and configuration
| File | What it does |
|---|---|
| `Understudy.vbs` | Everyday start (no console): checks Node, first-run install, certificates, desktop shortcut, then `node web-gui.js --hidden` |
| `start-gui.bat` | Start with a console window (for troubleshooting) |
| `web-gui.js` | Starts the server: config, security checks per request, loads every `*.routes.js`, idle shutdown, log file |
| `app.config.json` | Name, tagline, author, version, window mode (`app` / `browser`) |
| `package.json` | Dependencies and scripts: `start`, `check`, `frame-speed`, `prepare-data` |
| `manifest.webmanifest` | App name and icons for the browser window |

## The window (browser side)
| File | What it does |
|---|---|
| `app/index.html` | All screens' markup; loads the `*.ui.js` files in order |
| `app/app.js` | Shared helpers: `$`, `el`, `toast`, `modal`, theme, tabs, the `hooks` list other screens register on |
| `app/styles.css` | All styling; design tokens at the top (see `DESIGN-SYSTEM.md`) |
| `src/core/secure-fetch.ui.js` | Adds the session token to every changing request; "server restarted" reload banner (loaded first) |
| `src/core/shell.ui.js` | Sidebar collapse, opening fade-in, first-run guide (loaded last) |
| `src/run/run.ui.js` | Run tab: flow list, queue, start/stop, live steps, results (SSE) |
| `src/run/run-extras.ui.js` | Run tab extras: tag quick-select, suites, data preview, "data used" panel |
| `src/data/excel.ui.js` | Test Data tab: Excel editor |
| `src/data/flows.ui.js` | Editor tab: flow YAML editor |
| `src/reports/reports.ui.js` | Reports tab: every run, run-from-step |
| `src/reports/dashboard.ui.js` | Dashboard: KPIs, SVG charts, flaky tests, compare runs |
| `src/setup/setup.ui.js` | Setup tab checklist, Record/Setup tab switching, Quit |
| `src/device/connect.ui.js` | Add device: USB, Wi-Fi (QR / code / address), phone tools install, animations option |
| `src/record/recorder.ui.js` | Record tab: screen, hover inspector, element menu, value dialog, steps list, YAML preview, save *(largest file; next to split)* |
| `src/projects/projects.ui.js` | Project switcher |
| `src/ai/ai.ui.js` | Optional AI helper panel |

## Server: shared
| File | What it does |
|---|---|
| `src/server/http.js` | Router (`GET`/`POST`, refuses duplicate routes), `json`, `fail`, `deviceFree` |
| `src/server/static.js` | Serves UI files, reports and failure screenshots; every path checked to stay in its folder |
| `src/core/app.routes.js` | `/api/session`, `/api/shutdown`, `/api/stream` (live events), `/api/open-folder` |
| `src/core/security.js` | Session token + cookie, CSRF/Origin/Host checks, body limits, response headers |
| `src/core/paths.js` | The only place that knows folder locations (install, project, logs) |
| `src/core/state.js` | Shared flags: `busy`, `stopRequested`, current Maestro process |
| `src/core/app-window.js` | Opens the UI in an Edge/Chrome app window |

## Device (adb)
| File | What it does |
|---|---|
| `src/device/android.js` | Index only: gathers every device file into one `require` |
| `src/device/adb.js` | Finds adb/emulator/aapt; `run` and `shell` helpers (no shell injection); input checks; `devices()` |
| `src/device/screen.js` | Record-tab frames: raw/gzip choice, read-ahead, decode + shrink, screen-change counter |
| `src/device/layout.js` | Elements on screen (`uiautomator dump`), one at a time per device, cached per screen change |
| `src/device/input.js` | Tap, long press, swipe, keys, text (ADB Keyboard for non-English); screen size, touch device, keyboard area |
| `src/device/apps.js` | Installed apps, app in front, launch, open link, install APK |
| `src/device/emulator.js` | Virtual devices: list, start, why it closed, stop, snapshots; heavy processes / Free memory |
| `src/device/wifi-connect.js` | Pair with code, connect by IP:port, USB → Wi-Fi in one click |
| `src/device/wifi.js` | Plain-language reason a Wi-Fi phone can't be reached (TCP probe, PC networks) |
| `src/device/pairing.js` | Pair by QR code (adb mDNS) |
| `src/device/qr.js` | QR code encoder (SVG), no npm package |
| `src/device/animations.js` | Phone animations off while recording, restored afterwards |
| `src/device/adb-setup.js` | Downloads Google's platform-tools (adb) into `tools/platform-tools` |
| `src/device/device.routes.js` | Routes for all of the above |

## Recording (writing flows)
| File | What it does |
|---|---|
| `src/record/recorder.js` | Step types reference (top comment); `save()`: Excel values, flow file, Prepare Data |
| `src/record/steps.js` | Step model and rules: `normalize`, `normStep`, `checkSel`, `checkData`; shared regexes |
| `src/record/selectors.js` | Element under a point, selector candidates, Maestro matching rules, `pointOnly`, `compactNodes` |
| `src/record/yaml-write.js` | Steps → Maestro YAML (`buildYaml`) |
| `src/record/yaml-read.js` | Maestro YAML → steps (`parseYaml`); unknown commands kept as `raw` |
| `src/record/capture.js` | "From phone": turns touches made on the device into steps (`getevent`) |
| `src/record/record.routes.js` | `/api/rec/*`, `/api/capture/*` |

## Running (executing flows)
| File | What it does |
|---|---|
| `src/run/runner.js` | Flow list, queue → jobs, runs `maestro test` one job at a time, events, history, reports |
| `src/run/flow-data.js` | Which sheets a flow uses; row selections (`2,5-6`, `all`) |
| `src/run/live-steps.js` | Tails `maestro.log` → live step events; finds failure screenshots |
| `src/run/partial.js` | Run from step N with data scripts reloaded |
| `src/run/suites.js` | Saved suites in `Suites/suites.json` |
| `src/run/run.routes.js` | `/api/flows`, `/api/run`, `/api/stop`, `/api/suites*`, `/api/flow/commands` |

## Data, reports, setup, projects, AI
| File | What it does |
|---|---|
| `src/data/excel.js` | Excel read/write for the editor (ExcelJS, SheetJS fallback), with backups |
| `src/data/prepare.js` | Prepare Data: `TestData/*.xlsx` → `Scripts/*.js` + `JsonData/*.json` |
| `src/data/flows-io.js` | Read / save / duplicate / rename / delete flows (with backups); peeks appId and tags |
| `src/data/data.routes.js` | `/api/setup`, `/api/data`, `/api/flow/*`, `/api/excel/*` |
| `src/reports/history.js` | `History/history.json` (last 300 runs) |
| `src/reports/report.js` | Self-contained HTML report per run |
| `src/reports/reports.routes.js` | `/api/history*`, `/api/report/write`, `/api/reports` |
| `src/setup/doctor.js` | Setup checklist (Node, Java, Maestro, adb, SDK, acceleration) |
| `src/setup/setup.routes.js` | `/api/doctor`, `/api/adb/*`, `/api/setup/android`, `/api/system/*` |
| `src/projects/projects.js` | Project list in `%APPDATA%\Understudy\projects.json` |
| `src/projects/projects.routes.js` | `/api/project`, `/api/projects*` |
| `src/ai/ai.js` | Optional local AI helper (Ollama); USB phone only |
| `src/ai/ai.routes.js` | `/api/ai/*` |

## Tools
| File | What it does |
|---|---|
| `tools/check.js` | `npm run check`: the safety net (syntax, modules, routes, logic, flow round-trips) |
| `tools/frame-speed.js` | `npm run frame-speed`: screenshots per second the connected phone can deliver |
| `tools/install-deps.ps1` | First-start `npm install` that works behind Netskope/Zscaler (builds `tools/certs/company-ca.pem`) |
| `tools/install-android.ps1` | Optional emulator + system image install |
| `tools/screenshot-webp.html` | Helper to convert screenshots for the website |

## Everything else
| Path | What it is |
|---|---|
| `assets/` | Logo, icons, bundled fonts |
| `Flows/`, `TestData/` | Example flows and data (in a project: the tester's own) |
| `website/` | Public site on Vercel (separate from the app) |
| `docs/` | These documents; `docs/screenshots/` for the README |
| `.github/ISSUE_TEMPLATE/` | Bug and feature templates |
| `LICENSE`, `LICENSES/`, `THIRD_PARTY_NOTICES.md` | Licences (Apache-2.0 parts from mohai17's framework) |

## Not used by the window today (candidates to remove later)
`GET /api/device/foreground`, `GET /api/device/packages`, `GET /api/session`. The APK routes (`/api/apk/*`) and their UI are still present in 2.0.0.
