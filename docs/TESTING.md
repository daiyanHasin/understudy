# Testing and the v3 exit criteria

Understudy is a testing tool, so it has to be the most dependable thing on the tester's PC. Three levels of checks, from cheapest to most thorough.

## 1. Automatic: `npm run check` (every change, before every commit)
No phone, no Maestro, no network. A few seconds. It checks:
- every `.js` file is valid JavaScript;
- every server module loads (catches wrong `require` paths after moving a file);
- no route is registered twice, and every `/api/...` the window calls exists on the server;
- every `<script>` in `index.html` exists and is served;
- screen frame decoding (RGBA, BGRA, RGB565), layout XML parsing, Wi-Fi address parsing, row selections, element picking;
- **every flow in `Flows/` survives YAML → steps → YAML → steps unchanged.**

**Rule:** a commit with a failing check doesn't go in. When you fix a bug in pure logic (selectors, YAML, rows ...), add a test for it in `tools/check.js` first, so it never comes back. When you find a flow the editor breaks, put a copy in `Flows/examples/` and the round-trip test covers it from then on.

## 2. Manual smoke test (before sharing a build with colleagues, ~15 minutes)
Use one USB phone. Tick each line.

**Start**
- [ ] `Understudy.vbs` opens the window; Setup shows all required checks green
- [ ] Quit, start again: no error, phone animations are back on

**Writing flows**
- [ ] Add device → USB phone appears within 5 s; screen shows; fps label visible
- [ ] Click an element → menu opens beside it; Tap records a step and taps on the phone
- [ ] Type text → "From Excel" → column suggested; Enter records one step
- [ ] Add a check (assert visible), a scroll, Back key
- [ ] Edit the YAML by hand (add a command) → the step list follows; nothing else changed
- [ ] Save → flow in `Flows/`, value in `TestData/<App>Data.xlsx`, Prepare Data ran

**Executing flows**
- [ ] Run the new flow → live steps move; passes; report opens
- [ ] Run with rows `1-2` → two jobs, each with its own row
- [ ] Break the flow (wrong text) → fails on the right step with a screenshot
- [ ] Stop during a run → stops within 5 s, state returns to idle
- [ ] Run from step 3 → data still loaded

**Wi-Fi** (office Wi-Fi and a phone hotspot)
- [ ] USB → Wi-Fi in one click; unplug cable; screen keeps working
- [ ] Turn phone Wi-Fi off → a clear message, no frozen window; on again → reconnect works
- [ ] Pair with code on a phone never paired before

## 3. v3 exit criteria (all must be true to call it stable)

| # | Criterion | How to measure |
|---|---|---|
| E1 | `npm run check` passes | automatic |
| E2 | Smoke test (section 2) passes on 3 phones (one Android ≤ 10), USB and Wi-Fi | checklist, saved with the release |
| E3 | Works on an office PC behind Netskope from a fresh ZIP, without asking IT | colleague installs it alone |
| E4 | Works on a PC with < 16 GB RAM with a physical phone and no Android Studio | Setup all green |
| E5 | 50 runs in a row of one flow: no stuck "running", no orphan Maestro/adb processes | run a suite of 50, then check Task Manager |
| E6 | Unplug the phone mid-run → that job fails with "device disconnected", the rest are skipped, the app stays usable | manual |
| E7 | Every failure shows one sentence a tester understands (no raw stack traces) | review the failures from E2–E6 |
| E8 | No flow is ever changed by opening and saving it in the editor | round-trip test + manual |
| E9 | Record tab ≥ 2 fps over USB on the slowest test phone | `npm run frame-speed` |
| E10 | Two weeks of daily use by colleagues with no open "had to restart" bug | GitHub issues |

## Reporting a bug
Use the GitHub bug template. Always attach: Understudy version, `logs/understudy.log`, phone model + Android version, USB or Wi-Fi, and the flow if it's about writing or running one.
