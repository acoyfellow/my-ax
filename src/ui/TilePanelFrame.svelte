<script lang="ts">
  import { onMount } from "svelte";
  import type { SeismoPulse } from "../seismograph";
  import type { TileStateObject } from "../tile-panel";

  interface Props {
    sessionId: string;
    title: string;
    artifactId: string;
    tileState: TileStateObject;
    running: boolean;
    blocked: boolean;
    size: "small" | "medium" | "large";
    updatedAt: string;
    pulse: SeismoPulse | null;
    dragging?: boolean;
    onSend?: (text: string) => void;
    onSelect?: () => void;
    onContextMenu?: (x: number, y: number) => void;
  }

  const { sessionId, title, artifactId, tileState, running, blocked, size, updatedAt, pulse, dragging = false, onSend, onSelect, onContextMenu }: Props = $props();

  let frameEl = $state<HTMLIFrameElement | null>(null);
  let theme = $state<"light" | "dark">("dark");
  let ready = $state(false);

  function currentTheme(): "light" | "dark" {
    if (typeof document === "undefined") return "dark";
    return document.documentElement.classList.contains("light") ? "light" : "dark";
  }

  function pushState() {
    const win = frameEl?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        {
          type: "my-ax:tile-state",
          theme,
          state: JSON.parse(JSON.stringify(tileState ?? {})),
          session: { id: sessionId, title, running, blocked, size, updatedAt, pulse: pulse ? JSON.parse(JSON.stringify(pulse)) : null },
        },
        "*",
      );
    } catch {}
  }

  onMount(() => {
    theme = currentTheme();
    const observer = new MutationObserver(() => {
      const next = currentTheme();
      if (next !== theme) {
        theme = next;
        pushState();
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const onMessage = (event: MessageEvent) => {
      if (!frameEl || event.source !== frameEl.contentWindow) return;
      const data = event.data as { type?: unknown; text?: unknown; x?: unknown; y?: unknown } | null;
      if (data?.type === "my-ax:tile-ready") {
        ready = true;
        pushState();
      } else if (data?.type === "my-ax:tile-send" && typeof data.text === "string" && data.text.trim()) {
        onSend?.(data.text.trim());
      } else if (data?.type === "my-ax:tile-select") {
        onSelect?.();
      } else if (data?.type === "my-ax:tile-contextmenu" && typeof data.x === "number" && typeof data.y === "number") {
        const rect = frameEl.getBoundingClientRect();
        onContextMenu?.(rect.left + data.x, rect.top + data.y);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      observer.disconnect();
      window.removeEventListener("message", onMessage);
    };
  });

  $effect(() => {
    void artifactId;
    void tileState;
    void running;
    void blocked;
    void size;
    void updatedAt;
    void pulse;
    void theme;
    pushState();
  });
</script>

<iframe
  bind:this={frameEl}
  class="tile-panel-frame"
  data-size={size}
  data-ready={ready ? "1" : "0"}
  data-dragging={dragging ? "1" : "0"}
  data-tile-panel-id={artifactId}
  src={`/api/artifacts/${encodeURIComponent(artifactId)}/preview?tile=1`}
  title={`${title} panel`}
  sandbox="allow-scripts"
  loading="lazy"
  referrerpolicy="no-referrer"
  onload={() => { ready = true; pushState(); }}
></iframe>

<style>
  .tile-panel-frame {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 0;
    border: 0;
    background: transparent;
    overflow: hidden;
    opacity: 0;
    transition: opacity 140ms ease;
  }
  .tile-panel-frame[data-ready="1"] {
    opacity: 1;
  }
  .tile-panel-frame[data-dragging="1"] {
    pointer-events: none;
  }
</style>
