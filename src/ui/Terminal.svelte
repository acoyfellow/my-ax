<script lang="ts">
  import { onMount } from "svelte";
  import { usableTerminalGrid } from "../terminal-protocol";
  import { TerminalSocket, terminalUrl, type TerminalStatus } from "./terminal-socket";

  let { onClose }: { onClose?: () => void } = $props();

  let status = $state<TerminalStatus>("closed");
  let detail = $state<string | null>(null);
  let hostEl: HTMLDivElement | null = null;
  let socket: TerminalSocket | null = null;
  let term: { write: (data: string | Uint8Array) => void; cols?: number; rows?: number; destroy?: () => void } | null = null;
  let connectedUrl = "";
  let painted = $state(false);

  const statusLabel = $derived(
    !painted && status === "ready"
      ? "waiting"
      : status === "ready"
        ? "live"
        : status === "connecting"
          ? "connecting"
          : status === "error"
            ? "error"
            : "closed",
  );

  function attachWhenWide(cols: number, rows: number) {
    if (!usableTerminalGrid(cols, rows)) {
      detail = "waiting for a wide enough host before opening the pty";
      return;
    }
    const url = terminalUrl(window.location.origin, cols, rows);
    if (!socket) {
      socket = new TerminalSocket({
        onBytes: (bytes) => {
          painted = true;
          term?.write(bytes);
        },
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
    attachWhenWide(Number(term.cols ?? 0), Number(term.rows ?? 0));
  }

  function reconnect() {
    painted = false;
    connectedUrl = "";
    attachWhenWide(Number(term?.cols ?? 0), Number(term?.rows ?? 0));
  }

  async function persistWorkspace() {
    const response = await fetch("/api/workspace/snapshot", { method: "POST", credentials: "include", keepalive: true });
    if (!response.ok) detail = "workspace changes could not be saved";
  }

  async function hide() {
    socket?.close();
    await persistWorkspace();
    onClose?.();
  }

  onMount(() => {
    void start();
    return () => {
      socket?.close();
      void persistWorkspace();
      term?.destroy?.();
    };
  });
</script>

<section class="inline-terminal" data-inline-terminal="1" data-on-demand="1" aria-label="Workspace terminal">
  <header class="term-head">
    <strong>Terminal</strong>
    <span class="term-pill" data-status={painted ? status : status === "ready" ? "connecting" : status}>{statusLabel}</span>
    <div class="term-spacer"></div>
    {#if status !== "ready" || !painted}
      <button type="button" class="term-btn" onclick={reconnect}>Reconnect</button>
    {/if}
    <button type="button" class="term-btn" onclick={hide} aria-label="Hide terminal">Hide</button>
  </header>
  {#if detail}
    <p class="term-detail">{detail}</p>
  {/if}
  <div bind:this={hostEl} class="term-host"></div>
</section>

<style>
  .inline-terminal {
    margin: 0.5rem 0;
    border: 1px solid var(--border, #2a3441);
    border-radius: 0.6rem;
    background: #0b1118;
    color: #e6edf3;
    min-width: 40ch;
    max-width: 100%;
    overflow: hidden;
  }
  .term-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.65rem;
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
    padding: 0.2rem 0.5rem;
    border-radius: 0.35rem;
    border: 1px solid #2a3441;
    background: #161b22;
    color: inherit;
    cursor: pointer;
  }
  .term-btn:hover { border-color: #f6821f; }
  .term-detail {
    margin: 0;
    padding: 0.3rem 0.65rem;
    font-size: 0.78rem;
    color: #f85149;
  }
  .term-host {
    height: 12rem;
    min-width: 40ch;
    overflow: hidden;
    padding: 0.35rem;
  }
</style>
