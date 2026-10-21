# User guide

For testers. Five tasks, start to finish. The README has the full reference (every menu action, YAML examples).

## 1. First start
1. Install **Node.js LTS** from nodejs.org (once).
2. Unzip Understudy anywhere you can write (e.g. `Documents\Understudy`), double-click **Understudy.vbs**.
3. First start installs its parts (about a minute). On a company network this works through Netskope/Zscaler automatically; if not, see `TROUBLESHOOTING.md`.
4. Open **Setup**. Everything marked *required* must be green: Node, Java, Maestro, Phone tools. **Install phone tools** is one button (8 MB). Android Studio is **not** needed for a real phone.

## 2. Connect a phone
**USB (fastest, recommended):** on the phone turn on *Developer options › USB debugging*, plug it in, tap **Allow** on the phone. In Understudy: **Record › Add device**; the phone appears in a few seconds.

**Wi-Fi:** phone and PC on the same Wi-Fi.
- Already on USB? Press **Switch the USB phone to Wi-Fi**, wait for "connected", then unplug.
- Android 11+: *Wireless debugging › Pair with QR code* and scan the code Understudy shows, or **Pair with a 6-digit code**.
- If it fails, **Check connection** says why in one sentence.

Tick **Turn off phone animations** while recording: elements are found more reliably. They come back on when you disconnect or quit.

## 3. Record a flow
1. Pick the app (installed apps list) and press **Launch app**.
2. Name the flow (`Login/login_valid.yaml`) and add tags (`smoke, login`).
3. In **Record** mode, **click an element** on the screen: a menu opens. Choose Tap, Type text, Check it is visible ... The action is recorded **and** done on the phone.
4. For typed values choose **This exact text** or **From Excel** (a column is suggested; the value goes into `TestData/<App>Data.xlsx`).
5. Look at the **YAML** tab any time; you can edit it directly and the steps follow.
6. **Save flow** (or **Save and run**).

Tips: prefer elements found by **ID** (marked *unique*). If an element has no ID, ask developers to add one; screen positions break when layouts change. `Ctrl+Z` removes the last step.

## 4. Run flows with test data
1. **Test data** tab: one row per test case; row 1 is column names.
2. **Run flows** tab: tick flows, type the rows (`all`, `2-5`, `1,4,9`; empty = row 1), press **Run**.
3. Watch live steps. **Stop** ends the run.
4. Save a set of flows + rows as a **Suite** to run it again with one click.
5. A failed step: open it in **Reports**, fix the flow, and use **Run from step** to retry from there with the data still loaded.

## 5. Read the results
- **Reports**: every run, every step, failure screenshots. Each run is also a single HTML file in `Reports/` you can email.
- **Dashboard**: pass rate over time, slowest flows, **flaky** flows (pass and fail with no change), compare two runs.

## Projects
One Understudy install, many projects (one per app or team). **Projects** in the sidebar: create, open, switch. A project is a normal folder with `Flows/`, `TestData/`, `Reports/` ...: back it up or put it in Git.

## Quit
Use **Quit** in the app (it restores the phone's animations). Closing the window also stops Understudy after a few minutes when nothing is running.
