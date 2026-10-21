# TestData

Put your **Excel test data** (`.xlsx`) here. Subfolders are fine.

- **Row 1 = column names** (e.g. `email`, `password`, `expected`). Each following row is one test case.
- **Each sheet** becomes a data script: `Scripts/<Excel file name>/<Sheet name>.js`.
- In a flow, load it with `runScript` and use `${output.<column name>}` (case-sensitive).
- Blank columns and completely blank rows are ignored. Cells are read as the text Excel shows.
- Keep workbook names unique, even across subfolders.
- After editing a file in Excel, press **Prepare Data** in the app (the app's own editor has **Save & Prepare Data**).

`ExampleData.xlsx` belongs to the example flow in `Flows/examples/`. Delete both when you add your own.
