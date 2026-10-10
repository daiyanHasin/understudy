<div align="center">

<img src="assets/icon-192.png" alt="Understudy" width="84">

# Understudy

**Record Android tests by clicking. Feed them Excel data. Run them with Maestro.**

*Show it once. It performs a thousand times.*

[![Version](https://img.shields.io/badge/version-2.0.0-17191e)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/platform-Windows-17191e)](#requirements)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-17191e)](https://nodejs.org)
[![Runs on Maestro](https://img.shields.io/badge/runs%20on-Maestro%20CLI-a97a2c)](https://maestro.mobile.dev)
[![100% local](https://img.shields.io/badge/runs-100%25%20locally-a97a2c)](#security-and-privacy)

**[Quick start](#quick-start)** · **[Recording](#recording-a-flow)** · **[Where things live](#where-things-live)** · **[Changelog](CHANGELOG.md)**

<br>

<img src="docs/screenshots/record.png" alt="The Record tab: a phone screen on a dark stage, the element menu open beside a button, and the recorded steps on the right" width="100%">

</div>

---

## What it is

Understudy is a local app for **Android UI test automation** on top of the [Maestro](https://maestro.mobile.dev) CLI. It replaces *record in Maestro Studio, copy YAML, hand-edit values into `${output.x}`, keep spreadsheets in sync, run commands, dig through reports* with one window:

1. **Click** an element on the phone screen and choose what to do with it.
2. **Type** a value and decide, right there, whether it is fixed text or an Excel column.
3. **Run** any flows with any Excel rows, and watch every step.
4. **Read** one report per test, compare runs, spot flaky tests.

Everything runs on your PC. No account, no cloud, no upload.

## New in 2.0

- **One click, every action.** Clicking an element opens a menu beside it, the way Maestro Studio does: tap, long press, double tap, type text, clear text, check it is visible, wait until it shows, scroll until it shows, copy its text, inspect. Choose how the element is found (ID or text, marked *unique*). Each action has a one-letter shortcut.
- **Typing in one step.** Type the value in the menu, pick *This exact text* or *From Excel* (the column is suggested), press Enter. The tap and the typing are recorded together; no extra dialog.
- **Simpler modes:** Record, Use phone, From phone.
- **Faster screen.** Screenshots are compressed on the phone before they are sent: about ten times less to move and far quicker than a PNG. The frame rate is shown above the screen.
- **No live video.** The scrcpy video path is gone. Nothing is copied to the phone, and there is one way the screen works on every device.
- **New look**: porcelain and ink with a brass accent, Source Serif 4 and Hanken Grotesk, light and dark.
- **Code sorted by feature** (`src/<feature>/`), see [Where things live](#where-things-live).

<table>
<tr>
<td width="50%"><img src="docs/screenshots/value-dialog.png" alt="Typing into a field from the element menu, with From Excel selected and the column Email"></td>
<td width="50%"><img src="docs/screenshots/record-dark.png" alt="The Record tab in dark mode"></td>
</tr>
<tr>
<td><sub>Type, choose exact text or an Excel column, press Enter.</sub></td>
<td><sub>Dark mode.</sub></td>
</tr>
</table>

---

## Requirements

| You need | Why | Get it |
|---|---|---|
| **Windows 10/11** | Runs Understudy | |
| A **phone** with USB debugging, *or* virtualization for a virtual device | Records and runs the tests | Phone: Developer options. Virtual device: virtualization in BIOS + *Windows Hypervisor Platform* |
| **Node.js 18+** | Runs Understudy | [nodejs.org](https://nodejs.org) |
| **Java 17+** | Maestro and the Android tools | [adoptium.net](https://adoptium.net) |
| **Maestro CLI** on `PATH` | Runs the tests (Maestro Studio is **not** needed) | [Install Maestro](https://docs.maestro.dev/getting-started/installing-maestro) |
| **Phone tools (adb)** | Talk to the phone | Understudy › Connect device › **Install phone tools** (8 MB) |

A phone on USB is the fastest and lightest setup. Android Studio is never required.

## Quick start

1. Unzip Understudy anywhere and double-click **`Understudy.vbs`**. The first start installs its components (about a minute) and offers a desktop shortcut. Behind Netskope or Zscaler, see [Company networks](#company-networks).
2. Understudy opens in its own window at **http://understudy.localhost:4545**.
3. Open **Setup** and fix anything marked red.
4. Open **Record**, press **Connect device**, and record your first flow.

**Quit** in the sidebar stops Understudy. `start-gui.bat` starts it with a console for troubleshooting.

---

## Recording a flow

1. **Record** › **Connect device**: USB, Wi-Fi (QR code or 6-digit code) or a virtual device.
2. Enter the app ID (or pick an installed app, or add an APK) and press **Launch app**.
3. Name the flow, e.g. `Login/login_valid.yaml`, and add tags such as `smoke, login`.
4. **Click an element.** A menu opens beside it:

   | Action | Key | Becomes |
   |---|---|---|
   | Tap · Long press · Double tap | `T` `L` `D` | `tapOn`, `longPressOn`, `doubleTapOn` |
   | Type text… | `I` | `tapOn` + `inputText` (exact text or `${output.Column}`) |
   | Clear text | `E` | `tapOn` + `eraseText` |
   | Check it is visible | `V` | `assertVisible` |
   | Wait until it shows | `W` | `extendedWaitUntil` |
   | Scroll until it shows | `S` | `scrollUntilVisible` |
   | Copy its text… | `C` | `copyTextFrom` into a variable |
   | Inspect | `N` | shows every selector and property |

   `Esc` closes the menu; **Tap without recording** moves on without a step. **Find by** picks the selector; *unique* means Maestro will find exactly this element.
5. Drag on the screen to swipe. **Back**, **Home**, **Enter**, **Hide keyboard**, **Scroll** and **Type…** sit under the screen; **Insert step** has waits, variables, other apps, sub-flows and blocks.
6. **Save flow**, or **Save and run**.

| Mode | What a click does |
|---|---|
| **Record** | Opens the element menu. Nothing is tapped until you choose. |
| **Use phone** | Taps the phone. Nothing is recorded. |
| **From phone** | Use the phone itself; taps in your app become steps and typed values are asked about. |

`Ctrl` + `Z` removes the last step. The **YAML** tab shows the flow as it is written and can be edited directly.

**About IDs.** Understudy shows `resource-id` whenever the app sets one. If an element has none, the app doesn't define it (common with Jetpack Compose without `testTagsAsResourceId`, Flutter without `Semantics(identifier:)`, React Native without `testID`). No tool can invent it, so ask the developers to add IDs.

---

## Writing data-driven flows

**Excel** (`TestData/LoginData.xlsx`, sheet `Valid`). Row 1 holds the column names:

| Email | Password | Expected |
|---|---|---|
| alice@example.com | Secret1 | Home |
| bob@example.com | Secret2 | Home |

**Flow** (`Flows/Login/login_valid.yaml`):

```yaml
appId: com.example.app
tags:
  - smoke
---
- runScript: "../../Scripts/LoginData/Valid.js"   # Scripts/<Excel file>/<Sheet>.js, relative to the flow
- launchApp:
    clearState: true
- tapOn:
    id: "com.example.app:id/email"
- inputText: "${output.Email}"
- tapOn:
    text: "Enter your password"
- inputText: "${output.Password}"
- tapOn: "Sign in"
- assertVisible: "${output.Expected}"
```

The recorder writes all of this for you. Rules of thumb: sheet and column names with letters, numbers, `_` and `-`; empty cells become `""`; cells are read as shown in Excel, so leading zeros and dates are kept; sub-flows that load their own sheet use row 1.

### Choosing rows

| You type | Runs |
|---|---|
| *(empty)* | row 1 |
| `all` | every data row |
| `2,7,13` | rows 2, 7 and 13 |
| `2-5` | rows 2 to 5 |
| `1,4-6,10` | mixed |

### Conditions and loops

Recorded or typed in the Flow panel; these are Maestro's own commands:

```yaml
- runFlow:                    # If visible
    when:
      visible:
        text: "Allow"
    commands:
      - tapOn: "Allow"
- repeat:                     # Repeat N times
    times: 3
    commands:
      - scroll
- retry:                      # Retry flaky steps
    maxRetries: 3
    commands:
      - tapOn: "Place order"
```

---

## Where things live

Each feature keeps its PC-side code (`x.js`) and its window code (`x.ui.js`) together.

```text
understudy/
├── Understudy.vbs  start-gui.bat     start (hidden / with a console)
├── web-gui.js                        the local server: routes and static files
├── app/                              the window: index.html, app.js (shared helpers), styles.css
├── src/
│   ├── core/       paths, state, security, app window · secure-fetch.ui, shell.ui (sidebar, welcome)
│   ├── device/     android (adb, frames, input, layout), wifi, pairing, qr, animations · connect.ui
│   ├── record/     recorder (selectors, YAML, saving), capture (From phone) · recorder.ui (screen, element menu, steps)
│   ├── run/        runner, flow-data, live-steps, partial (run from step), suites · run.ui, run-extras.ui
│   ├── reports/    report, history · reports.ui, dashboard.ui
│   ├── data/       excel, prepare (Excel to data scripts), flows-io · excel.ui, flows.ui
│   ├── setup/      doctor (the checklist) · setup.ui
│   ├── projects/   projects · projects.ui
│   └── ai/         ai (optional, local Ollama) · ai.ui
├── assets/                           logo, icons, fonts
├── tools/                            install-deps.ps1, install-android.ps1, platform-tools/
├── website/                          documentation site
├── docs/                             ARCHITECTURE.md, screenshots
├── Flows/  TestData/                 YOUR flows and Excel data
└── Apps/ Reports/ History/ logs/ …   created while you work
```

| I want to change… | Open |
|---|---|
| What a click on the screen does, the element menu | `src/record/recorder.ui.js` (`openMenu`) |
| The YAML that gets written | `src/record/recorder.js` (`buildYaml`, `parseYaml`) |
| Screenshot speed, taps, typing on the phone | `src/device/android.js` (`frame`, `tap`, `text`) |
| Phone over Wi-Fi | `src/device/wifi.js`, `pairing.js`, `connect.ui.js` |
| Running flows | `src/run/runner.js`, `run.ui.js` |
| Reports and dashboard | `src/reports/` |
| Look and feel | `app/styles.css` (tokens at the top) |

A request goes `app/index.html` button → `src/<feature>/<x>.ui.js` → `fetch /api/...` → route in `web-gui.js` → `src/<feature>/<x>.js` → adb, Maestro or files. More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Security and privacy

- Listens on **127.0.0.1 only**. Nothing is uploaded; there is no telemetry.
- A new **session token** every start (HttpOnly, SameSite=Strict cookie + request header), plus **Host** and **Origin** checks, so other websites in your browser can't control Understudy.
- adb and the emulator run **without a shell**; every argument sent to the device is quoted.
- Names of flows, workbooks, sheets, columns, APKs and devices are validated; request bodies and uploads are size-limited; APKs are checked before they are stored.
- Maestro HTML reports are shown in a **sandbox**.

---

## Configuration

| What | Where |
|---|---|
| Name, tagline, author, version | `app.config.json` |
| Open in the default browser instead of an app window | `"window": "browser"` in `app.config.json` |
| Address (`understudy.localhost`) and port (`4545`) | `HOST_NAME` and `PORT` at the top of `web-gui.js` |
| Colors and fonts | the tokens at the top of `app/styles.css` |

---

## Limitations

- **Windows only** for now, and **Android only** (iOS simulators need macOS).
- Wi-Fi phones need a network where devices can reach each other. Many office and guest Wi-Fi networks don't allow it: use USB, or this PC's Mobile hotspot.
- The screen is a stream of screenshots (about 2 to 6 per second on USB, fewer on Wi-Fi), not video.
- A screen that never stops moving (video, endless animation) can't be described by Android; taps there are saved as screen positions and marked.
- *From device* mode: portrait screens only; password text can't be read back, so Understudy asks for it.
- Some apps refuse emulators (banking, root/emulator detection, Play Integrity). Use a real phone.
- One device, one test at a time. Each data row starts Maestro again (a few seconds per row).
- Keep Excel workbook names unique; close workbooks in Excel before saving from Understudy.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Nothing opens after `Understudy.vbs` | See `logs/understudy.log`, or run `start-gui.bat`. |
| Virtual device doesn't start | Read the red box on the Record tab, try **Graphics: compatible** in Add device, check **Hardware acceleration** in Setup, see `logs/emulator-<name>.log`. |
| "Could not read the screen layout" / "The screen never stops moving" | Tick **Turn off phone animations** in Add device, wait for spinners to finish, then tap again. |
| Wi-Fi phone won't connect | Add device › Wi-Fi › **Check connection** says why. Most often: the port changed (copy *IP address & Port* again), the pairing port was used to connect, or the office Wi-Fi keeps devices apart (use USB or this PC's Mobile hotspot). |
| QR code scanned, nothing happens | The network blocks phone discovery. Use **Pair with a 6-digit code**. |
| `SELF_SIGNED_CERT_IN_CHAIN` on first start | See [Company networks](#company-networks). |
| Screen is slow over Wi-Fi | Use USB when you can. The label above the screen shows frames per second; Wi-Fi is usually 1 to 3. |
| Phone animations stay off | Quit Understudy with **Quit** (or start it again with the phone connected). To do it by hand: Developer options › the three *animation scale* settings. |
| Values empty when a flow runs | **Prepare Data**, check the `runScript` path and the column name (case-sensitive). |
| "Close it in Excel" | The workbook is open in Excel. Close it and save again. |
| "Understudy was restarted" | Press **Reload**. |
| `understudy.localhost` doesn't open | Use http://localhost:4545. |

### Company networks

Company PCs often run an HTTPS-inspection client (Netskope, Zscaler, Forcepoint …) that replaces website certificates with the company's own. Windows trusts it; Node.js and npm don't, so a plain `npm install` fails with `SELF_SIGNED_CERT_IN_CHAIN`.

`Understudy.vbs` handles this: `tools/install-deps.ps1` collects the certificates Windows trusts (and Netskope's own files) into `tools/certs/company-ca.pem` and gives them to npm and to Understudy through `NODE_EXTRA_CA_CERTS`. Nothing is switched off.

If it still fails, ask IT for the root certificate of the HTTPS inspection (`.cer`, `.crt` or `.pem`), copy it into `tools\certs\`, and open Understudy again. Proxy or blocked downloads are explained in the install window and in `logs/install.log`. Without internet access at all, use a release ZIP that already contains `node_modules`.

---

## Credits

- **[Maestro](https://github.com/mobile-dev-inc/maestro)** by [mobile.dev](https://mobile.dev) runs every test (Apache 2.0). Understudy calls the Maestro CLI on your machine and does not include or modify it.
- **[Maestro Excel Data-Driven Framework](https://github.com/mohai17/Maestro-Excel-Data-Driven-Framework)** by **Md. Mohai Minul Islam ([@mohai17](https://github.com/mohai17))**: the original idea of turning Excel sheets into data providers for `runScript` (Apache 2.0).
- **[ExcelJS](https://github.com/exceljs/exceljs)**, **[SheetJS](https://sheetjs.com)** and **[yaml](https://github.com/eemeli/yaml)**.

Full notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Understudy is an independent project, **not affiliated with or endorsed by mobile.dev**. "Maestro" is used only to describe compatibility.

---

## License

**Proprietary. All rights reserved.** Free to download and use, unmodified, for personal or internal testing. Redistribution, resale, modified versions or offering it as a service need written permission. See **[LICENSE](LICENSE)**.

## Author

**Hasin Md. Daiyan** · [daiyanhasin07@gmail.com](mailto:daiyanhasin07@gmail.com)

Found a bug or have an idea? [Open an issue](../../issues).
