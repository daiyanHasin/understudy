# Roadmap

The goal before any new feature: **v3 = fully stable for testing**, then a desktop app.
"Stable" is defined in `TESTING.md` (exit criteria). A feature that doesn't help reach that line waits.

## v2.x — make what exists solid (now)

| Area | Work | Done when |
|---|---|---|
| Code | Split by job (routes, device, recorder) | ✅ done, `npm run check` passes |
| Code | Split `src/record/recorder.ui.js` (1,683 lines) into screen, inspector, element menu, value dialog, steps list | each file < 500 lines, check passes, manual record test passes |
| Code | Remove routes and UI nobody uses (see bottom of `FILE-MAP.md`) | decided per item, CHANGELOG notes it |
| Screen | Faster frames (read-ahead, raw/gzip choice) | ✅ done; measure on 3 phones with `npm run frame-speed` |
| Devices | Wi-Fi: clear message on every failure, auto-reconnect after a drop | the Wi-Fi checklist in `TESTING.md` passes on office Wi-Fi |
| Running | Pre-flight before every run: device connected and awake, app installed, Maestro found | a run with a missing piece stops in < 5 s with one clear sentence |
| Running | Run states: queued → checking → running → collecting → passed / failed / stopped | Stop, unplugging and closing the window never leave a stuck "running" state |
| Running | Error codes instead of raw text (`DEVICE_OFFLINE`, `MAESTRO_NOT_FOUND`, `FLOW_INVALID`, `TIMEOUT`, `DATA_ROW_MISSING`) | every failed job shows one code + one sentence |
| Writing | Validate the flow before save (known commands, selectors, data columns exist) | a broken flow can't be saved without a warning |

## v3.0 — stable (target)
All exit criteria in `TESTING.md` pass on: one office PC behind Netskope, one PC with < 16 GB RAM, three different phones (one older Android), USB and Wi-Fi. Colleagues use it for two weeks with no "had to restart Understudy" bug open.

## After v3 — desktop app
- Package the same server + window as a desktop app (see `DECISIONS.md`, ADR-007). No rewrite: `web-gui.js` and `src/` move as they are.
- Installer with Node bundled, so nobody installs Node or runs npm (ends the Netskope problem).
- Accounts / login (the account section is a placeholder until then).
- Optional: local AI helper for YAML, own test engine instead of Maestro (only if Maestro becomes the blocker; see ADR-005).

## Not planned
Live video (scrcpy) · APK upload as a core feature · cloud anything.
