<script lang="ts">
  import { onMount } from "svelte";
  import { TerminalSocket, terminalUrl, type TerminalStatus } from "./terminal-socket";

  let open = $state(false);
  let status = $state<TerminalStatus>("closed");
  let detail = $state<string | null>(null);
  let hostEl: HTMLDivElement | null = null;
  let dialogEl: HTMLDialogElement | null = null;
  let mounted = false;
  let socket: TerminalSocket | null = null;
  let term: { write: (data: string | Uint8Array) => void } | null = null;

  const statusLabel = $derived(
    status === "ready" ? "live" : status === "connecting" ? "connecting" : status === "error" ? "error" : "closed",
  );

  async function start() {
    if (!hostEl || mounted) return;
    mounted = true;
    const { mount } = await import("cloudterm");
    socket = new TerminalSocket({
      onBytes: (bytes) => term?.write(bytes),
      onStatus: (next, why) => {
        status = next;
        detail = why ?? null;
      },
    });
    term = await mount(hostEl, {
      onData: (bytes: Uint8Array) => {
        if (!socket?.send(bytes)) detail = "the terminal is not connected";
      },
      onResize: (cols: number, rows: number) => {
        socket?.resize(cols, rows);
      },
    });
    socket.connect(terminalUrl(window.location.origin, 80, 24));
  }

  function reconnect() {
    socket?.close();
    socket?.connect(terminalUrl(window.location.origin, 80, 24));
  }

  function show() {
    open = true;
    dialogEl?.showModal();
    void start();
  }

  function hide() {
    open = false;
    dialogEl?.close();
  }

  onMount(() => {
    const toggle = () => (open ? hide() : show());
    window.addEventListener("my-ax:terminal-toggle", toggle);
    return () => {
      window.removeEventListener("my-ax:terminal-toggle", toggle);
      socket?.close();
    };
  });
</script>

<dialog bind:this={dialogEl} class="term-dialog" onclose={() => (open = false)}>
  <header class="term-head">
    <strong>Workspace terminal</strong>
    <span class="term-pill" data-status={status}>{statusLabel}</span>
    <div class="term-spacer"></div>
    {#if status !== "ready"}
      <button type="button" class="term-btn" onclick={reconnect}>Reconnect</button>
    {/if}
    <button type="button" class="term-btn" onclick={hide} aria-label="Close terminal">Close</button>
  </header>
  {#if detail}
    <p class="term-detail">{detail}</p>
  {/if}
  <div bind:this={hostEl} class="term-host"></div>
</dialog>

<style>
  .term-dialog {
    width: min(96vw, 60rem);
    max-height: 86vh;
    padding: 0;
    border: 1px solid var(--border, #2a3441);
    border-radius: 0.6rem;
    background: #0b1118;
    color: #e6edf3;
  }
  .term-dialog::backdrop { background: rgba(0, 0, 0, 0.55); }
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
    height: min(70vh, 32rem);
    overflow: hidden;
    padding: 0.5rem;
  }
</style>
