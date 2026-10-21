# Releasing

## Versions
`MAJOR.MINOR.PATCH`, the same number in `package.json` and `app.config.json`.
- **PATCH** (2.0.1): bug fixes only.
- **MINOR** (2.1.0): new abilities, nothing a user must relearn.
- **MAJOR** (3.0.0): stable milestone, or a change that breaks old flows / projects.

A version that is not ready stays as **Unreleased** at the top of `CHANGELOG.md`. Don't skip numbers again (1.2.0 was never released); publish small releases often instead.

## Branches
- `main` always works: `npm run check` passes.
- Work on `fix/<short-name>` or `feat/<short-name>`, merge into `main` when the check passes.
- One subject per commit: "Split recorder.ui.js: value dialog" not "updates".

## Release steps
1. `npm run check` → all pass.
2. Manual smoke test (`TESTING.md` section 2) on at least one phone. For a MAJOR, the full exit criteria.
3. Move the **Unreleased** notes in `CHANGELOG.md` under the new version and date. Write for testers: what changed for them, not which file.
4. Set the version in `package.json` and `app.config.json`.
5. Update `FILE-MAP.md` / `ARCHITECTURE.md` if files moved.
6. Commit "Release x.y.z", tag `vx.y.z`, push.
7. GitHub release: attach a ZIP **with `node_modules` included** for PCs that can't run npm (company networks).
8. Update `website/` if screenshots or features changed (Vercel deploys from it).

## Rollback
Every release is a tag. If a release breaks, colleagues unzip the previous release's ZIP over a fresh folder; their projects (Flows, TestData ...) live in the project folder and are not touched.
