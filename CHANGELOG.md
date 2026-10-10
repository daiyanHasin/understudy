# Changelog

## Understudy 2.0.0 — 2026-10-10

### Recording
- One click on an element opens a menu beside it: Tap, Long press, Double tap, Type text, Clear text, Check it is visible, Wait until it shows, Scroll until it shows, Copy its text, Inspect, or Tap without recording. Each has a one-letter shortcut; Esc closes.
- Choose how the element is found (ID, text, ID + text, position) in the same menu, marked unique or not.
- Typing is one step: type, pick This exact text or From Excel (column suggested), press Enter. The tap and the text are recorded together. Excel values go to `TestData/<App>Data.xlsx` on a sheet named after the flow unless you change it.
- Modes reduced to Record, Use phone and From phone. Add check, Copy text and Inspect are now actions in the menu.

### Screen
- Live video (scrcpy) removed: nothing is copied to the phone any more.
- Screenshots are compressed on the phone (`screencap | gzip -1`) and fetched back to back. Phones without gzip fall back to raw screenshots automatically. Frame rate shown above the screen.

### Design
- New look: porcelain and ink with a brass accent, light paper sidebar, dark dot-grid stage, Source Serif 4 and Hanken Grotesk (bundled, offline). Light and dark.
- New logo and icons.

### Code
- Sorted by feature: `src/<feature>/x.js` (PC) next to `x.ui.js` (window); the window shell in `app/`. The old `app.js` is split into run, Excel and flow-editor files.
- Removed: `lib/mirror.js`, `ui/mirror.js`, `vendor/scrcpy-server`, `docs/CODEMAP.md` (the README has the folder map), the duplicate `docs/CHANGELOG.md`, the old demo GIF, Inter and Instrument Serif.

## Understudy 1.2.0 — 2026-10-06

### Devices: the core rewritten for speed and reliability
- **Live screen (scrcpy).** The device is shown as H.264 video decoded in the window instead of a 10 MB raw screenshot per frame. Smooth over USB, and finally usable over Wi-Fi. Falls back to screenshots automatically.
- **Real touches.** The finger goes down when the mouse goes down and up when it goes up: buttons show their pressed state, long presses and drags behave like a thumb.
- **Typing any language** (Bengali included) goes through the device clipboard. No ADB Keyboard needed with the live screen.
- **"Killed" fixed.** Only one screen read runs per device at a time; if Maestro Studio or a leftover Maestro driver holds the device, Understudy releases it and retries.
- **All elements.** Screen reads include dialogs, the keyboard and system bars (`uiautomator dump --windows` on Android versions that have it); taps target the window on top.
- **Hover inspector** like Maestro Studio: every element is outlined under the mouse with its type, ID and text; "All" outlines everything at once. The Element tab shows every property, including the resource ID.
- **Recording from the phone** no longer reports "the screen was still changing": the element is read from the screen as it was when the finger touched it. A blinking cursor or the clock no longer count as changes.
- **Follow other apps** (From device mode): taps in a browser or another app are kept and an "Open app" step is added when the app changes.
- **Apps on the device**: pick an installed app (including Chrome, Settings ...) instead of uploading an APK.
- **USB to Wi-Fi in one click**, plus a quality setting for slow Wi-Fi.
- **Virtual devices:** Stop now really ends the emulator; **Free memory** ends the emulator, adb and (optionally) Android Studio; **Light mode** starts it with 1.5 GB RAM and 2 cores.
- Runs go to the device chosen on the Record tab (`maestro --device`).

### Recording: many more commands
- **Variables**: flow variables (`env`), Set variable (text or JavaScript), **Copy text into a variable** (click a text on screen), Type a variable, Paste, Check a condition. Text you copy on the phone can be saved as a variable from the notification.
- **If / else**, on "visible", "not visible" or any JavaScript condition such as `output.Role == 'admin'`. The else part is driven by a flag, so the if part may change the screen safely.
- **Apps and web**: switch to another app, open a link or the browser, stop / kill / clear an app, recent apps.
- Wait until visible (with a timeout), run another flow file, run a JavaScript file, GPS location, airplane mode, screen recording, more keys.

### Running
- **Run from any step with the data loaded.** Steps before it are skipped, except data scripts and variables, which run first: no more `undefined` when starting at line 12. From Flow files ("Run from step…") or from a failed test in Reports ("Run from the failed step…", which preselects the step).

### Reports
- New **Reports** tab: every run with a pass-rate ring, totals, each test's steps with timings, the Excel row, the failure reason and the screen at the failure. Rerun failed, run again, run from the failed step.
- Each run is also saved as one self-contained, offline HTML file: `Reports/Understudy-Run-<date>.html`.
- Picking a report on the Run tab opens it in the Reports tab. Failure screenshots are kept with the reports (they used to be lost on the next run).

### Projects
- Install once, keep many projects anywhere on the PC, switch from the top of the sidebar. The list lives in `%APPDATA%\Understudy`, so it survives updates. The install folder stays the "Default project": nothing needs moving.

### Optional AI helper
- Writes or changes a flow from a sentence, using a small local model through Ollama. Not bundled and never required: installed from Setup in a few clicks, works only with a phone over USB, and reads the real screen to target the right elements.

### Look and speed
- Opening curtain, collapsible sidebar (Ctrl+B), first-start guide, new logo.
- Fonts ship with the app: the window no longer waits for Google Fonts on slow or no internet.
- The Dashboard loads run history without step details (faster).

## Understudy 1.1.0 — 2026-10-04

### Recording
- **From device** mode: tap and type on the phone or in the emulator window; only touches in your app become steps (the keyboard, launcher and other apps are ignored). Typed text is read back from the screen.
- Placeholders such as "Enter email" are now found, including fields drawn by Jetpack Compose.
- Every step's type can be changed (Tap, Double tap, Long press, Check visible, Check not visible, Scroll until visible) and its target edited.
- **Blocks**: Repeat N times, Repeat while visible, If visible, Retry. Tick steps and wrap them, or insert an empty block.
- **Editable flow**: the Flow panel is a YAML editor that syncs back into the steps. Any other Maestro command is kept as a custom step.
- Steps can be moved up and down.

### Test data
- Choose where data goes: an existing Excel file and sheet, an existing file with a new sheet, or a new file. Existing columns are suggested.

### Devices
- Much faster screen: raw frames instead of PNG, shrunk on the PC.
- Taps are faster: the screen layout is read in the background while the screen is still.
- Disconnect / Stop button, phones over Wi-Fi (with pairing), and clean-state snapshots for virtual devices.
- Virtual devices start with GPU graphics by default (software graphics as a fallback); the emulator log is saved and its errors are shown.
- **Install Android tools** in Setup: installs adb, the emulator and a light virtual device without Android Studio.
- APK manager: add an APK, install it, and remove it with the × button.

### Look
- Sidebar navigation, neutral graphite dark mode, placeholder for user accounts.

## Understudy 1.0.0 — 2026-10-03

X-Maestro Flow Runner is now **Understudy**.

### Recording (no Maestro Studio, no phone needed)
- New **Record** tab: start an Android virtual device and see its screen inside Understudy.
- Launch the app with fresh data.
- Tap, long-press, swipe and type on the device; every action becomes a Maestro step.
- **Add check** mode for visibility assertions; **Just use** mode records nothing.
- Each step offers several targets (ID, text, label, hint, screen position) and warns when a target is not unique.
- Live YAML preview; **Save flow** and **Save and run**.

### Data-driven values, automatically
- After typing into a field, choose **Read from test data** or **Use this exact text**.
- Test data: the column name is suggested from the field, the flow gets `${output.Column}`, the value is written to Excel as row 1, and the data scripts are regenerated.
- Existing Excel values are never overwritten; leading zeros are kept; password values are masked.

### Setup and launch
- New **Setup** tab with a checklist and exact fixes.
- `Understudy.vbs` starts Understudy without a console window and opens it in its own app window; offers a desktop shortcut.
- **Quit** button; stops by itself a few minutes after the window is closed when nothing is running.
- Non-English text (e.g. Bengali) through the free ADB Keyboard app.

### Security
- Per-start session token (HttpOnly SameSite=Strict cookie + request header), Origin and Host checks, body limits.
- No shell for adb/emulator; device arguments are quoted; strict name checks for flows, workbooks, sheets, columns and APKs.
- Maestro reports are sandboxed.

## X-Maestro Flow Runner 1.0.0 — 2026-10-01

First release of **X-Maestro Flow Runner**.

### Running
- Web GUI (`start-gui.bat`) at `http://x-maestro.localhost:4545`, local-only.
- Run selected flows in any order, run one flow, run all, stop, stop on first failure, rerun failed.
- Tags quick-select from each flow's `tags:`.
- Saved test suites (order, rows, stop-on-fail).

### Data-driven testing
- Excel → embedded data scripts (no JSON server, no port 8080).
- Per-flow row selection: `1`, `all`, `2,7,13`, `2-5`, mixed; validated before running.
- One sheet variable per sheet, so several workbooks and sub-flows work together.
- Data preview with selected rows highlighted.
- Blank columns and blank rows in Excel are ignored.

### Visibility
- Live step list from Maestro's log (running / passed / failed, time per step, sub-flow indenting).
- Excel row in use shown next to live steps.
- Progress bar, counters, elapsed time; first failure opened automatically.
- Failure screenshot per failed test; one HTML report per flow and row.

### Editors
- Excel editor: edit cells, insert rows above/below and columns left/right, add sheets, new files, backups.
- Flow editor: edit, save, duplicate, rename, delete, backups.

### Dashboard
- Run history, KPIs, passed/failed per run, pass-rate trend, most failures, slowest tests, flaky tests.
- Compare two runs: fixed, newly failing, still failing, time change, failed step.

### Setup
- First start installs dependencies and prepares test data automatically.
