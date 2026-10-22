/* Understudy - Copyright (c) 2026 Hasin Md. Daiyan. All rights reserved. See LICENSE. */
/*
  Builds app/styles.css from app/styles.src.css. Neither this file nor styles.src.css is served
  to the browser (src/server/static.js only serves /styles.css from app/).

  No npm needed: download the standalone Tailwind CLI v3.4.17 (tailwindcss-windows-x64.exe,
  github.com/tailwindlabs/tailwindcss/releases/tag/v3.4.17) and run, from the project folder:

    tailwindcss -c app/tailwind.config.js -i app/styles.src.css -o app/styles.css
    (add --watch while editing)

  Colors point at the CSS variables in styles.src.css, so every utility follows light/dark mode.
*/
module.exports = {
  content: { relative: true, files: ["./index.html", "./app.js", "../src/**/*.ui.js"] },
  darkMode: ["class", "html.theme-dark"],
  corePlugins: { preflight: false },   // script-built markup keeps its own browser defaults
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        rail: "var(--rail)",
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)", 3: "var(--surface-3)" },
        ink: "var(--ink)",
        mute: "var(--mute)",
        dim: "var(--dim)",
        line: { DEFAULT: "var(--line)", 2: "var(--line2)" },
        gold: { DEFAULT: "var(--spot)", ink: "var(--spot-ink)", soft: "var(--spot-soft)" },
        ok: { DEFAULT: "var(--ok)", soft: "var(--ok-soft)" },
        warn: { DEFAULT: "var(--warn)", soft: "var(--warn-soft)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)" },
      },
      borderColor: { DEFAULT: "var(--line)" },
      fontFamily: { sans: ["var(--sans)"], mono: ["var(--mono)"] },
      borderRadius: { panel: "var(--radius)", ctl: "var(--radius-sm)" },
    },
  },
};
