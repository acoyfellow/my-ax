<script lang="ts">
  import { onMount } from "svelte";
  import Chat from "./Chat.svelte";
  import ModalPanel from "./ModalPanel.svelte";
  import NavIconButton from "./NavIconButton.svelte";
  import { fixedSessionBinding, type SessionBinding } from "./session-binding";

  type Child = { id: string; name: string; status: string };

  let rootId = $state<string | null>(null);
  let binding = $state<SessionBinding | null>(null);
  let chatGeneration = $state(0);
  let loadError = $state<string | null>(null);
  let children = $state<Child[]>([]);
  let open = $state(false);
  let maximized = $state(false);
  let clearing = $state(false);

  async function loadChildren(id: string) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/children`, { credentials: "include" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    const rows = body?.result?.children;
    children = Array.isArray(rows) ? (rows as Child[]) : [];
  }

  async function ensureRoot(): Promise<string | null> {
    if (rootId) return rootId;
    loadError = null;
    const response = await fetch("/api/root", { credentials: "include" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok || !body?.ok) { loadError = body?.error?.message ?? "Root is not available"; return null; }
    rootId = body.result.id as string;
    binding = fixedSessionBinding(rootId);
    return rootId;
  }

  async function openPanel() {
    open = true;
    const id = await ensureRoot();
    if (id) void loadChildren(id);
  }

  function closePanel() {
    open = false;
  }

  async function clear() {
    if (!rootId || clearing) return;
    if (!confirm("Clear this conversation? Its messages are removed.")) return;
    clearing = true;
    const response = await fetch("/api/root/clear", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: rootId }) }).catch(() => null);
    const body = await response?.json().catch(() => null);
    clearing = false;
    if (!response?.ok) { loadError = body?.error?.message ?? "Clear failed"; return; }
    loadError = null;
    chatGeneration += 1;
  }

  onMount(() => {
    const onOpen = () => { void openPanel(); };
    window.addEventListener("my-ax:root-open", onOpen);
    if (new URL(location.href).searchParams.get("action") === "root") void openPanel();
    return () => window.removeEventListener("my-ax:root-open", onOpen);
  });
</script>

<NavIconButton label="Open root" title="Root" aria-haspopup="dialog" onclick={() => void openPanel()} data-root-button="">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="19" r="2" /><path d="M12 7v4M12 11l-6 6M12 11l6 6" /></svg>
</NavIconButton>

<ModalPanel {open} title="Root" size="wide" maximizable bind:maximized onClose={closePanel} panelAttributes={{ "data-root-panel": "" }}>
  {#snippet actions()}
    <button type="button" class="modal-panel__control" onclick={clear} disabled={clearing || !rootId}>Clear</button>
  {/snippet}
  <div class="root-content">
    {#if loadError}
      <p class="root-error text-bad" role="alert">{loadError}</p>
    {/if}
    {#if open && binding}
      <div class="root-chat">
        {#key chatGeneration}
          <Chat {binding} />
        {/key}
      </div>
      {#if children.length}
        <div class="root-tree">
          <div class="root-tree-head">Started from here</div>
          {#each children as child (child.id)}
            <a class="root-child" href={`/?session=${encodeURIComponent(child.id)}`} onclick={closePanel}>{child.name}</a>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</ModalPanel>

<style>
  .root-content { height: 100%; display: flex; flex-direction: column; }
  .root-chat { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .root-error { padding: 0.75rem 1rem; font-size: 0.875rem; }
  .root-tree { flex: none; border-top: 1px solid var(--line); padding: 10px 16px; display: flex; flex-direction: column; gap: 4px; max-height: 30%; overflow-y: auto; }
  .root-tree-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-mut); }
  .root-child { color: var(--fg); text-decoration: none; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .root-child:hover { text-decoration: underline; }
</style>
