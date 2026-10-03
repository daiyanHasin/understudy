# Changelog

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
