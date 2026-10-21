# Threat model

Understudy runs on a tester's PC, controls phones over adb and runs programs (Maestro, adb, PowerShell). The worst outcomes are: **another website or program driving Understudy**, **commands injected into the PC or the phone**, and **test data or screens leaving the machine**.

## What we protect
| Asset | Why it matters |
|---|---|
| The PC | Understudy starts processes; a bad input must never become a command |
| Connected phones | adb has full control of a debugging phone |
| Test data (Excel) | may contain real logins, customer-like data |
| Screens / layouts / reports | show app content |
| Flows | the tester's work |

## Who could attack, and how
| # | Threat | Defence today | Where |
|---|---|---|---|
| T1 | A web page in the same browser sends requests to `localhost:4545` (CSRF) | session token per start: HttpOnly SameSite=Strict cookie + `X-Understudy-Token` header on every change; Origin check | `core/security.js`, `core/secure-fetch.ui.js` |
| T2 | DNS rebinding (an evil domain resolving to 127.0.0.1) | Host header must be `localhost`, `127.0.0.1`, `[::1]` or `understudy.localhost` with our port | `security.hostOk` |
| T3 | Another computer on the network | server binds to `127.0.0.1` only | `web-gui.js` |
| T4 | Command injection on the PC | `execFile` / `spawn` with argument arrays, never a shell; serial, package, AVD, address validated by regex | `device/adb.js` |
| T5 | Command injection on the phone | every `adb shell` argument single-quoted (`shQuote`); numbers range-checked | `device/adb.js`, `input.js` |
| T6 | Path traversal (`../`) in flow, Excel, report or screenshot paths | resolved and checked to stay inside their folder; flow names limited to safe characters | `flows-io.js`, `excel.js`, `server/static.js`, `run.routes.js` |
| T7 | A Maestro HTML report runs scripts against the app | reports served sandboxed with their own headers | `security.headers.report` |
| T8 | Huge request bodies (memory) | JSON 5 MB; APK 800 MB, written to `.part` and checked for a ZIP header | `security.readJson`, `device.routes.js` |
| T9 | Data leaving the machine | no telemetry; AI helper is local Ollama only; the only downloads are user-started (npm install, platform-tools, Ollama models) | `ai/ai.js`, `adb-setup.js` |
| T10 | Phone left in a changed state (animations off) | saved before change, restored on disconnect, quit and next start | `device/animations.js` |
| T11 | Supply chain (npm packages) | three dependencies only; `package-lock.json` committed | `package.json` |
| T12 | Company HTTPS inspection breaks downloads | uses certificates Windows trusts (`NODE_EXTRA_CA_CERTS`); TLS checking is never turned off | `tools/install-deps.ps1` |

## Known gaps (accepted for now, fix before v3 unless noted)
- **Any program running as the same Windows user** can read the session cookie or the project files. Accepted: that user already owns the PC.
- **Test data is stored in plain Excel** and copied into `Scripts/*.js`. Document it for users; don't put production secrets in test data.
- **`xlsx` is installed from the SheetJS CDN**, not npm. Pin the version (done) and check its hash in `package-lock.json` on update.
- **Wi-Fi adb** (`adb tcpip 5555`) lets anyone on the same network connect to the phone until it restarts. Show a warning when switching to Wi-Fi; prefer paired wireless debugging (Android 11+).
- **Accounts don't exist yet.** When login is added, write an authentication section here first.

## When you change code, ask
1. Does a value from the window reach a command? → validate it with a regex, pass it as an argument, never build a command string.
2. Does a value become a file path? → resolve it and check it stays inside its folder.
3. Does the change add a route? → it is protected automatically (cookie + token) unless you add it to the public list in `server/static.js`. Don't.
4. Does it download or send anything? → it must be started by the user and listed in T9.
