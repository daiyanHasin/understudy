# Third-Party Notices

Understudy is proprietary software (see [LICENSE](LICENSE)).
It builds on, or works together with, the following third-party projects.
Each remains under its own license, and those licenses govern those parts.

---

## Maestro Excel Data-Driven Framework

- **Author:** Md. Mohai Minul Islam ([@mohai17](https://github.com/mohai17))
- **Source:** https://github.com/mohai17/Maestro-Excel-Data-Driven-Framework
- **License:** Apache License 2.0. Full text in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)
- **Copyright:** Copyright 2026 Md. Mohai Minul Islam

**How it is used:** Understudy started from this framework. It kept
its core idea of converting Excel sheets into JavaScript data providers that
Maestro flows load with `runScript` and read through `${output.<column>}`, and
its `TestData/`, `JsonData/`, `Scripts/`, `Flows/` and `Reports/` layout.

**Changes made** (as required by Apache 2.0, section 4b): the conversion was
rewritten (`lib/prepare.js`) to embed data directly in the generated scripts
instead of serving it through a local JSON server; per-sheet row variables and
row selection were added; the batch-file workflow was replaced by a web GUI and
Node.js server; and new modules were added for live steps, suites, history,
dashboards and editors. Files containing derived portions say so in their header.

---

## Maestro

- **Owner:** mobile.dev, Inc.
- **Source:** https://github.com/mobile-dev-inc/maestro · https://maestro.mobile.dev
- **License:** Apache License 2.0

**How it is used:** Maestro is **not included** in this repository. Users
install the Maestro CLI themselves; Understudy starts it as an
external program (`maestro test ...`) and reads the reports and logs it writes.
Understudy is not affiliated with or endorsed by mobile.dev.
"Maestro" is used only to describe compatibility.

---

## Libraries installed through npm

| Package | License | Purpose |
|---|---|---|
| [SheetJS Community Edition (`xlsx`)](https://sheetjs.com) | Apache-2.0 | Reading Excel test data |
| [ExcelJS (`exceljs`)](https://github.com/exceljs/exceljs) | MIT | Editing Excel files while keeping formatting |
| [yaml](https://github.com/eemeli/yaml) | ISC | Reading flows edited in the recorder's Flow panel |

These packages and their dependencies are downloaded by `npm install` and are
not part of this repository. Their license files are in `node_modules/<package>/`.

---

## Fonts

The UI requests **Inter** and **JetBrains Mono** from Google Fonts (SIL Open
Font License 1.1) when online, and falls back to system fonts when offline.

---

## Fonts used by the documentation website

| Font | License |
|---|---|
| Inter | SIL Open Font License 1.1 |
| Instrument Serif | SIL Open Font License 1.1 |
| JetBrains Mono | SIL Open Font License 1.1 |
