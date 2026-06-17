<script lang="ts">
  // Connectors panel — public/self-host engine.
  //
  // The panel owns:
  //   - GET /api → laptop connected state + per-MCP auth status
  //   - GET /api/mcps → user-added MCPs list
  //   - DELETE /api/mcps/:id
  //   - POST /api/mcps/probe (Test button)
  //   - POST /api/mcps      (Save button)

  import { onMount } from "svelte";

  type UserMcp = {
    id: string;
    displayName?: string;
    upstream?: string;
  };

  // ── state ─────────────────────────────────────────────────────────
  let summary = $state<string>("—");

  let userMcps = $state<UserMcp[]>([]);
  let authStatus = $state<Record<string, { authorized?: boolean; connected?: boolean; kind?: string }>>({});
  let laptopConnected = $state<boolean>(false);
  let userMcpsError = $state<string | null>(null);
  let userMcpsLoading = $state<boolean>(true);

  // ── add-MCP modal state ───────────────────────────────────────────
  let modalOpen = $state(false);
  let mcpUrl = $state("");
  let testing = $state(false);
  let saving = $state(false);
  let probe = $state<{
    id: string;
    serverName: string;
    dcr: boolean;
    mcp: boolean;
  } | null>(null);
  let modalError = $state<string | null>(null);

  // ── effects ───────────────────────────────────────────────────────
  const LOAD_TIMEOUT_MS = 15_000;

  async function fetchJson(path: string, init?: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    try {
      const response = await fetch(path, { credentials: "include", ...init, signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
      return body;
    } catch (error: any) {
      if (error?.name === "AbortError") throw new Error("Timed out. Retry.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function refresh() {
    void refreshUserMcps();
    try {
      const d = await fetchJson("/api");
      const conns = d?.result?.connectors ?? {};
      authStatus = conns;
      laptopConnected = !!conns.machinectl?.connected;
    } catch {
      // /api status is best-effort here. The list below still loads.
    }
  }

  async function refreshUserMcps() {
    userMcpsLoading = true;
    userMcpsError = null;
    try {
      const d = await fetchJson("/api/mcps");
      userMcps = Array.isArray(d?.result?.mcps)
        ? [...new Map(d.result.mcps.map((mcp: UserMcp) => [mcp.id, mcp])).values()] as UserMcp[]
        : [];
      const authed = userMcps.filter((m) => authStatus[m.id]?.authorized).length;
      summary = userMcps.length === 0 ? "no MCPs yet" : `${authed}/${userMcps.length} authorized`;
    } catch (err: any) {
      userMcpsError = err?.message || String(err);
    } finally {
      userMcpsLoading = false;
    }
  }

  async function deleteMcp(id: string) {
    if (!window.confirm(`Remove "${id}" and forget its OAuth tokens?`)) return;
    try {
      const r = await fetch(`/api/mcps/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
    } catch (err) {
      console.warn("[mcp] delete failed", err);
      return;
    }
    refreshUserMcps();
  }

  // ── add-MCP modal handlers ────────────────────────────────────────
  function openModal() {
    mcpUrl = "";
    probe = null;
    modalError = null;
    modalOpen = true;
    setTimeout(() => {
      document.getElementById("svelte-connectors-add-url")?.focus();
    }, 50);
  }
  function closeModal() {
    modalOpen = false;
  }

  async function testProbe() {
    const url = mcpUrl.trim();
    if (!url) return;
    modalError = null;
    probe = null;
    testing = true;
    try {
      const r = await fetch("/api/mcps/probe", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        modalError = data?.error?.message || "Probe failed";
        return;
      }
      const c = data.result.connector;
      probe = {
        id: c.id,
        serverName: data.result.serverName || c.displayName || c.id,
        dcr: !!data.result.dcrAvailable,
        mcp: !!data.result.mcpConfirmed,
      };
    } catch (err: any) {
      modalError = "Network error: " + (err?.message || err);
    } finally {
      testing = false;
    }
  }

  async function save() {
    const url = mcpUrl.trim();
    if (!url) return;
    modalError = null;
    saving = true;
    try {
      const r = await fetch("/api/mcps", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        modalError = data?.error?.message || "Save failed";
        return;
      }
      closeModal();
      refreshUserMcps();
    } catch (err: any) {
      modalError = "Network error: " + (err?.message || err);
    } finally {
      saving = false;
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) closeModal();
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && modalOpen) closeModal();
  }

  onMount(() => {
    refresh();
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  });

  // Expose refresh() so chat.js can still trigger it post-OAuth-callback.
  if (typeof window !== "undefined") {
    (window as any).__refreshConnectors = refresh;
  }
</script>

<section
  class="rounded-md bg-bg border border-line px-3 py-3 text-fg"
  aria-label="Connectors"
>
  <header class="flex items-baseline justify-between mb-2">
    <h3 class="text-[11px] font-semibold text-fg uppercase tracking-wider">
      Connectors
    </h3>
    <span class="text-[10px] text-fg-mut">{summary}</span>
  </header>

  <!-- Physical laptop: same Access identity, no second OAuth consent. -->
  <div class="mb-3 pb-3 border-b border-line/60">
    <h4 class="text-[10px] font-semibold text-fg-mut uppercase tracking-wider mb-1.5">
      Physical laptop
    </h4>
    <div class="laptop-row" data-mcp-id="machinectl" title={laptopConnected ? "Laptop connected" : "Laptop offline"}>
      <span class="conn-status-dot" data-state={laptopConnected ? "enabled" : "disabled"} aria-label={laptopConnected ? "Laptop connected" : "Laptop offline"}></span>
      <span class="laptop-row__name">Laptop</span>
      <span class="laptop-row__tools">shell · desktop · auth · agents</span>
    </div>
  </div>

  <!-- Deploy-provided built-ins. Names and endpoints come from the private
       deployment status API; the public client contains no private catalog. -->
  {#if Object.entries(authStatus).filter(([id, status]: [string, any]) => id !== "machinectl" && !userMcps.some((m) => m.id === id) && status?.kind === "oauth-bearer").length > 0}
    <div class="mb-3 pb-3 border-b border-line/60">
      <h4 class="text-[10px] font-semibold text-fg-mut uppercase tracking-wider mb-1.5">Included MCP servers</h4>
      <table class="w-full text-[12px] border-collapse"><tbody>
        {#each Object.entries(authStatus).filter(([id, status]: [string, any]) => id !== "machinectl" && !userMcps.some((m) => m.id === id) && status?.kind === "oauth-bearer") as [id, status]: [string, any]}
          <tr class="conn-row" data-mcp-id={id}>
            <td class="conn-row__name">{id}</td>
            <td class="conn-row__count">—</td>
            <td class="conn-row__status">
              {#if status.authorized}
                <span class="conn-status-dot" data-state="enabled" aria-label="On" title="On"></span>
              {:else}
                <a class="user-mcp-authorize" href={status.authorize_url || `/api/connectors/${encodeURIComponent(id)}/authorize`} title="Authorize via OAuth">authorize</a>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody></table>
    </div>
  {/if}

  <!-- User-added MCPs -->
  <div>
    <div class="flex items-center justify-between mb-1.5">
      <h4 class="text-[10px] font-semibold text-fg-mut uppercase tracking-wider">
        MCP servers
      </h4>
      <button
        type="button"
        onclick={openModal}
        class="inline-flex items-center gap-1 text-[11px] text-fg-mut hover:text-fg hover:bg-surface-2 rounded px-1.5 py-0.5 transition-colors"
        title="Add an MCP server you can authorize"
        aria-label="Add MCP server"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>Add</span>
      </button>
    </div>
    <table class="w-full text-[12px] border-collapse">
      <tbody>
        {#if userMcpsLoading}
          <tr><td colspan={3} class="py-2 text-center text-fg-mut text-[11px]">Loading…</td></tr>
        {:else if userMcpsError}
          <tr>
            <td colspan={3} class="py-2 text-center text-[11px]">
              <span class="text-bad">Failed to load: {userMcpsError}</span>
              <button type="button" class="ml-2 user-mcp-retry" onclick={refreshUserMcps}>Retry</button>
            </td>
          </tr>
        {:else if userMcps.length === 0}
          <tr><td colspan={3} class="py-2 text-center text-fg-mut text-[11px] italic">None yet. Click Add to connect one.</td></tr>
        {:else}
          {#each userMcps as m (m.id)}
            {@const isAuthed = !!authStatus[m.id]?.authorized}
            <tr class="conn-row" data-mcp-id={m.id}>
              <td class="conn-row__name" title={m.upstream ?? ""}>{m.displayName || m.id}</td>
              <td class="conn-row__count" data-zero="1">—</td>
              <td class="conn-row__status">
                {#if isAuthed}
                  <span class="conn-status-dot" data-state="enabled" aria-label="On" title="On"></span>
                {:else}
                  <a
                    class="user-mcp-authorize"
                    href={`/api/connectors/${encodeURIComponent(m.id)}/authorize`}
                    title="Authorize via OAuth"
                  >
                    authorize
                  </a>
                {/if}
                <button
                  type="button"
                  class="user-mcp-delete"
                  onclick={() => deleteMcp(m.id)}
                  title={`Remove ${m.displayName || m.id}`}
                  aria-label={`Remove ${m.displayName || m.id}`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <!-- Add-MCP modal. -->
  {#if modalOpen}
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-mcp-title"
      onclick={handleBackdropClick}
    >
      <div class="w-full max-w-md mx-3 rounded-xl bg-bg-alt border border-line shadow-2xl p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 id="add-mcp-title" class="text-sm font-semibold text-fg">Add MCP server</h3>
          <button
            type="button"
            onclick={closeModal}
            class="w-7 h-7 rounded-md flex items-center justify-center text-fg-mut hover:text-fg hover:bg-surface-2 transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <label
          for="svelte-connectors-add-url"
          class="block text-[11px] font-medium text-fg-mut mb-1.5 uppercase tracking-wider"
        >
          MCP URL
        </label>
        <input
          id="svelte-connectors-add-url"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck={false}
          placeholder="https://mcp.example.com/mcp"
          bind:value={mcpUrl}
          class="w-full rounded-md bg-bg border border-line text-fg placeholder:text-fg-mut/60 px-3 py-2 text-sm font-mono focus:outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/40"
        />
        <p class="text-[11px] text-fg-mut mt-1.5 leading-snug">
          Paste the MCP server's HTTPS URL. We'll discover its OAuth
          metadata and confirm it speaks MCP before saving.
        </p>

        {#if probe}
          <div class="mt-3 rounded-md border border-line bg-bg p-3 text-[12px] text-fg">
            <div class="flex items-baseline justify-between mb-1">
              <span class="text-[11px] text-fg-mut uppercase tracking-wider">Discovered</span>
              <span class="text-fg font-medium">{probe.serverName}</span>
            </div>
            <dl class="space-y-1 text-[11px] font-mono">
              <div class="flex justify-between gap-2"><dt class="text-fg-mut">id</dt><dd class="text-fg text-right truncate">{probe.id}</dd></div>
              <div class="flex justify-between gap-2"><dt class="text-fg-mut">dcr</dt><dd class="text-fg text-right">{probe.dcr ? "yes" : "no"}</dd></div>
              <div class="flex justify-between gap-2"><dt class="text-fg-mut">mcp</dt><dd class="text-fg text-right">{probe.mcp ? "confirmed" : "unverified"}</dd></div>
            </dl>
          </div>
        {/if}

        {#if modalError}
          <div class="mt-3 rounded-md border border-bad/40 bg-bad/10 p-2 text-[12px] text-bad" role="alert">
            {modalError}
          </div>
        {/if}

        <div class="flex gap-2 mt-4">
          <button
            type="button"
            onclick={testProbe}
            disabled={testing || !mcpUrl.trim()}
            class="flex-1 rounded-md bg-bg border border-line text-[12px] font-medium text-fg px-3 py-2 min-h-[36px] hover:bg-surface-1 active:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Probe the URL without saving"
          >
            {testing ? "Testing…" : "Test"}
          </button>
          <button
            type="button"
            onclick={save}
            disabled={saving || !probe}
            class="flex-1 rounded-md bg-brand text-bg text-[12px] font-semibold px-3 py-2 min-h-[36px] hover:bg-brand/90 active:bg-brand/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Save and authorize"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  /* Same styles the JSX panel inlined. Scoped to this component now. */
  :global(.conn-row td) {
    padding: 6px 8px 6px 0;
    border-bottom: 1px solid var(--color-surface-1);
    vertical-align: middle;
  }
  :global(.conn-row:last-child td) { border-bottom: none; }
  :global(.conn-row__name) {
    font-family: 'JetBrains Mono Variable', monospace;
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 12rem;
  }
  :global(.conn-row__count) {
    text-align: right;
    font-family: 'JetBrains Mono Variable', monospace;
    color: var(--fg-mut);
    font-size: 11px;
  }
  :global(.conn-row__count[data-zero="1"]) {
    color: var(--fg-mut);
    opacity: 0.5;
  }
  :global(.conn-row__status) {
    text-align: right;
    padding-right: 0 !important;
  }
  :global(.conn-status-dot) {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-mut);
    box-shadow: 0 0 0 2px var(--color-surface-1);
    vertical-align: middle;
  }
  :global(.conn-status-dot[data-state="enabled"]) { background: var(--good); }
  :global(.conn-status-dot[data-state="disabled"]) { background: var(--fg-mut); opacity: 0.55; }
  :global(.laptop-row) {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 5px 0;
    font-size: 12px;
  }
  :global(.laptop-row__name) {
    color: var(--fg);
    font-family: 'JetBrains Mono Variable', monospace;
  }
  :global(.laptop-row__tools) {
    min-width: 0;
    margin-left: auto;
    color: var(--fg-mut);
    font-family: 'JetBrains Mono Variable', monospace;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (max-width: 420px) {
    :global(.laptop-row) { flex-wrap: wrap; }
    :global(.laptop-row__tools) {
      flex-basis: 100%;
      margin-left: 15px;
      white-space: normal;
      line-height: 1.45;
    }
  }
  :global(.user-mcp-retry) {
    padding: 2px 6px;
    border: 1px solid var(--line);
    border-radius: 4px;
    color: var(--fg-mut);
    background: transparent;
    cursor: pointer;
  }
  :global(.user-mcp-retry:hover) { color: var(--fg); background: var(--color-surface-2); }
  :global(.user-mcp-delete) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: var(--fg-mut);
    background: transparent;
    cursor: pointer;
    transition: background 120ms, color 120ms;
    margin-left: 4px;
    border: none;
    padding: 0;
  }
  :global(.user-mcp-delete:hover) {
    color: var(--bad);
    background: var(--color-surface-2);
  }
  :global(.user-mcp-authorize) {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--brand);
    background: rgba(246, 130, 31, 0.10);
    text-decoration: none;
    white-space: nowrap;
    border: none;
    cursor: pointer;
  }
  :global(.user-mcp-authorize:hover) {
    background: rgba(246, 130, 31, 0.18);
  }
</style>
