// views/ChatPage.tsx — chat page shell. Renders the Layout <head> + Svelte 5
// mount targets that hydrate the UI.
//
// Architecture:
//   - AppShell.svelte      header (logo, conn pill, hamburger, attention, settings)
//   - Sessions.svelte      left-slide-in conversations sidebar
//   - Chat.svelte          the entire chat surface (composer, log, WS, etc)
//   - Settings.svelte      centered settings modal (capabilities, model, jobs, …)
//   - ComputerHealth + Connectors hydrate separately, then Settings moves
//     their mount nodes into its Connections section.

import type { FC } from "hono/jsx";
import { Layout, type ThemePref } from "./Layout";
import { SvelteEmbed } from "../../proof/svelte/SvelteEmbed";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import AppShellComponent from "../../proof/svelte/AppShell.ssr.mjs";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import ChatComponent from "../../proof/svelte/Chat.ssr.mjs";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import SessionsComponent from "../../proof/svelte/Sessions.ssr.mjs";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import SettingsComponent from "../../proof/svelte/Settings.ssr.mjs";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import ComputerHealthComponent from "../../proof/svelte/ComputerHealth.ssr.mjs";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import ConnectorsComponent from "../../proof/svelte/Connectors.ssr.mjs";

interface ChatPageProps {
  identityEmail?: string | null;
  /** Worker version id, threaded through to Layout for asset cache-busting. */
  buildId?: string;
  /** Server-resolved theme preference from the `myax-theme` cookie. */
  theme?: ThemePref;
  appOrigin?: string;
}

export const ChatPage: FC<ChatPageProps> = (props) => {
  return (
    <Layout
      title="My Agent Experience"
      identityEmail={props.identityEmail}
      bodyClass="h-dvh overflow-hidden"
      buildId={props.buildId}
      theme={props.theme}
      appOrigin={props.appOrigin}
    >
      <div class="h-full flex flex-col">
        <SvelteEmbed
          component={AppShellComponent}
          hydrateAs="appshell"
          props={{ identityEmail: props.identityEmail ?? null }}
          buildId={props.buildId}
        />
        <div class="flex-1 min-h-0">
          <SvelteEmbed component={ChatComponent} hydrateAs="chat" buildId={props.buildId} />
        </div>
      </div>

      <SvelteEmbed component={SessionsComponent} hydrateAs="sessions" buildId={props.buildId} />
      <SvelteEmbed
        component={SettingsComponent}
        hydrateAs="settings"
        props={{ identityEmail: props.identityEmail ?? null, initialTheme: props.theme ?? "system" }}
        buildId={props.buildId}
      />
      {/* These panels hydrate as separate mounts because svelte-hono SSR does
          not nest component bundles. Settings moves the hydrated nodes into
          its stable Connections slot. */}
      <div id="settings-drawer-extra-mounts" class="hidden" aria-hidden="true">
        <SvelteEmbed component={ComputerHealthComponent} hydrateAs="health" buildId={props.buildId} />
        <SvelteEmbed component={ConnectorsComponent} hydrateAs="connectors" buildId={props.buildId} />
      </div>

      {/* Shared page-scope styles for conversation and tool-result markup. */}
      <style
        dangerouslySetInnerHTML={{
          __html: chatPageStyles,
        }}
      />
    </Layout>
  );
};

/** Page-scope styles shared by the server shell and hydrated chat surface. */
const chatPageStyles = `
  .prompt-card {
    text-align: left;
    background: var(--bg-alt);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px;
    transition: background 120ms, border-color 120ms;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-height: 64px;
  }
  @media (min-width: 640px) { .prompt-card { padding: 14px 16px; gap: 4px; } }
  @media (hover: hover) {
    .prompt-card:hover { background: var(--color-surface-1); border-color: rgba(246,130,31,0.4); }
  }
  .prompt-card:active { background: var(--color-surface-2); border-color: rgba(246,130,31,0.4); }
  .prompt-card__title { color: var(--fg); font-weight: 500; font-size: 13px; }
  .prompt-card__hint { color: var(--fg-mut); font-size: 11px; line-height: 1.4; }

  .msg { width: 100%; max-width: 48rem; min-width: 0; margin: 0 auto 18px; overflow-x: hidden; }
  .msg-head {
    font-size: 11px; font-weight: 500; color: var(--fg-mut);
    margin-bottom: 6px; opacity: 0.85;
    display: flex; align-items: baseline; gap: 8px;
  }
  .msg-user .msg-head__role { color: var(--good); }
  .msg-assistant .msg-head__role { color: var(--brand); }
  .msg-error .msg-head__role { color: var(--bad); }
  .msg-system .msg-head__role { color: var(--fg-mut); }
  .msg-head__ts {
    font-family: 'JetBrains Mono Variable', 'JetBrains Mono', monospace;
    font-size: 10px; font-weight: 400; color: var(--fg-mut);
    opacity: 0.55; font-variant-numeric: tabular-nums;
  }
  .msg-body { min-width: 0; max-width: 100%; font-size: 14px; line-height: 1.55; color: var(--fg); white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
  .msg-assistant .msg-body { white-space: normal; overflow-x: hidden; }
  .msg-assistant .prose { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
  .msg-assistant .prose img, .msg-assistant .prose video, .msg-assistant .prose iframe { max-width: 100%; }
  .msg-assistant .prose table { display: block; max-width: 100%; overflow-x: auto; }
  .msg-assistant .prose pre { max-width: 100%; overscroll-behavior-x: contain; }
  .msg-assistant .msg-body[data-empty="1"] { display: none; }
  .prose, .prose-invert {
    --tw-prose-body: var(--color-fg);
    --tw-prose-headings: var(--color-fg);
    --tw-prose-lead: var(--color-fg);
    --tw-prose-links: var(--color-brand);
    --tw-prose-bold: var(--color-fg);
    --tw-prose-counters: var(--color-fg-mut);
    --tw-prose-bullets: var(--color-fg-mut);
    --tw-prose-hr: var(--color-line);
    --tw-prose-quotes: var(--color-fg-mut);
    --tw-prose-quote-borders: var(--color-line);
    --tw-prose-captions: var(--color-fg-mut);
    --tw-prose-code: var(--color-fg);
    --tw-prose-pre-code: #e9e9ec;
    --tw-prose-pre-bg: #0a0a0a;
    --tw-prose-th-borders: var(--color-line);
    --tw-prose-td-borders: var(--color-line);
  }
  .msg-user .msg-body {
    background: rgba(74, 222, 128, 0.06);
    border: 1px solid rgba(74, 222, 128, 0.18);
    border-radius: 10px; padding: 10px 14px;
  }
  .connector-banner {
    display: flex; align-items: center; gap: 12px; padding: 10px 14px;
    margin: 8px 12px 0; border-radius: 10px; font-size: 13px; color: var(--fg);
  }
  .connector-banner[data-state="needs-auth"],
  .connector-banner[data-state="upstream-auth"] {
    border: 1px solid rgba(244, 63, 94, 0.45);
    background: rgba(244, 63, 94, 0.10);
  }
  .connector-banner__dot {
    width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%;
    background: rgb(244, 63, 94);
    box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.20);
  }
  .connector-banner__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .connector-banner__title { font-weight: 600; color: var(--fg); }
  .connector-banner__hint { color: var(--fg-mut); font-size: 11px; line-height: 1.35; }
  .connector-banner__cta {
    flex-shrink: 0; padding: 8px 14px; border-radius: 6px; font-size: 12px;
    font-weight: 600; text-decoration: none; min-height: 36px;
    display: inline-flex; align-items: center;
    background: rgb(244, 63, 94); color: #fff;
  }
  @media (min-width: 640px) {
    .connector-banner { margin: 12px 24px 0; }
    .connector-banner__cta { padding: 8px 18px; }
  }

  .agent-thinking__dot {
    display: inline-block; width: 6px; height: 6px; border-radius: 50%;
    background: var(--brand); opacity: 0.5;
    animation: thinking-pulse 1.2s ease-in-out infinite;
  }
  .agent-thinking__dot:nth-child(2) { animation-delay: 0.15s; }
  .agent-thinking__dot:nth-child(3) { animation-delay: 0.3s; }
  @keyframes thinking-pulse {
    0%, 60%, 100% { opacity: 0.3; transform: scale(0.85); }
    30% { opacity: 1; transform: scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-thinking__dot { animation: none; opacity: 0.6; }
  }

  .msg-system .msg-body, .msg-error .msg-body {
    color: var(--fg-mut); font-size: 12px;
    background: var(--color-surface-1); border: 1px solid var(--line);
    border-radius: 8px; padding: 8px 12px; line-height: 1.5;
  }
  .msg-error .msg-body {
    background: rgba(239, 68, 68, 0.06);
    border-color: rgba(239, 68, 68, 0.2); color: #fca5a5;
  }

  .prose-invert :where(p) { margin: 0.5em 0; }
  .prose-invert :where(h1,h2,h3,h4) { color: var(--fg); margin: 1em 0 0.4em; line-height: 1.3; font-weight: 600; }
  .prose-invert :where(h1) { font-size: 1.35em; }
  .prose-invert :where(h2) { font-size: 1.18em; }
  .prose-invert :where(h3) { font-size: 1.06em; }
  .prose-invert :where(h4) { font-size: 1em; }
  .prose-invert :where(ul,ol) { padding-inline-start: 1.25em; margin: 0.5em 0; list-style-position: outside; }
  .prose-invert :where(ul) { list-style-type: disc; }
  .prose-invert :where(ol) { list-style-type: decimal; }
  .prose-invert :where(li) { margin: 0.25em 0; padding-inline-start: 0.25em; }
  .prose-invert :where(li)::marker { color: var(--fg-mut); }
  .prose-invert :where(li > p) { margin: 0; }
  .prose-invert :where(a) {
    color: var(--brand); text-decoration: underline;
    text-underline-offset: 2px; text-decoration-thickness: 1px;
  }
  .prose-invert :where(a:hover) { text-decoration-thickness: 2px; }
  .prose-invert :where(code):not(pre code) {
    background: var(--color-surface-2); padding: 1px 5px; border-radius: 3px;
    font-size: 0.92em; font-family: 'JetBrains Mono Variable', monospace;
  }
  .prose-invert :where(strong) { color: var(--fg); font-weight: 600; }
  .prose-invert :where(em) { color: var(--fg); }
  .prose-invert :where(blockquote) {
    border-left: 3px solid var(--line); padding-left: 12px;
    color: var(--fg-mut); margin: 0.6em 0;
  }
  .prose-invert :where(hr) { border: none; border-top: 1px solid var(--line); margin: 1em 0; }
  .prose-invert :where(table) { border-collapse: collapse; margin: 0.6em 0; font-size: 0.93em; }
  .prose-invert :where(th, td) { border: 1px solid var(--line); padding: 6px 10px; text-align: left; }
  .prose-invert :where(th) { background: var(--color-surface-1); font-weight: 600; }

  .code-copy-btn {
    position: absolute; top: 6px; right: 6px;
    background: var(--color-surface-2); color: var(--fg-mut);
    border: 1px solid var(--line); border-radius: 4px;
    font-size: 10px; padding: 2px 8px; cursor: pointer;
  }
  .code-copy-btn:hover { color: var(--fg); background: var(--color-surface-3); }

  .msg-tools { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
  .tool-call {
    background: var(--bg-alt); border: 1px solid var(--line); border-radius: 8px;
    overflow: hidden; font-size: 12px;
  }
  /* Grouped run of consecutive tool calls: one shared border + radius, no
     gap between rows, hairline dividers between them. */
  .msg-tools--group {
    gap: 0;
    border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
    background: var(--bg-alt);
  }
  .msg-tools--group .tool-call {
    border: 0; border-radius: 0; background: transparent;
  }
  .msg-tools--group .tool-call + .tool-call { border-top: 1px solid var(--line); }
  .tool-call__summary {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; cursor: pointer; list-style: none;
    color: var(--fg-mut); font-family: 'JetBrains Mono Variable', monospace;
  }
  .tool-call__summary::-webkit-details-marker { display: none; }
  .tool-call__pip { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); flex-shrink: 0; }
  .tool-call[data-state="done"] .tool-call__pip { background: var(--good); }
  .tool-call[data-state="error"] .tool-call__pip { background: var(--bad); }
  .tool-call__name { color: var(--fg); }
  .tool-call__args { color: var(--fg-mut); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool-call__elapsed { color: var(--fg-mut); font-size: 10px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; flex-shrink: 0; }
  .tool-call[data-state="done"] .tool-call__elapsed,
  .tool-call[data-state="error"] .tool-call__elapsed { opacity: 0.7; }
  .tool-call__status { color: var(--fg-mut); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  .tool-call[data-state="done"] .tool-call__status { color: var(--good); }
  .tool-call[data-state="error"] .tool-call__status { color: var(--bad); }
  .tool-call__argsfull, .tool-call__result {
    background: var(--color-surface-3); border-top: 1px solid var(--line);
    padding: 8px 12px; font-family: 'JetBrains Mono Variable', monospace;
    font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
    color: var(--fg); max-height: 320px; overflow: auto;
  }
  .tool-call__argsfull { color: var(--fg-mut); font-size: 10px; max-height: 100px; }
  .tool-call__inline-image {
    display: block;
    box-sizing: border-box;
    width: 100%;
    max-height: 32rem;
    object-fit: contain;
    background: #0a0a0a;
    border-top: 1px solid var(--line);
  }
  .tool-call__inline-video {
    display: block;
    box-sizing: border-box;
    width: 100%;
    max-height: 32rem;
    background: #0a0a0a;
    border-top: 1px solid var(--line);
  }

  .msg-user[data-pending="1"] .msg-body { opacity: 0.75; }
  .msg-user[data-pending="0"] .msg-body { opacity: 1; transition: opacity 120ms; }

`;
