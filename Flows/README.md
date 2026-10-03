# Flows

Put your **Maestro flows** (`.yaml`) here. Subfolders are fine; they appear as groups in the app.

- Record or write flows in **Maestro Studio** (needs a connected device), then save them here.
- To use Excel data, add one line and use the columns:

```yaml
- runScript: "../Scripts/<Excel file name>/<Sheet name>.js"   # relative to THIS flow file
- inputText: ${output.email}
```

- Add `tags:` to group flows (they become one-click chips in the app):

```yaml
appId: com.example.app
tags:
  - smoke
  - login
---
```

- Shared steps (like login) can live in a sub-folder such as `common/` and be called with `runFlow: common/login.yaml`.

`examples/` contains a working example for the Wikipedia Android app (`org.wikipedia`). Delete it when you add your own flows.
