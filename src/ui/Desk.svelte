<script lang="ts">
  import { onMount } from "svelte";
  import { parseDeskBoard, type DeskBoard } from "../desk-board";
  import { parseDeskApp, type DeskApp } from "../desk-app";
  import { ArtifactOutboundBridge, type OutboundVerb } from "./artifact-outbound";
  import { handlePageCall, type PageCallFrame } from "./page-registry";

  type DeskCard = DeskBoard["cards"][number];

  let open = $state(false);
  let board = $state<DeskBoard>({ cards: [], updatedAt: "" });
  let deskApp = $state<DeskApp>({ artifactId: null, state: null, updatedAt: "", updatedBy: null });
  let error = $state<string | null>(null);
  let answers = $state<Record<string, string>>({});
  let answering = $state<string | null>(null);
  let dialogEl: HTMLDialogElement | null = null;
  let appFrameEl: HTMLIFrameElement | null = null;

  const hostedArtifactId = $derived(deskApp.artifactId);

  const outbound = new ArtifactOutboundBridge({
    artifactIdForWindow: (source) => (appFrameEl && source === appFrameEl.contentWindow ? appFrameEl.getAttribute("data-artifact-id") : null),
    postToArtifact: (artifactId, frame) => {
      if (!appFrameEl || appFrameEl.getAttribute("data-artifact-id") !== artifactId) return false;
      const win = appFrameEl.contentWindow;
      if (!win) return false;
      try { win.postMessage(frame, "*"); return true; } catch { return false; }
    },
    runVerb: async (verb: OutboundVerb, args) => {
      const outcome = await handlePageCall({ type: "page_call", requestId: `desk-${verb}`, verb, args } as PageCallFrame);
      if (!outcome.frame.ok) throw new Error(outcome.frame.error || "host_invoke_failed");
      outcome.after?.();
      return outcome.frame.result ?? null;
    },
  });

  function activeTheme(): "light" | "dark" {
    if (document.documentElement.classList.contains("light")) return "light";
    if (document.documentElement.classList.contains("dark")) return "dark";
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function isQuestion(card: DeskCard): boolean {
    return Boolean(card.decisionHref) || /\?/.test(`${card.title}\n${card.body ?? ""}`);
  }

  function cardLabel(card: DeskCard): string {
    if (card.status !== "pending") return card.status;
    return isQuestion(card) ? "pending answer" : "in progress";
  }

  function cardTone(card: DeskCard): "bad" | "ok" | "attention" {
    return card.status === "rejected" ? "bad" : card.status === "approved" ? "ok" : "attention";
  }

  function pushStateToApp() {
    const id = deskApp.artifactId;
    if (!id || !appFrameEl) return;
    const win = appFrameEl.contentWindow;
    if (!win) return;
    try {
      win.postMessage({ type: "my-ax:artifact-theme", theme: activeTheme() }, "*");
      win.postMessage({ type: "my-ax:artifact-state", state: deskApp.state }, "*");
    } catch {}
  }

  async function refreshApp() {
    try {
      const response = await fetch("/api/desk/app", { credentials: "include" });
      if (!response.ok) return;
      const body = await response.json();
      deskApp = parseDeskApp(body?.result);
      pushStateToApp();
    } catch {}
  }

  async function refresh() {
    try {
      const response = await fetch("/api/desk", { credentials: "include" });
      if (!response.ok) throw new Error("desk unavailable");
      const body = await response.json();
      board = parseDeskBoard(body?.result);
      error = null;
      window.dispatchEvent(new CustomEvent("my-ax:desk-board", { detail: board }));
    } catch (err) {
      error = err instanceof Error ? err.message : "desk unavailable";
    }
    await refreshApp();
  }

  async function removeCard(cardId: string) {
    try {
      const response = await fetch(`/api/desk/${encodeURIComponent(cardId)}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("remove failed");
      const body = await response.json();
      board = parseDeskBoard(body?.result);
      error = null;
      window.dispatchEvent(new CustomEvent("my-ax:desk-board", { detail: board }));
    } catch (err) {
      error = err instanceof Error ? err.message : "remove failed";
    }
  }

  async function answerCard(card: DeskCard) {
    const answer = answers[card.id]?.trim();
    if (!answer) {
      error = "Write an answer before sending it.";
      return;
    }
    answering = card.id;
    try {
      const body = card.body ? `${card.body}\n\nOwner answer: ${answer}` : `Owner answer: ${answer}`;
      const response = await fetch("/api/desk", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...card, body, status: "approved" }),
      });
      if (!response.ok) throw new Error("answer failed");
      const result = await response.json();
      board = parseDeskBoard(result?.result);
      answers = { ...answers, [card.id]: "" };
      error = null;
      window.dispatchEvent(new CustomEvent("my-ax:desk-board", { detail: board }));
    } catch (err) {
      error = err instanceof Error ? err.message : "answer failed";
    } finally {
      answering = null;
    }
  }

  function closePanel() {
    open = false;
    const url = new URL(location.href);
    if (url.searchParams.get("action") === "desk") url.searchParams.delete("action");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (dialogEl?.open) dialogEl.close();
  }

  async function openPanel() {
    open = true;
    const url = new URL(location.href);
    url.searchParams.set("action", "desk");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (dialogEl && !dialogEl.open) dialogEl.showModal();
    await refresh();
  }

  onMount(() => {
    const onOpen = () => { void openPanel(); };
    const onBoard = (event: Event) => {
      board = parseDeskBoard((event as CustomEvent).detail);
      error = null;
    };
    const onAppState = (event: Event) => {
      deskApp = parseDeskApp((event as CustomEvent).detail);
      pushStateToApp();
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "my-ax:host-invoke") { void outbound.handleCall(event.source, data); return; }
      if (data.type === "my-ax:desk-app-write") void refreshApp();
    };
    window.addEventListener("my-ax:desk-open", onOpen);
    window.addEventListener("my-ax:desk-board", onBoard);
    window.addEventListener("my-ax:desk-app", onAppState);
    window.addEventListener("message", onMessage);
    void refreshApp();
    if (new URL(location.href).searchParams.get("action") === "desk") void openPanel();
    return () => {
      window.removeEventListener("my-ax:desk-open", onOpen);
      window.removeEventListener("my-ax:desk-board", onBoard);
      window.removeEventListener("my-ax:desk-app", onAppState);
      window.removeEventListener("message", onMessage);
    };
  });
</script>

<button type="button" class="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-md text-fg-mut hover:text-fg hover:bg-surface-2" aria-label="Open desk" title="Desk" onclick={() => void openPanel()}>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>
</button>

<dialog bind:this={dialogEl} class="notif-panel z-50 overflow-hidden border border-line bg-bg-alt p-0 text-fg" onclose={() => { if (open) closePanel(); }} data-desk-panel>
  <div class="notif-header safe-area-appbar">
    <h2 class="truncate text-sm font-semibold text-fg">Desk</h2>
    <button type="button" onclick={closePanel} class="notif-close" aria-label="Close desk">×</button>
  </div>
  <div class="notif-body">
    {#if hostedArtifactId}
      <iframe bind:this={appFrameEl} class="desk-app-frame" title="Desk" data-artifact-id={hostedArtifactId} src={`/api/artifacts/${encodeURIComponent(hostedArtifactId)}/preview`} sandbox="allow-scripts" referrerpolicy="no-referrer" onload={pushStateToApp}></iframe>
    {:else if error}
      <p class="notif-empty text-bad">{error}</p>
    {:else if board.cards.length === 0}
      <p class="notif-empty">The desk is empty. An agent can build one with deskWrite: point it at an artifact for a full app, or write state for a simple board.</p>
    {:else}
      <ul class="notif-list">
        {#each board.cards as card (card.id)}
          <li class="notif-item">
            <div class="notif-item-main">
              <div class="notif-pill" data-tone={cardTone(card)}>{cardLabel(card)}</div>
              <strong>{card.title}</strong>
              {#if card.body}<p class="notif-detail-body">{card.body}</p>{/if}
              {#if card.status === "pending" && isQuestion(card)}
                <div class="desk-answer">
                  <label for={`desk-answer-${card.id}`}>Answer for the agent</label>
                  <textarea id={`desk-answer-${card.id}`} bind:value={answers[card.id]} rows="2" placeholder="Write your answer"></textarea>
                  <button type="button" class="notif-detail-source" disabled={answering === card.id} onclick={() => void answerCard(card)}>{answering === card.id ? "Sending…" : "Send answer"}</button>
                </div>
              {/if}
              <div class="flex gap-2 mt-2">
                {#if card.href}<a class="notif-detail-source" href={card.href} target="_blank" rel="noopener noreferrer">Open source</a>{/if}
                {#if card.decisionHref}<a class="notif-detail-source" href={card.decisionHref}>Decide</a>{/if}
              </div>
            </div>
            <button type="button" class="desk-remove" aria-label={`Remove ${card.title}`} onclick={() => void removeCard(card.id)}>Remove</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</dialog>

<style>
  .notif-panel { position: fixed; inset: max(0.5rem, env(safe-area-inset-top)) auto auto 50%; width: min(460px, calc(100vw - 1rem)); max-height: min(680px, calc(100dvh - 1rem)); margin: 0; transform: translateX(-50%); border-radius: 16px; box-shadow: 0 28px 80px rgb(0 0 0 / .32), 0 2px 10px rgb(0 0 0 / .12); }
  .notif-panel[open] { display: flex; flex-direction: column; }
  .notif-panel::backdrop { background: rgb(0 0 0 / .56); backdrop-filter: blur(3px); }
  .notif-header { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 10px; min-height: 56px; padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--bg-alt); }
  .notif-close, .desk-remove { border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--fg-mut); }
  .notif-close { min-height: 36px; min-width: 36px; font-size: 14px; line-height: 1; }
  .notif-close:hover, .desk-remove:hover { color: var(--fg); background: var(--surface-2); }
  .notif-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; background: var(--bg-alt); }
  .notif-empty { padding: 2.5rem 1.25rem; text-align: center; color: var(--fg-mut); font-size: .875rem; }
  .desk-app-frame { display: block; width: 100%; height: min(560px, calc(100dvh - 8rem)); border: 0; background: var(--bg); }
  .notif-list { display: flex; flex-direction: column; }
  .notif-item { display: flex; align-items: stretch; gap: 6px; padding: 10px 10px 10px 12px; border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
  .notif-item-main { display: block; min-width: 0; flex: 1; }
  .desk-remove { align-self: center; flex: none; min-height: 32px; padding: 0 8px; font-size: 12px; font-weight: 600; }
  .notif-detail-body { margin-top: 8px; white-space: pre-wrap; font-size: .88rem; line-height: 1.5; color: var(--fg); }
  .notif-detail-source { display: inline-block; margin-top: 8px; border: 0; border-radius: .5rem; background: var(--brand); padding: .4rem .7rem; font-size: .75rem; font-weight: 700; color: white; }
  .notif-detail-source:disabled { opacity: .6; }
  .notif-pill { display: inline-flex; align-items: center; padding: 1px 7px; border: 1px solid var(--line); border-radius: 999px; font-size: 11px; font-weight: 500; color: var(--fg-mut); }
  .notif-pill[data-tone="bad"] { border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); }
  .notif-pill[data-tone="attention"] { border-color: color-mix(in srgb, var(--brand) 50%, var(--line)); color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, transparent); }
  .notif-pill[data-tone="ok"] { border-color: color-mix(in srgb, #16a34a 45%, var(--line)); color: #16a34a; background: color-mix(in srgb, #16a34a 10%, transparent); }
  .desk-answer { display: grid; gap: 6px; margin-top: 10px; }
  .desk-answer label { font-size: .75rem; font-weight: 600; color: var(--fg-mut); }
  .desk-answer textarea { width: 100%; resize: vertical; border: 1px solid var(--line); border-radius: 7px; padding: 7px; background: var(--bg); color: var(--fg); font: inherit; font-size: .85rem; }
  .desk-answer .notif-detail-source { justify-self: start; margin-top: 0; }
  @media (max-width: 639px) { .notif-panel { inset: auto 0 0; transform: none; width: 100vw; max-width: 100vw; max-height: calc(100dvh - max(2.5rem, env(safe-area-inset-top))); border-radius: 16px 16px 0 0; } }
</style>
