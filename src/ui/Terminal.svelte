<script lang="ts">
  import { onMount } from "svelte";
  import { usableTerminalGrid } from "../terminal-protocol";
  import { TerminalSocket, terminalUrl, type TerminalStatus } from "./terminal-socket";

  let status = $state<TerminalStatus>("closed");
  let detail = $state<string | null>(null);
  let hostEl: HTMLDivElement | null = null;
  let socket: TerminalSocket | null = null;
  let term: { write: (data: string | Uint8Array) => void; cols?: number; rows?: number; destroy?: () => void } | null = null;
  let connectedUrl = "";

  const statusLabel = $derived(
    status === "ready" ? "live" : status === "connecting" ? "connecting" : status === "error" ? "error" : "closed",
  );

  function attachWhenWide(cols: number, rows: number) {
    if (!usableTerminalGrid(cols, rows)) {
      detail = "waiting for a wide enough host before opening the pty";
      return;
    }
    const url = terminalUrl(window.location.origin, cols, rows);
    if (!socket) {
      socket = new TerminalSocket({
        onBytes: (bytes) => term?.write(bytes),
        onStatus: (next, why) => {
          status = next;
          detail = why ?? null;
        },
      });
    }
    if (connectedUrl === url && (status === "ready" || status === "connecting")) {
      socket.resize(cols, rows);
      return;
    }
    socket.close();
    connectedUrl = url;
    socket.connect(url);
  }

  async function start() {
    if (!hostEl || term) return;
    const { mount } = await import("cloudterm");
    term = await mount(hostEl, {
      onData: (bytes: Uint8Array) => {
        if (!socket?.send(bytes)) detail = "the terminal is not connected";
      },
      onResize: (cols: number, rows: number) => {
        attachWhenWide(cols, rows);
      },
    });
    const cols = Number(term.cols ?? 0);
    const rows = Number(term.rows ?? 0);
    attachWhenWide(cols, rows);
  }

  function reconnect() {
    const cols = Number(term?.cols ?? 0);
    const rows = Number(term?.rows ?? 0);
    connectedUrl = "";
    attachWhenWide(cols, rows);
  }

  onMount(() => {
    void start();
    return () => {
      socket?.close();
      term?.destroy?.();
    };
  });
</script>

<section class="inline-terminal" data-inline-terminal="1" aria-label="Workspace terminal">
  <header class="term-head">
    <strong>Workspace terminal</strong>
    <span class="term-pill" data-status={status}>{statusLabel}</span>
    <div class="term-spacer"></div>
    {#if status !== "ready"}
      <button type="button" class="term-btn" onclick={reconnect}>Reconnect</button>
    {/if}
  </header>
  {#if detail}
    <p class="term-detail">{detail}</p>
  {/if}
  <div bind:this={hostEl} class="term-host"></div>
</section>

<style>
  .inline-terminal {
    margin: 0.5rem 0 0.75rem;
    border: 1px solid var(--border, #2a3441);
    border-radius: 0.6rem;
    background: #0b1118;
    color: #e6edf3;
    min-width: 40ch;
    overflow: hidden;
  }
  .term-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #2a3441;
  }
  .term-spacer { flex: 1; }
  .term-pill {
    font-size: 0.72rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    border: 1px solid #2a3441;
  }
  .term-pill[data-status="ready"] { color: #3fb950; border-color: #3fb950; }
  .term-pill[data-status="connecting"] { color: #d29922; border-color: #d29922; }
  .term-pill[data-status="error"] { color: #f85149; border-color: #f85149; }
  .term-btn {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.25rem 0.6rem;
    border-radius: 0.35rem;
    border: 1px solid #2a3441;
    background: #161b22;
    color: inherit;
    cursor: pointer;
  }
  .term-btn:hover { border-color: #f6821f; }
  .term-detail {
    margin: 0;
    padding: 0.4rem 0.75rem;
    font-size: 0.78rem;
    color: #f85149;
  }
  .term-host {
    height: min(40vh, 22rem);
    min-width: 40ch;
    overflow: hidden;
    padding: 0.5rem;
  }
</style>
