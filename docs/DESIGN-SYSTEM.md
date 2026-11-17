# Design system

The look is **Bench**: the app as a piece of test equipment. A cool neutral panel, hairlines instead of cards, the machine's words in a fixed-width face, one gold lamp. A second style, **Studio**, keeps every rule and changes the mood: a graphite sidebar and panels with depth. The Style button at the bottom of the sidebar switches between them; light and dark work in both.

The full system (tokens, components, logo, the reasons) lives in the Understudy design system. This page is the short version for whoever edits `app/styles.src.css`.

## The rules

1. **Rules, not cards.** Panels are divided by 1px `--line`. Only things that float (menus, dialogs, toasts) have a shadow. Studio adds `--panel-shadow`.
2. **One gold button per screen.** `.btn.solid` once per screen and once per dialog. Everything else is `.btn` (secondary) or `.btn.quiet` (text).
3. **People's words in sans, the machine's words in mono.** Ids, package names, selectors, YAML, paths, row numbers and durations use `--mono`.
4. **Show the next step, hide the rest.** A panel with nothing in it is not drawn (Run flows before a run). Options changed once a week live in a menu (View on Record).
5. **Say it once.** No label above a title, no helper sentence under a clear label, no placeholder for a feature that is not built.

## The scale

| What | Values |
|---|---|
| Type | 12px label · 13px body · 15px heading · 20px title. Weight 400 to read, 500 to press, 600 for names. |
| Radius | `--radius-sm` 3px on anything you operate · `--radius` 6px on anything that contains (Studio: 5px and 10px). |
| Control height | `--ctl` 32px (Studio 34px). In-row buttons (`.btn.mini`) 28px. |
| Buttons | primary `.btn.solid` · secondary `.btn` · text `.btn.quiet` (`.ghost` and `.dashed` look the same). |

## Colour tokens

| Token | Light | Dark | Use for |
|---|---|---|---|
| `--bg` | `#f4f5f6` | `#0f1113` | window background |
| `--surface` / `--surface-2` / `--surface-3` | `#ffffff` / `#f1f2f4` / `#e9ebee` | `#16191c` / `#1d2125` / `#262b30` | panels / hover, wells / selected, tracks |
| `--ink` / `--mute` / `--dim` | `#14171a` / `#454c55` / `#626a74` | `#eceef0` / `#b4bac2` / `#8f96a0` | text in falling importance (all 4.5:1) |
| `--line` / `--line2` | `#d9dce0` / `#858c95` | `#2a2f35` / `#69717b` | hairlines / control borders |
| `--accent` / `--on-accent` | `#e0a526` / `#14171a` | `#f0b93a` / `#14171a` | the one primary button: a fill only |
| `--spot` / `--spot-ink` | `#b07a12` / `#8a5a00` | `#f0b93a` | gold as a marker / as text (data-driven values, active tab) |
| `--ok` / `--danger` / `--warn` | `#1b7447` / `#b8322a` / `#8a5d00` | `#4cc38a` / `#f2766b` / `#e2b341` | states only, always with a word or an icon |
| `--stage` | `#101215` | `#08090a` | the bench behind the phone on Record |

Studio overrides a few of these under `html.style-studio` (and `.side` inside it): see the top of `styles.src.css`.

## Motion

- **Press:** a control sinks to 95% in 80ms and springs back past its size (`--spring`) when released.
- **Pull:** a list pushed past its first or last row gives up to 34px, resists more the further it goes, and springs back (`src/core/motion.ui.js`).
- **Numbers** count to their new value (`.kv`, `.count`, `.stat` and anything with `data-num`).
- **Change:** screens, panels and menus ease in over 180 to 360ms (`--ease`). State colours cross-fade.
- Everything is off under `prefers-reduced-motion`.

## Icons and logo

One icon set: 24px grid, 1.7px stroke, round joins, no fill (`.ico`, or any `svg` inside `.btn`). Text glyphs are not icons. The logo is `assets/logo.svg`: flat, no gradient or shadow.

## Building the stylesheet

`app/styles.css` is built from `app/styles.src.css` with the Tailwind CLI 3.4.17 (see `app/tailwind.config.js`). Rebuild after editing the source or adding Tailwind classes to `index.html`.
