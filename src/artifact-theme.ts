export const ARTIFACT_THEME_CSS = `
:root {
  color-scheme: dark;
  --bg: #0b1118;
  --bg-alt: #111a24;
  --line: rgba(181, 198, 211, 0.13);
  --fg: #f7f9fb;
  --fg-mut: #9baaba;
  --brand: #f6821f;
  --good: #4ade80;
  --warn: #fbbf24;
  --bad: #ef4444;
  --surface-1: rgba(255, 255, 255, 0.04);
  --surface-2: rgba(255, 255, 255, 0.06);
  --surface-3: rgba(255, 255, 255, 0.10);
  --radius: 10px;
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "IBM Plex Mono", "SF Mono", Menlo, monospace;
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #ffffff;
  --bg-alt: #f6f6f8;
  --line: rgba(0, 0, 0, 0.10);
  --fg: #0a0a0a;
  --fg-mut: #5a5a62;
  --brand: #c4640d;
  --good: #15803d;
  --warn: #b45309;
  --bad: #b91c1c;
  --surface-1: rgba(0, 0, 0, 0.04);
  --surface-2: rgba(0, 0, 0, 0.06);
  --surface-3: rgba(0, 0, 0, 0.10);
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font-family: var(--font-sans); font-size: 14px; line-height: 1.5; }
h1 { font-size: 1.25rem; font-weight: 650; margin: 0 0 0.75rem; letter-spacing: -0.01em; }
h2 { font-size: 1rem; font-weight: 600; margin: 0 0 0.5rem; }
h3 { font-size: 0.875rem; font-weight: 600; margin: 0 0 0.375rem; color: var(--fg-mut); }
p { margin: 0 0 0.75rem; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
ul, ol { margin: 0; padding: 0; list-style: none; }
code, pre { font-family: var(--font-mono); font-size: 0.8125rem; }
pre { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius); padding: 0.75rem; overflow: auto; }
button, .btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem;
  min-height: 34px; padding: 0 0.75rem;
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface-1); color: var(--fg);
  font-family: inherit; font-size: 0.8125rem; font-weight: 550;
  cursor: pointer; transition: background 120ms ease, border-color 120ms ease;
}
button:hover, .btn:hover { background: var(--surface-2); }
button:active, .btn:active { background: var(--surface-3); }
button:disabled, .btn:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary, .btn-primary { background: var(--brand); border-color: transparent; color: #fff; }
button.primary:hover, .btn-primary:hover { filter: brightness(1.08); background: var(--brand); }
button.ghost, .btn-ghost { background: transparent; border-color: transparent; color: var(--fg-mut); }
button.ghost:hover, .btn-ghost:hover { background: var(--surface-1); color: var(--fg); }
input, textarea, select {
  width: 100%; min-height: 34px; padding: 0.4rem 0.6rem;
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--bg-alt); color: var(--fg);
  font-family: inherit; font-size: 0.8125rem;
}
input:focus, textarea:focus, select:focus { outline: none; border-color: var(--brand); }
input::placeholder, textarea::placeholder { color: var(--fg-mut); }
label { display: block; font-size: 0.75rem; font-weight: 550; color: var(--fg-mut); margin-bottom: 0.25rem; }
textarea { min-height: 68px; resize: vertical; }
table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
th, td { text-align: left; padding: 0.5rem 0.625rem; border-bottom: 1px solid var(--line); }
th { color: var(--fg-mut); font-weight: 550; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
.card { background: var(--bg-alt); border: 1px solid var(--line); border-radius: var(--radius); padding: 0.75rem; }
.pill { display: inline-flex; align-items: center; padding: 0.0625rem 0.5rem; border: 1px solid var(--line); border-radius: 999px; font-size: 0.6875rem; font-weight: 550; color: var(--fg-mut); }
.pill-good { color: var(--good); border-color: color-mix(in srgb, var(--good) 45%, var(--line)); background: color-mix(in srgb, var(--good) 12%, transparent); }
.pill-warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, var(--line)); background: color-mix(in srgb, var(--warn) 12%, transparent); }
.pill-bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); background: color-mix(in srgb, var(--bad) 12%, transparent); }
.pill-brand { color: var(--brand); border-color: color-mix(in srgb, var(--brand) 50%, var(--line)); background: color-mix(in srgb, var(--brand) 12%, transparent); }
.row { display: flex; align-items: center; gap: 0.5rem; }
.col { display: flex; flex-direction: column; gap: 0.5rem; }
.between { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.wrap { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.grow { flex: 1; min-width: 0; }
.stack > * + * { margin-top: 0.5rem; }
.pad { padding: 0.875rem; }
.muted { color: var(--fg-mut); }
.small { font-size: 0.75rem; }
.mono { font-family: var(--font-mono); }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scroll { overflow: auto; min-height: 0; }
.divide > * + * { border-top: 1px solid var(--line); }
.hidden { display: none; }
`;
