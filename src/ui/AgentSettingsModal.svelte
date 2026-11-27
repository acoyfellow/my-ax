<script lang="ts">
  import { onMount } from "svelte";
  import { modelState, sessionState } from "@my-ax/store";
  import { PI_ENGINE_MODEL_CHOICES } from "../pi-engine/pi-model-choices";
  import { VERIFIED_LAYER_OPTIONS, MAX_MODEL_LAYERS, DEFAULT_LAYER_IDS } from "../model-layers";
  import { MAX_AGENT_INSTRUCTIONS_LENGTH } from "../agent-settings-limits";

  type Tab = "general" | "context" | "experiments" | "hooks";
  const TABS: readonly { id: Tab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "context", label: "Context" },
    { id: "experiments", label: "Experiments" },
    { id: "hooks", label: "API" },
  ];
  type TriState = "default" | "on" | "off";
  const TRI_STATES: readonly { id: TriState; label: string }[] = [
    { id: "default", label: "Default (On)" },
    { id: "on", label: "On" },
    { id: "off", label: "Off" },
  ];
  const COMPACT_AT_PRESETS: readonly (number | null)[] = [null, 64_000, 128_000, 250_000, 500_000];
  const KEEP_RECENT_PRESETS: readonly (number | null)[] = [null, 15_000, 30_000, 60_000];
  const MAX_NOTES = 1500;
  type ContextSnapshot = {
    activeTokens: number;
    compactAtTokens: number;
    contextWindow: number;
    percentOfCompact: number;
    buckets: { summary: number; user: number; assistant: number; tools: number };
    topEntries: { id: number; kind: string; label: string; preview: string; tokens: number }[];
    headSummary: { entryId: number; text: string; tokens: number } | null;
    compactionCount: number;
    compacting: boolean;
  };
  type ContextPolicy = { autoCompact: boolean | null; compactAtTokens: number | null; keepRecentTokens: number | null; preserveFirstMessage: boolean | null; compactionNotes: string | null };

  type LayerMode = "default" | "0" | "1" | "2" | "3";
  const REASONING_CHOICES = ["low", "medium", "high"] as const;
  const LAYER_MODES: readonly LayerMode[] = ["default", "0", "1", "2", "3"];

  let open = $state(false);
  let docked = $state(true);
  let savedFlash = $state(false);
  let sessionId = $state("");
  let title = $state("");
  let model = $state("");
  let reasoning = $state<string>("");
  let layerMode = $state<LayerMode>("default");
  let layerIds = $state<string[]>([...DEFAULT_LAYER_IDS]);
  let instructions = $state("");
  let showMetrics = $state(false);
  type Hook = { id: string; label: string; baseUrl: string };
  let hooks = $state<Hook[]>([]);
  let hookLabel = $state("");
  let createdHook = $state<{ baseUrl: string; token: string } | null>(null);
  let tab = $state<Tab>("general");
  let autoCompact = $state<TriState>("default");
  let compactAt = $state<number | null>(null);
  let keepRecent = $state<number | null>(null);
  let preserveFirst = $state<TriState>("default");
  let compactionNotes = $state("");
  let snapshot = $state<ContextSnapshot | null>(null);
  let measuring = $state(false);
  type MemoryPreset = "lean" | "balanced" | "long" | "custom";
  const MEMORY_PRESETS: readonly { id: Exclude<MemoryPreset, "custom">; label: string; hint: string; compactAt: number | null; keepRecent: number | null }[] = [
    { id: "lean", label: "Lean", hint: "64K", compactAt: 64_000, keepRecent: 15_000 },
    { id: "balanced", label: "Balanced", hint: "250K", compactAt: null, keepRecent: null },
    { id: "long", label: "Long", hint: "500K", compactAt: 500_000, keepRecent: 60_000 },
  ];
  let showActionNotes = $state(false);
  let showNoteMode = $state<"compact" | "fresh">("compact");
  let compactFocus = $state("");
  let handoff = $state("");
  let confirmingReset = $state(false);
  let contextNotice = $state("");
  let contextBusy = $state(false);
  let saving = $state(false);
  let error = $state("");

  const memoryPreset = $derived<MemoryPreset>(
    autoCompact === "default" && preserveFirst === "default" && compactionNotes.trim() === ""
      ? compactAt === 64_000 && keepRecent === 15_000
        ? "lean"
        : compactAt === null && keepRecent === null
          ? "balanced"
          : compactAt === 500_000 && keepRecent === 60_000
            ? "long"
            : "custom"
      : "custom",
  );

  function selectMemoryPreset(preset: (typeof MEMORY_PRESETS)[number]) {
    autoCompact = "default";
    preserveFirst = "default";
    compactionNotes = "";
    compactAt = preset.compactAt;
    keepRecent = preset.keepRecent;
  }

  const globalModelLabel = $derived(
    PI_ENGINE_MODEL_CHOICES.find((choice) => choice.id === modelState.current)?.label ?? modelState.current ?? "none",
  );
  const sessionUrl = $derived(`/api/sessions/${encodeURIComponent(sessionId)}`);

  const triToBool = (value: TriState) => (value === "default" ? null : value === "on");
  const boolToTri = (value: boolean | null): TriState => (value === null ? "default" : value ? "on" : "off");
  const compactTokens = (tokens: number) => (tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : tokens >= 1000 ? `${+(tokens / 1000).toFixed(1)}K` : String(tokens));
  const presetLabel = (value: number | null) => (value === null ? "Default" : compactTokens(value));
  const bucketRows = $derived(
    snapshot
      ? [
          { key: "summary", label: "Summary", tokens: snapshot.buckets.summary },
          { key: "user", label: "User", tokens: snapshot.buckets.user },
          { key: "assistant", label: "Assistant", tokens: snapshot.buckets.assistant },
          { key: "tools", label: "Tools", tokens: snapshot.buckets.tools },
        ].filter((row) => row.tokens > 0)
      : [],
  );
  const insideSummary = $derived.by(() => {
    if (!snapshot) return "";
    const count = snapshot.topEntries.length;
    if (count === 0) return "Empty window";
    const countWord = count === 1 ? "1 item" : `${count} items`;
    const dominant = [...bucketRows].sort((a, b) => b.tokens - a.tokens)[0];
    if (!dominant || snapshot.activeTokens <= 0) return countWord;
    const pct = Math.round((dominant.tokens / snapshot.activeTokens) * 100);
    return `${countWord} · ${pct}% ${dominant.label.toLowerCase()}`;
  });
  const barScale = $derived(snapshot ? Math.max(snapshot.compactAtTokens, snapshot.activeTokens, 1) : 1);

  function applySettings(settings: { model: string | null; reasoning: string | null; layers: string[] | null; instructions: string | null; showMetrics: boolean; context?: ContextPolicy }) {
    const context = settings.context;
    autoCompact = boolToTri(context?.autoCompact ?? null);
    compactAt = context?.compactAtTokens ?? null;
    keepRecent = context?.keepRecentTokens ?? null;
    preserveFirst = boolToTri(context?.preserveFirstMessage ?? null);
    compactionNotes = context?.compactionNotes ?? "";
    showMetrics = settings.showMetrics;
    model = settings.model ?? "";
    reasoning = settings.reasoning ?? "";
    instructions = settings.instructions ?? "";
    if (settings.layers === null) {
      layerMode = "default";
    } else {
      layerMode = String(Math.min(settings.layers.length, MAX_MODEL_LAYERS)) as LayerMode;
      layerIds = [...settings.layers, ...DEFAULT_LAYER_IDS].slice(0, MAX_MODEL_LAYERS);
    }
  }

  function payload() {
    const count = layerMode === "default" ? null : Number(layerMode);
    return {
      model: model || null,
      reasoning: reasoning || null,
      layers: count === null ? null : layerIds.slice(0, count),
      instructions: instructions.trim() || null,
      showMetrics,
      context: contextPayload(),
    };
  }

  function contextPayload(): ContextPolicy {
    return {
      autoCompact: triToBool(autoCompact),
      compactAtTokens: compactAt,
      keepRecentTokens: keepRecent,
      preserveFirstMessage: triToBool(preserveFirst),
      compactionNotes: compactionNotes.trim() || null,
    };
  }

  async function postContext(path: string, body: Record<string, string>) {
    const response = await fetch(`${sessionUrl}/context/${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await response.json();
    if (!response.ok || !json?.ok) throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
  }

  async function refreshSnapshot() {
    measuring = true;
    try {
      const response = await fetch(`${sessionUrl}/context`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      snapshot = body.result;
      window.dispatchEvent(new Event("my-ax:context-changed"));
    } catch (err) {
      contextNotice = err instanceof Error ? err.message : String(err);
    } finally {
      measuring = false;
    }
  }

  async function runContextAction(action: () => Promise<void>, done: string) {
    contextBusy = true;
    contextNotice = "";
    try {
      await action();
      contextNotice = done;
      await refreshSnapshot();
    } catch (err) {
      contextNotice = err instanceof Error ? err.message : String(err);
    } finally {
      contextBusy = false;
    }
  }

  function compactNow() {
    return runContextAction(async () => {
      window.dispatchEvent(new CustomEvent("my-ax:context-compacting", { detail: { sessionId, compacting: true } }));
      await postContext("compact", { instructions: compactFocus.trim() });
      compactFocus = "";
    }, "Compaction started.");
  }

  function startFresh() {
    if (!confirmingReset) {
      confirmingReset = true;
      return;
    }
    confirmingReset = false;
    return runContextAction(async () => {
      await postContext("reset", { handoff: handoff.trim() });
      handoff = "";
    }, "Fresh context started.");
  }

  async function loadFor(id: string, nextTitle?: string) {
    sessionId = id;
    title = nextTitle || sessionState.title || "Untitled";
    error = "";
    savedFlash = false;
    snapshot = null;
    contextNotice = "";
    confirmingReset = false;
    createdHook = null;
    hookLabel = "";
    hooks = [];
    void loadHooks();
    void refreshSnapshot();
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/agent-settings`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      if (sessionId === id) applySettings(body.result.settings);
    } catch (err) {
      if (sessionId === id) error = err instanceof Error ? err.message : String(err);
    }
  }

  async function openFor(detail: { sessionId: string; title?: string; section?: Tab }) {
    const nextTab: Tab = detail.section ?? "general";
    if (open && sessionId === detail.sessionId && tab === nextTab) {
      close();
      return;
    }
    tab = nextTab;
    const sameSession = open && sessionId === detail.sessionId;
    open = true;
    if (!sameSession) await loadFor(detail.sessionId, detail.title);
  }

  function close() {
    open = false;
    confirmingReset = false;
  }

  $effect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--inspector-dock-width", open && docked ? "372px" : "0px");
    return () => {
      document.documentElement.style.setProperty("--inspector-dock-width", "0px");
    };
  });

  $effect(() => {
    const active = sessionState.id;
    if (open && active && active !== sessionId) {
      void loadFor(active, sessionState.title);
    }
  });

  async function persist(body: unknown) {
    saving = true;
    error = "";
    try {
      const response = await fetch(`${sessionUrl}/agent-settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
      applySettings(json.result.settings);
      window.dispatchEvent(new CustomEvent("my-ax:agent-settings-saved", { detail: { sessionId, settings: json.result.settings } }));
      return true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      saving = false;
    }
  }

  async function save() {
    if (await persist(payload())) {
      savedFlash = true;
      setTimeout(() => (savedFlash = false), 1600);
    }
  }

  async function resetAll() {
    if (await persist({ model: null, reasoning: null, layers: null, instructions: null, showMetrics: false, context: { autoCompact: null, compactAtTokens: null, keepRecentTokens: null, preserveFirstMessage: null, compactionNotes: null } })) {
      savedFlash = true;
      setTimeout(() => (savedFlash = false), 1600);
    }
  }

  async function loadHooks() {
    try {
      const response = await fetch(`${sessionUrl}/hooks`, { credentials: "include" });
      const body = await response.json();
      if (response.ok && body?.ok) hooks = body.hooks;
    } catch {}
  }

  async function createHook() {
    error = "";
    try {
      const response = await fetch(`${sessionUrl}/hooks`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: hookLabel.trim() }),
      });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      createdHook = { baseUrl: body.baseUrl, token: body.token };
      hookLabel = "";
      await loadHooks();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function revokeHook(hookId: string) {
    error = "";
    const response = await fetch(`${sessionUrl}/hooks/${encodeURIComponent(hookId)}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) error = `Revoke failed (HTTP ${response.status})`;
    await loadHooks();
  }

  function copy(text: string) {
    void navigator.clipboard?.writeText(text);
  }

  async function editTileSource() {
    close();
    window.dispatchEvent(new CustomEvent("my-ax:tile-edit", { detail: { sessionId } }));
  }

  async function resetTile() {
    await fetch(`${sessionUrl}/tile`, { method: "DELETE", credentials: "include" });
    window.dispatchEvent(new CustomEvent("my-ax:tile-reset", { detail: { sessionId } }));
  }

  onMount(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const syncDock = () => { docked = mq.matches; };
    syncDock();
    mq.addEventListener("change", syncDock);
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; title?: string; section?: Tab }>).detail;
      if (detail?.sessionId) void openFor(detail);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) close();
    };
    const onCompacting = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; compacting?: boolean }>).detail;
      if (detail?.sessionId === sessionId && snapshot) {
        snapshot = { ...snapshot, compacting: Boolean(detail.compacting) };
      }
    };
    window.addEventListener("my-ax:agent-settings-open", onOpen);
    window.addEventListener("my-ax:context-compacting", onCompacting);
    window.addEventListener("keydown", onKey);
    return () => {
      mq.removeEventListener("change", syncDock);
      window.removeEventListener("my-ax:agent-settings-open", onOpen);
      window.removeEventListener("my-ax:context-compacting", onCompacting);
      window.removeEventListener("keydown", onKey);
    };
  });
</script>

{#if open}
{#if !docked}
  <button type="button" class="agent-inspector__scrim" aria-label="Close agent inspector" onclick={close}></button>
{/if}
<aside class="agent-inspector" role="complementary" aria-label="Agent settings">
  <div class="agent-settings__body">
    <header class="agent-settings__head">
      <div class="agent-settings__id">
        <h2>{title}</h2>
        <span class="agent-settings__sub">This chat · <code>{sessionId.slice(0, 8)}</code></span>
      </div>
      <button type="button" class="agent-settings__x" aria-label="Close" onclick={close}>×</button>
    </header>

    <div class="agent-settings__tabs" role="tablist" aria-label="Agent settings sections">
      {#each TABS as item (item.id)}
        <button type="button" role="tab" aria-selected={tab === item.id} onclick={() => (tab = item.id)}>{item.label}</button>
      {/each}
    </div>

    <div class="agent-settings__content">
    <div class="agent-settings__panel" hidden={tab !== "general"}>
    <label class="agent-settings__field">
      <span>Model</span>
      <select bind:value={model}>
        <option value="">Use global default ({globalModelLabel})</option>
        {#each PI_ENGINE_MODEL_CHOICES as choice (choice.id)}
          <option value={choice.id}>{choice.label}</option>
        {/each}
      </select>
    </label>

    <div class="agent-settings__field">
      <span>Reasoning effort</span>
      <div class="agent-settings__seg" role="radiogroup" aria-label="Reasoning effort">
        <button type="button" role="radio" aria-checked={reasoning === ""} onclick={() => (reasoning = "")}>Default</button>
        {#each REASONING_CHOICES as level (level)}
          <button type="button" role="radio" aria-checked={reasoning === level} onclick={() => (reasoning = level)}>{level}</button>
        {/each}
      </div>
    </div>

    <label class="agent-settings__field">
      <span>Agent instructions</span>
      <textarea rows="5" maxlength={MAX_AGENT_INSTRUCTIONS_LENGTH} placeholder="Extra role, persona, or rules just for this agent..." bind:value={instructions}></textarea>
      <small>{instructions.length}/{MAX_AGENT_INSTRUCTIONS_LENGTH}</small>
    </label>

    <div class="agent-settings__field">
      <span>Tile panel</span>
      <div class="agent-settings__row">
        <button type="button" onclick={editTileSource}>Edit tile source…</button>
        <button type="button" onclick={resetTile}>Reset to bars</button>
      </div>
    </div>

    </div>

    <div hidden={tab !== "context"}>
    <div class="agent-settings__panel ctx-panel" data-agent-context>
      <section class="ctx-hero" aria-label="Context meter">
        {#if snapshot}
          <div class="ctx-hero__top">
            <div class="ctx-hero__nums">
              <strong class="ctx-hero__big">{compactTokens(snapshot.activeTokens)}</strong>
              <span class="ctx-hero__of">of {compactTokens(snapshot.compactAtTokens)}</span>
              <span class="ctx-hero__pct">{snapshot.percentOfCompact}%</span>
            </div>
            <div class="ctx-hero__meta">
              {#if snapshot.compactionCount > 0}<span class="ctx-badge">Compacted {snapshot.compactionCount}×</span>{/if}
              <button type="button" class="ctx-icon" aria-label="Refresh context measurement" title="Refresh" onclick={refreshSnapshot} disabled={measuring}>↻</button>
            </div>
          </div>
          <div class="ctx-bar" class:ctx-bar--compacting={snapshot.compacting} role="img" aria-label="Context composition">
            {#each bucketRows as row (row.key)}
              <span class={`ctx-seg ctx-seg--${row.key}`} style:width={`${(row.tokens / barScale) * 100}%`}></span>
            {/each}
          </div>
          {#if snapshot.compacting}
            <div class="ctx-live-row" role="status">
              <span class="ctx-live-dot" aria-hidden="true"></span>
              <span>Summarizing older turns while keeping recent context…</span>
            </div>
          {/if}
          {#if bucketRows.length > 0}
            <ul class="ctx-legend">
              {#each bucketRows as row (row.key)}
                <li><i class={`ctx-seg ctx-seg--${row.key}`}></i>{row.label} <b>{compactTokens(row.tokens)}</b></li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="ctx-muted">{measuring ? "Measuring context…" : "Context is not available yet."}</p>
        {/if}

        <div class="ctx-actions">
          <button type="button" class="ctx-btn ctx-btn--primary" onclick={compactNow} disabled={contextBusy || Boolean(snapshot?.compacting)}>{snapshot?.compacting ? "Compacting…" : "Compact now"}</button>
          <button type="button" class="ctx-btn" onclick={startFresh} onblur={() => (confirmingReset = false)} disabled={contextBusy}>{confirmingReset ? "Confirm fresh start" : "Start fresh"}</button>
          <button type="button" class="ctx-link" onclick={() => { showActionNotes = !showActionNotes; showNoteMode = confirmingReset ? "fresh" : "compact"; }}>
            {showActionNotes ? "Hide note" : "+ Add note"}
          </button>
        </div>

        {#if showActionNotes}
          <div class="ctx-note-box">
            <div class="ctx-note-tabs">
              <button type="button" aria-pressed={showNoteMode === "compact"} onclick={() => (showNoteMode = "compact")}>Compact focus</button>
              <button type="button" aria-pressed={showNoteMode === "fresh"} onclick={() => (showNoteMode = "fresh")}>Fresh handoff</button>
            </div>
            {#if showNoteMode === "compact"}
              <input type="text" aria-label="Compaction focus" placeholder="Optional focus, e.g. keep schema and drop build logs" bind:value={compactFocus} />
            {:else}
              <input type="text" aria-label="Handoff note" placeholder="Optional handoff note for the fresh window" bind:value={handoff} />
            {/if}
          </div>
        {/if}

        {#if confirmingReset}
          <small class="ctx-muted">Keeps your chat history visible; resets only what the model sees.</small>
        {/if}
        {#if contextNotice}<small class="ctx-notice" role="status">{contextNotice}</small>{/if}
      </section>

      <div class="agent-settings__field">
        <span class="ctx-field-head">Memory style {#if memoryPreset === "custom"}<em class="ctx-custom-tag">Custom</em>{/if}</span>
        <div class="agent-settings__seg" role="radiogroup" aria-label="Memory style">
          {#each MEMORY_PRESETS as preset (preset.id)}
            <button type="button" role="radio" aria-checked={memoryPreset === preset.id} onclick={() => selectMemoryPreset(preset)}>
              {preset.label} <small class="ctx-preset-hint">{preset.hint}</small>
            </button>
          {/each}
        </div>
      </div>

      {#if snapshot}
        <details class="ctx-disclosure">
          <summary>
            <span>What's inside</span>
            <small>{insideSummary}</small>
          </summary>
          <div class="ctx-disclosure__body">
            {#each snapshot.topEntries as entry (entry.id)}
              <div class="ctx-item">
                <span class="ctx-kind">{entry.label}</span>
                <span class="ctx-preview">{entry.preview}</span>
                <span class="ctx-tokens">{compactTokens(entry.tokens)}</span>
              </div>
            {:else}
              <p class="ctx-muted">Nothing in the window yet.</p>
            {/each}
            {#if snapshot.headSummary}
              <details class="ctx-summary">
                <summary>Active compaction summary ({compactTokens(snapshot.headSummary.tokens)} tok)</summary>
                <pre>{snapshot.headSummary.text}</pre>
              </details>
            {/if}
          </div>
        </details>
      {/if}

      <details class="ctx-disclosure">
        <summary>
          <span>Fine-tune policy</span>
          <small>{memoryPreset === "custom" ? "Customized" : "Defaults"}</small>
        </summary>
        <div class="ctx-disclosure__body">
          <div class="agent-settings__field">
            <span>Auto-compact</span>
            <div class="agent-settings__seg" role="radiogroup" aria-label="Auto-compact">
              {#each TRI_STATES as state (state.id)}
                <button type="button" role="radio" aria-checked={autoCompact === state.id} onclick={() => (autoCompact = state.id)}>{state.label}</button>
              {/each}
            </div>
          </div>
          <div class="agent-settings__field">
            <span>Compact at</span>
            <div class="agent-settings__seg" role="radiogroup" aria-label="Compact at">
              {#each COMPACT_AT_PRESETS as preset (preset ?? "default")}
                <button type="button" role="radio" aria-checked={compactAt === preset} onclick={() => (compactAt = preset)}>{presetLabel(preset)}</button>
              {/each}
            </div>
          </div>
          <div class="agent-settings__field">
            <span>Keep recent verbatim</span>
            <div class="agent-settings__seg" role="radiogroup" aria-label="Keep recent verbatim">
              {#each KEEP_RECENT_PRESETS as preset (preset ?? "default")}
                <button type="button" role="radio" aria-checked={keepRecent === preset} onclick={() => (keepRecent = preset)}>{presetLabel(preset)}</button>
              {/each}
            </div>
          </div>
          <div class="agent-settings__field">
            <span>Preserve first message verbatim</span>
            <div class="agent-settings__seg" role="radiogroup" aria-label="Preserve original user prompt">
              {#each TRI_STATES as state (state.id)}
                <button type="button" role="radio" aria-checked={preserveFirst === state.id} onclick={() => (preserveFirst = state.id)}>{state.label}</button>
              {/each}
            </div>
          </div>
          <label class="agent-settings__field">
            <span>Standing compaction notes</span>
            <textarea rows="3" maxlength={MAX_NOTES} placeholder="Always keep file paths, decisions, and open blockers..." bind:value={compactionNotes}></textarea>
            <small>{compactionNotes.length}/{MAX_NOTES}</small>
          </label>
        </div>
      </details>
    </div>
    </div>

    <div hidden={tab !== "experiments"}>
    <div class="agent-settings__panel" data-agent-experiments>
    <div class="agent-settings__field">
      <span>Model layers</span>
      <div class="agent-settings__seg" role="radiogroup" aria-label="Model layers">
        {#each LAYER_MODES as mode (mode)}
          <button type="button" role="radio" aria-checked={layerMode === mode} onclick={() => (layerMode = mode)}>
            {mode === "default" ? "Default" : mode === "0" ? "0 (off)" : mode}
          </button>
        {/each}
      </div>
      {#if layerMode !== "default" && layerMode !== "0"}
        {#each layerIds.slice(0, Number(layerMode)) as _, index (index)}
          <select aria-label={`Layer ${index + 1}`} bind:value={layerIds[index]}>
            {#each VERIFIED_LAYER_OPTIONS as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
        {/each}
      {/if}
    </div>

      <label class="agent-settings__check">
        <input type="checkbox" bind:checked={showMetrics} />
        <span>Show 4 turn metrics (first response, reasoning, approval, finish)</span>
      </label>
    </div>

    </div>

    <div hidden={tab !== "hooks"}>
    <div class="agent-settings__panel" data-agent-hooks>
      <p class="ctx-muted">1-way HTTP API into this chat. External apps can POST messages and stream replies behind Cloudflare Access.</p>
      {#each hooks as hook (hook.id)}
        <div class="agent-settings__hook">
          <div>
            <strong>{hook.label}</strong>
            <code>{hook.baseUrl}</code>
          </div>
          <button type="button" onclick={() => revokeHook(hook.id)}>Revoke</button>
        </div>
      {/each}
      <div class="agent-settings__row">
        <input type="text" placeholder="Cloudflare OS" aria-label="Hook label" bind:value={hookLabel} />
        <button type="button" onclick={createHook}>Create hook</button>
      </div>
      {#if createdHook}
        <div class="agent-settings__hook agent-settings__hook--new">
          <code>{createdHook.baseUrl}</code>
          <code>{createdHook.token}</code>
          <div class="agent-settings__row">
            <button type="button" onclick={() => copy(createdHook!.baseUrl)}>Copy URL</button>
            <button type="button" onclick={() => copy(createdHook!.token)}>Copy token</button>
          </div>
          <small>Token is shown once. Send as Authorization: Bearer &lt;token&gt;.</small>
        </div>
      {/if}
    </div>

    </div>
    </div>

    {#if error}<p class="agent-settings__error" role="alert">{error}</p>{/if}

    <footer class="agent-settings__foot">
      <button type="button" onclick={resetAll} disabled={saving}>Reset all to defaults</button>
      <button type="button" class="agent-settings__save" onclick={save} disabled={saving}>{saving ? "Saving…" : savedFlash ? "Saved ✓" : "Save"}</button>
    </footer>
  </div>
</aside>
{/if}

<style>
  .agent-inspector__scrim { position: fixed; inset: var(--appbar-height, 52px) 0 0 0; z-index: 34; background: rgba(0, 0, 0, 0.22); border: 0; padding: 0; }
  .agent-inspector { position: fixed; top: var(--appbar-height, 52px); right: 0; bottom: 0; z-index: 35; width: min(372px, 100vw); background: var(--bg); color: var(--fg); border-left: 1px solid var(--line); display: flex; flex-direction: column; }
  .agent-settings__body { display: flex; flex-direction: column; gap: 14px; padding: 14px 16px; height: 100%; min-height: 0; }
  .agent-settings__content { flex: 1; min-height: 0; overflow-y: auto; padding-right: 2px; }
  .agent-settings__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex: none; }
  .agent-settings__id { min-width: 0; }
  .agent-settings__head h2 { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .agent-settings__sub { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--fg-mut); }
  .agent-settings__sub code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  .agent-settings__x { flex: none; width: 26px; height: 26px; border-radius: 6px; font-size: 18px; line-height: 1; color: var(--fg-mut); }
  .agent-settings__x:hover { background: var(--color-surface-1); color: var(--fg); }
  .agent-settings__field { display: flex; flex-direction: column; gap: 6px; }
  .agent-settings__field > span { font-size: 12px; font-weight: 600; color: var(--fg-mut); }
  .agent-settings__field small { align-self: flex-end; font-size: 11px; color: var(--fg-mut); }
  .agent-inspector select, .agent-inspector textarea { width: 100%; padding: 6px 8px; font-size: 13px; background: var(--color-surface-1); color: var(--fg); border: 1px solid var(--line); border-radius: 7px; }
  .agent-settings__seg { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--color-surface-1); }
  .agent-settings__seg > button { flex: 1; height: 28px; font-size: 12px; border-radius: 6px; color: var(--fg-mut); text-transform: capitalize; }
  .agent-settings__seg > button[aria-checked="true"] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }
  .agent-settings__row { display: flex; gap: 8px; }
  .agent-settings__row > button, .agent-settings__foot > button { height: 30px; padding: 0 12px; font-size: 12.5px; border: 1px solid var(--line); border-radius: 7px; }
  .agent-settings__foot { flex: none; display: flex; justify-content: space-between; padding-top: 10px; border-top: 1px solid var(--line); }
  .agent-settings__save { background: var(--fg); color: var(--bg); border-color: var(--fg) !important; }
  .agent-settings__section { display: flex; flex-direction: column; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
  .agent-settings__section > summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--fg-mut); }
  .agent-settings__section[open] > summary { margin-bottom: 8px; }
  .agent-settings__check { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--fg-mut); }
  .agent-inspector input[type="text"] { flex: 1; min-width: 0; padding: 6px 8px; font-size: 13px; background: var(--color-surface-1); color: var(--fg); border: 1px solid var(--line); border-radius: 7px; }
  .agent-settings__hook { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .agent-settings__hook code { font-size: 11px; word-break: break-all; color: var(--fg-mut); }
  .agent-settings__hook > button { align-self: flex-start; height: 26px; padding: 0 10px; border: 1px solid var(--line); border-radius: 7px; }
  .agent-settings__tabs { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--color-surface-1); }
  .agent-settings__tabs > button { flex: 1; height: 28px; font-size: 12px; border-radius: 6px; color: var(--fg-mut); }
  .agent-settings__tabs > button[aria-selected="true"] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }
  .agent-settings__panel { display: flex; flex-direction: column; gap: 14px; }
  .agent-settings__panel[hidden], .agent-settings__content > div[hidden] { display: none; }
  .ctx-panel { gap: 16px; }
  .ctx-hero { display: flex; flex-direction: column; gap: 10px; }
  .ctx-hero__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ctx-hero__nums { display: flex; align-items: baseline; gap: 5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ctx-hero__big { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
  .ctx-hero__of { font-size: 13px; color: var(--fg-mut); white-space: nowrap; }
  .ctx-hero__pct { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: var(--color-surface-1); color: var(--fg-mut); }
  .ctx-hero__meta { display: flex; align-items: center; gap: 6px; flex: none; }
  .ctx-muted { font-size: 12px; color: var(--fg-mut); }
  .ctx-notice { font-size: 12px; color: var(--fg); }
  .ctx-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--color-surface-1); color: var(--fg-mut); white-space: nowrap; }
  .ctx-badge--live { color: #d9a441; }
  .ctx-icon { width: 26px; height: 26px; border: 1px solid var(--line); border-radius: 7px; color: var(--fg-mut); }
  .ctx-bar { position: relative; display: flex; height: 6px; border-radius: 999px; overflow: hidden; background: var(--color-surface-1); }
  .ctx-bar--compacting::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, rgba(217, 164, 65, 0.55) 50%, transparent 100%); animation: ctx-sweep 1.2s ease-in-out infinite; }
  @keyframes ctx-sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
  .ctx-live-row { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #b58325; }
  .ctx-live-dot { width: 7px; height: 7px; border-radius: 999px; background: #d9a441; flex: none; animation: ctx-dot-pulse 1.1s ease-in-out infinite; }
  @keyframes ctx-dot-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.8); } }
  .ctx-seg--summary { background: #8b7fd6; }
  .ctx-seg--user { background: #5b9bd5; }
  .ctx-seg--assistant { background: #5fae7e; }
  .ctx-seg--tools { background: #d9a441; }
  .ctx-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; color: var(--fg-mut); font-variant-numeric: tabular-nums; }
  .ctx-legend li { display: flex; align-items: center; gap: 5px; }
  .ctx-legend i { width: 7px; height: 7px; border-radius: 999px; display: inline-block; }
  .ctx-legend b { color: var(--fg); font-weight: 500; }
  .ctx-actions { display: flex; align-items: center; gap: 8px; padding-top: 2px; }
  .ctx-btn { height: 30px; padding: 0 12px; font-size: 12.5px; border: 1px solid var(--line); border-radius: 7px; color: var(--fg); }
  .ctx-btn--primary { background: var(--color-surface-1); font-weight: 500; }
  .ctx-link { margin-left: auto; font-size: 12px; color: var(--fg-mut); }
  .ctx-link:hover { color: var(--fg); }
  .ctx-note-box { display: flex; flex-direction: column; gap: 6px; }
  .ctx-note-tabs { display: flex; gap: 10px; font-size: 11px; }
  .ctx-note-tabs button { color: var(--fg-mut); }
  .ctx-note-tabs button[aria-pressed="true"] { color: var(--fg); font-weight: 600; }
  .ctx-field-head { display: flex; align-items: center; gap: 6px; }
  .ctx-custom-tag { font-style: normal; font-size: 10.5px; font-weight: 500; padding: 1px 6px; border-radius: 999px; background: var(--color-surface-1); color: var(--fg-mut); }
  .ctx-preset-hint { font-size: 11px; color: var(--fg-mut); margin-left: 2px; }
  .ctx-disclosure { border-top: 1px solid var(--line); padding-top: 10px; }
  .ctx-disclosure > summary { display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 12.5px; font-weight: 500; color: var(--fg); list-style: none; }
  .ctx-disclosure > summary::before { content: "▸"; display: inline-block; margin-right: 6px; color: var(--fg-mut); transition: transform 120ms ease; }
  .ctx-disclosure[open] > summary::before { transform: rotate(90deg); }
  .ctx-disclosure > summary > span { margin-right: auto; }
  .ctx-disclosure > summary > small { font-size: 11.5px; color: var(--fg-mut); font-variant-numeric: tabular-nums; }
  .ctx-disclosure__body { display: flex; flex-direction: column; gap: 10px; padding-top: 10px; }
  .ctx-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .ctx-kind { flex: none; font-size: 11px; color: var(--fg-mut); min-width: 66px; }
  .ctx-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-mut); }
  .ctx-tokens { flex: none; font-variant-numeric: tabular-nums; font-weight: 500; }
  .ctx-summary summary { cursor: pointer; font-size: 12px; color: var(--fg-mut); }
  .ctx-summary pre { margin-top: 6px; max-height: 180px; overflow: auto; white-space: pre-wrap; font-size: 11px; }
  .agent-settings__error { font-size: 12px; color: var(--color-danger, #d33); }
  @media (max-width: 320px), (max-height: 260px) {
    .agent-settings__body { gap: 8px; padding: 8px 10px; }
    .agent-settings__tabs { overflow-x: auto; scrollbar-width: none; }
    .agent-settings__tabs::-webkit-scrollbar { display: none; }
    .agent-settings__tabs > button { flex: none; height: 24px; font-size: 11px; padding: 0 8px; white-space: nowrap; }
    .ctx-hero__big { font-size: 16px; }
    .ctx-hero__of { font-size: 11.5px; }
    .ctx-actions { flex-wrap: wrap; gap: 6px; }
    .ctx-btn { height: 26px; padding: 0 8px; font-size: 11.5px; }
    .ctx-preset-hint { display: none; }
    .agent-settings__seg > button { height: 24px; font-size: 11px; padding: 0 2px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agent-settings__foot { flex-wrap: wrap; gap: 6px; padding-top: 8px; }
    .agent-settings__foot > button { height: 26px; padding: 0 8px; font-size: 11.5px; }
  }
</style>
