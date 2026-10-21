# Design system

The look: **porcelain and ink with a brass accent**, a paper-light sidebar, a dark dot-grid stage around the phone. Professional and calm: one accent colour, no gradients, no shadows except on pop-ups. Everything is defined as tokens at the top of `app/styles.css`; use the token, never a raw colour.

## Colour tokens
| Token | Light | Dark | Use for |
|---|---|---|---|
| `--bg` | `#f5f5f2` | `#111316` | page background |
| `--surface` / `--surface-2` | `#ffffff` / `#f0f0ec` | `#17191d` / `#1e2025` | cards, panels / sunken areas |
| `--ink` | `#17191e` | `#ecebe7` | text, primary buttons |
| `--mute` / `--dim` | `#50545c` / `#8a8d93` | `#a9aaa6` / `#75777b` | secondary text / hints |
| `--line` / `--line2` | `#e3e2dd` / `#cfcec8` | `#2a2c31` / `#383a40` | borders / stronger borders |
| `--accent`, `--accent-2`, `--accent-soft`, `--on-accent` | ink tones | light tones | primary action and its hover/background/text |
| `--spot`, `--spot-ink`, `--spot-soft` | brass `#a97a2c` | `#d2a458` | the one highlight: selection, active tab, recording |
| `--stage` | `#121417` | `#0b0c0e` | area around the phone screen |
| `--rail`, `--rail-ink`, `--rail-dim`, `--rail-hi` | paper | dark | sidebar |
| `--ok` / `--warn` / `--danger` / `--info` (+ `-soft`) | green / amber / red / blue | lighter | status only: pass, warning, fail, note |

Rules: brass (`--spot`) appears **once** per screen area. Status colours are only for status. Text on colour uses the matching `-ink` / `--on-accent`.

## Type
| Token | Font | Use |
|---|---|---|
| `--sans` | Hanken Grotesk (400/500/600) | everything by default |
| `--display` | Source Serif 4 (500/600) | page titles, empty states, the logo line |
| `--mono` | JetBrains Mono (400/500) | YAML, IDs, selectors, logs |

Fonts are bundled in `assets/fonts/` (works offline). Two weights per screen at most.

## Shape and spacing
- `--radius: 8px` for cards and dialogs, `--radius-sm: 6px` for controls.
- `--ctl: 32px` control height: buttons, inputs, selects all line up.
- `--shadow-pop` only on things that float (menus, dialogs, toasts).
- Spacing in steps of 4 px (4, 8, 12, 16, 24, 32).

## Components (classes in `styles.css`)
`.btn` (variants: `solid` primary action, `ghost`, `quiet`, `icon`, `mini`, `big`, `stop`), `.field`, `.chip`, `.badge`, `.card`, `.menu` / `.menupop`, `.tablebox`, `.toast`; dialogs through `modal()` and toasts through `toast(msg, kind)` in `app/app.js`.

## Writing in the interface
- Say what happened and what to do: "The phone is not on Wi-Fi. Connect it to the same Wi-Fi as this PC and try again."
- Tester words, not developer words: "phone", "screen", "step"; not "serial", "node", "exception".
- Buttons are verbs: Record, Run, Save, Connect.

## Light and dark
`html.theme-dark` swaps the tokens; nothing else changes. Check every new screen in both.
