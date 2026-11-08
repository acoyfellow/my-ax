<script lang="ts">
  import { untrack } from "svelte";
  import type { ActiveToken, Command } from "../commands/registry";
  import { chooseItem, KIND_LABEL, menuKey, tokenAt, type MenuItem, type MentionOption, type Replacement } from "./slash-menu-state";

  type Props = {
    input: HTMLTextAreaElement | undefined;
    text: string;
    sessionId: string | null;
    onReplace: (replacement: Replacement) => void;
    onRun: (command: Command) => void;
  };

  let { input, text, sessionId, onReplace, onRun }: Props = $props();

  let token = $state<ActiveToken | null>(null);
  let items = $state<MenuItem[]>([]);
  let index = $state(0);
  let loading = $state(false);
  let dismissedAt = $state<number | null>(null);
  let commandCache: Command[] | null = null;
  let commandsEnabled = true;
  let mentionTimer: ReturnType<typeof setTimeout> | undefined;
  let mentionSeq = 0;

  const open = $derived(token !== null && dismissedAt !== token.start);

  async function loadCommands(): Promise<Command[]> {
    if (commandCache) return commandCache;
    const response = await fetch("/api/commands?limit=200", { credentials: "include" });
    const body = await response.json().catch(() => null);
    commandsEnabled = body?.result?.enabled !== false;
    commandCache = Array.isArray(body?.result?.commands) ? body.result.commands : [];
    return commandCache;
  }

  function filterCommands(all: Command[], query: string): Command[] {
    const q = query.toLowerCase();
    if (!q) return all.slice(0, 40);
    return all
      .map((command) => ({ command, rank: command.trigger.startsWith(q) ? 3 : command.trigger.includes(q) ? 2 : `${command.title} ${command.description}`.toLowerCase().includes(q) ? 1 : 0 }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank || b.command.score - a.command.score)
      .slice(0, 40)
      .map((entry) => entry.command);
  }

  async function refreshItems(current: ActiveToken) {
    if (current.kind === "slash") {
      loading = commandCache === null;
      const all = await loadCommands().catch(() => []);
      loading = false;
      if (!commandsEnabled) { token = null; return; }
      items = filterCommands(all, current.query).map((command) => ({ kind: "command", command }));
      index = 0;
      return;
    }
    clearTimeout(mentionTimer);
    const seq = ++mentionSeq;
    mentionTimer = setTimeout(async () => {
      loading = true;
      const params = new URLSearchParams({ q: current.query });
      if (sessionId) params.set("sessionId", sessionId);
      const response = await fetch(`/api/mentions?${params}`, { credentials: "include" }).catch(() => null);
      const body = await response?.json().catch(() => null);
      if (seq !== mentionSeq) return;
      loading = false;
      const mentions: MentionOption[] = Array.isArray(body?.result?.mentions) ? body.result.mentions : [];
      items = mentions.map((mention) => ({ kind: "mention", mention }));
      index = 0;
    }, 120);
  }

  $effect(() => {
    const current = text;
    const element = input;
    if (!element) return;
    untrack(() => syncToken(tokenAt(current, element.selectionStart ?? current.length)));
  });

  function sameToken(a: ActiveToken | null, b: ActiveToken | null) {
    return a === b || (a !== null && b !== null && a.kind === b.kind && a.start === b.start && a.end === b.end && a.query === b.query);
  }

  function syncToken(next: ActiveToken | null) {
    if (!next) {
      if (token !== null) token = null;
      if (dismissedAt !== null) dismissedAt = null;
      if (items.length) items = [];
      return;
    }
    if (sameToken(token, next)) return;
    if (token && (token.kind !== next.kind || token.start !== next.start)) dismissedAt = null;
    token = next;
    if (dismissedAt !== next.start) void refreshItems(next);
  }

  export function invalidate() {
    commandCache = null;
  }

  async function recordUse(command: Command) {
    await fetch("/api/commands/usage", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: command.id, kind: command.kind }) }).catch(() => undefined);
  }

  function choose(item: MenuItem) {
    if (!token) return;
    const outcome = chooseItem(item, text, token);
    if (item.kind === "command") void recordUse(item.command);
    token = null;
    items = [];
    if (outcome.type === "run") onRun(outcome.command);
    else onReplace(outcome.replacement);
  }

  export function handleKey(event: KeyboardEvent): boolean {
    if (!open || !token) return false;
    const result = menuKey(event.key, index, items.length);
    if (!result.handled) return false;
    event.preventDefault();
    index = result.index;
    if (result.close) dismissedAt = token.start;
    if (result.choose && items[index]) choose(items[index]);
    return true;
  }

  function label(item: MenuItem) {
    return item.kind === "command" ? `/${item.command.trigger}` : `@${item.mention.label}`;
  }

  function detail(item: MenuItem) {
    return item.kind === "command" ? (item.command.available ? item.command.description : item.command.unavailableReason ?? "") : item.mention.detail;
  }

  function badge(item: MenuItem) {
    return KIND_LABEL[item.kind === "command" ? item.command.kind : item.mention.kind];
  }
</script>

{#if open}
  <div class="slash-menu" role="listbox" aria-label={token?.kind === "slash" ? "Commands" : "Mentions"} data-testid="slash-menu" data-kind={token?.kind}>
    {#if loading && items.length === 0}
      <div class="slash-menu__empty">Loading…</div>
    {:else if items.length === 0}
      <div class="slash-menu__empty">{token?.kind === "slash" ? "No matching command" : "No matching file, chat or skill"}</div>
    {:else}
      {#each items as item, itemIndex (item.kind === "command" ? item.command.id : `${item.mention.kind}:${item.mention.ref}`)}
        <button
          type="button"
          role="option"
          class="slash-menu__item"
          aria-selected={itemIndex === index}
          data-unavailable={item.kind === "command" && !item.command.available ? "1" : undefined}
          onmousedown={(event) => { event.preventDefault(); choose(item); }}
          onmouseenter={() => (index = itemIndex)}
        >
          <span class="slash-menu__label">{label(item)}</span>
          <span class="slash-menu__detail">{detail(item)}</span>
          <span class="slash-menu__badge">{badge(item)}</span>
        </button>
      {/each}
    {/if}
    <div class="slash-menu__hint">↑↓ to move · Enter to {token?.kind === "slash" ? "run or insert" : "tag"} · Esc to close</div>
  </div>
{/if}

<style>
  .slash-menu {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 6px);
    max-height: min(320px, 45vh);
    overflow-y: auto;
    z-index: 40;
    border: 1px solid var(--color-line, rgba(127, 127, 127, 0.25));
    border-radius: 10px;
    background: var(--color-surface, var(--color-bg, #fff));
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
    padding: 4px;
  }
  .slash-menu__item {
    display: grid;
    grid-template-columns: minmax(7rem, max-content) 1fr auto;
    gap: 10px;
    align-items: baseline;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: inherit;
  }
  .slash-menu__item[aria-selected="true"] {
    background: var(--color-surface-2, rgba(127, 127, 127, 0.14));
  }
  .slash-menu__item[data-unavailable] {
    opacity: 0.5;
  }
  .slash-menu__label {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-weight: 600;
  }
  .slash-menu__detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.7;
  }
  .slash-menu__badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.55;
  }
  .slash-menu__empty,
  .slash-menu__hint {
    padding: 6px 8px;
    font-size: 11px;
    opacity: 0.6;
  }
  .slash-menu__hint {
    border-top: 1px solid var(--color-line, rgba(127, 127, 127, 0.2));
    margin-top: 4px;
  }
</style>
