<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { Command } from "../commands/registry";
  import { runCommand } from "./command-runner";
  import { KIND_LABEL, menuKey } from "./slash-menu-state";
  import { readTabSession } from "@my-ax/store";

  let open = $state(false);
  let query = $state("");
  let commands = $state<Command[]>([]);
  let index = $state(0);
  let inputEl = $state<HTMLInputElement | undefined>(undefined);
  let loadSeq = 0;

  function sessionId() {
    return readTabSession() || null;
  }

  async function load() {
    const seq = ++loadSeq;
    const response = await fetch(`/api/commands?limit=60&q=${encodeURIComponent(query)}`, { credentials: "include" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (seq !== loadSeq) return;
    commands = body?.result?.enabled === false ? [] : (body?.result?.commands ?? []);
    index = 0;
  }

  async function show() {
    open = true;
    query = "";
    await load();
    await tick();
    inputEl?.focus();
  }

  function hide() {
    open = false;
  }

  function sendToComposer(text: string) {
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
    if (!textarea) return;
    textarea.value = text;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  }

  async function choose(command: Command) {
    hide();
    await fetch("/api/commands/usage", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: command.id, kind: command.kind }) }).catch(() => undefined);
    if (!command.runsOnEnter || !command.available) {
      sendToComposer(`/${command.trigger} ${command.requiredArgs.map((name) => `${name}:`).join(" ")}`.trimEnd() + " ");
      return;
    }
    await runCommand(command, {}, "", {
      sessionId,
      send: (text) => { sendToComposer(text); document.querySelector<HTMLFormElement>("form.safe-area-composer")?.requestSubmit(); },
      toast: (text, kind) => window.dispatchEvent(new CustomEvent("my-ax:toast", { detail: { text, kind: kind ?? "info" } })),
      fetchJson: async (path, init) => (await fetch(path, { credentials: "include", ...init })).json(),
    });
  }

  function onKey(event: KeyboardEvent) {
    const result = menuKey(event.key, index, commands.length);
    if (!result.handled) return;
    event.preventDefault();
    index = result.index;
    if (result.close) hide();
    if (result.choose && commands[index]) void choose(commands[index]);
  }

  onMount(() => {
    const onGlobalKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) hide();
        else void show();
      }
    };
    const onOpen = () => void show();
    document.addEventListener("keydown", onGlobalKey);
    window.addEventListener("my-ax:palette-open", onOpen);
    return () => {
      document.removeEventListener("keydown", onGlobalKey);
      window.removeEventListener("my-ax:palette-open", onOpen);
    };
  });
</script>

{#if open}
  <div class="palette-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) hide(); }}>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" data-testid="command-palette">
      <input bind:this={inputEl} bind:value={query} oninput={() => void load()} onkeydown={onKey} placeholder="Run a command, tool, skill or MCP tool…" aria-label="Search commands" />
      <ul role="listbox">
        {#each commands as command, commandIndex (command.id)}
          <li role="option" aria-selected={commandIndex === index} data-unavailable={command.available ? undefined : "1"}>
            <button type="button" onclick={() => void choose(command)} onmouseenter={() => (index = commandIndex)}>
              <code>/{command.trigger}</code>
              <span>{command.available ? command.description : command.unavailableReason}</span>
              <em>{KIND_LABEL[command.kind]}</em>
            </button>
          </li>
        {:else}
          <li class="palette__empty">Nothing matches.</li>
        {/each}
      </ul>
      <div class="palette__hint">⌘K to toggle · ↑↓ to move · Enter to run · Esc to close</div>
    </div>
  </div>
{/if}

<style>
  .palette-backdrop { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,.45); display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; }
  .palette { width: min(640px, 92vw); border-radius: 12px; background: var(--color-bg, #fff); color: var(--color-fg, inherit); box-shadow: 0 20px 60px rgba(0,0,0,.35); overflow: hidden; }
  .palette input { width: 100%; padding: 14px 16px; font-size: 15px; border: 0; border-bottom: 1px solid var(--color-line, rgba(127,127,127,.25)); background: transparent; outline: none; }
  .palette ul { max-height: 52vh; overflow-y: auto; overflow-x: hidden; padding: 4px; }
  .palette li button { display: grid; min-width: 0; grid-template-columns: minmax(0, max-content) minmax(0, 1fr) auto; gap: 10px; width: 100%; text-align: left; padding: 8px 10px; border-radius: 8px; font-size: 13px; }
  .palette li[aria-selected="true"] button { background: rgba(127,127,127,.14); }
  .palette li[data-unavailable] { opacity: .5; }
  .palette code { font-weight: 600; max-width: min(16rem, 40vw); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .palette span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .7; }
  .palette em { font-style: normal; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; opacity: .55; }
  .palette__empty, .palette__hint { padding: 8px 12px; font-size: 11px; opacity: .6; }
  .palette__hint { border-top: 1px solid var(--color-line, rgba(127,127,127,.2)); }
</style>
