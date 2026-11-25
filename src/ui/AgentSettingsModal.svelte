<script lang="ts">
  import { onMount } from "svelte";
  import { modelState } from "@my-ax/store";
  import { PI_ENGINE_MODEL_CHOICES } from "../pi-engine/pi-model-choices";
  import { VERIFIED_LAYER_OPTIONS, MAX_MODEL_LAYERS, DEFAULT_LAYER_IDS } from "../model-layers";
  import { MAX_AGENT_INSTRUCTIONS_LENGTH } from "../agent-settings-limits";

  type LayerMode = "default" | "0" | "1" | "2" | "3";
  const REASONING_CHOICES = ["low", "medium", "high"] as const;
  const LAYER_MODES: readonly LayerMode[] = ["default", "0", "1", "2", "3"];

  let dialog: HTMLDialogElement | null = null;
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
  let saving = $state(false);
  let error = $state("");

  const globalModelLabel = $derived(
    PI_ENGINE_MODEL_CHOICES.find((choice) => choice.id === modelState.current)?.label ?? modelState.current ?? "none",
  );
  const sessionUrl = $derived(`/api/sessions/${encodeURIComponent(sessionId)}`);

  function applySettings(settings: { model: string | null; reasoning: string | null; layers: string[] | null; instructions: string | null; showMetrics: boolean }) {
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
    };
  }

  async function openFor(detail: { sessionId: string; title?: string }) {
    sessionId = detail.sessionId;
    title = detail.title || "Untitled";
    error = "";
    createdHook = null;
    hookLabel = "";
    hooks = [];
    dialog?.showModal();
    void loadHooks();
    try {
      const response = await fetch(`${sessionUrl}/agent-settings`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      applySettings(body.result.settings);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function close() {
    dialog?.close();
  }

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
    if (await persist(payload())) close();
  }

  async function resetAll() {
    if (await persist({ model: null, reasoning: null, layers: null, instructions: null, showMetrics: false })) close();
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

  function onBackdropClick(event: MouseEvent) {
    if (event.target === dialog) close();
  }

  onMount(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; title?: string }>).detail;
      if (detail?.sessionId) void openFor(detail);
    };
    window.addEventListener("my-ax:agent-settings-open", onOpen);
    return () => window.removeEventListener("my-ax:agent-settings-open", onOpen);
  });
</script>

<dialog bind:this={dialog} class="agent-settings" aria-label="Agent settings" onclick={onBackdropClick} onkeydown={(event) => { if (event.key === "Escape") close(); }}>
  <div class="agent-settings__body">
    <header class="agent-settings__head">
      <div>
        <h2>Agent settings</h2>
        <p>{title}</p>
      </div>
      <button type="button" class="agent-settings__x" aria-label="Close" onclick={close}>×</button>
    </header>

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

    <details class="agent-settings__section" data-agent-experiments>
      <summary>Experiments</summary>
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
    </details>

    <details class="agent-settings__section" data-agent-hooks>
      <summary>HTTP Hook{hooks.length ? ` (${hooks.length})` : ""}</summary>
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
    </details>

    {#if error}<p class="agent-settings__error" role="alert">{error}</p>{/if}

    <footer class="agent-settings__foot">
      <button type="button" onclick={resetAll} disabled={saving}>Reset all to defaults</button>
      <button type="button" class="agent-settings__save" onclick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
    </footer>
  </div>
</dialog>

<style>
  .agent-settings { margin: auto; padding: 0; width: min(520px, calc(100vw - 24px)); max-height: calc(100vh - 48px); background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.4); }
  .agent-settings::backdrop { background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(3px); }
  .agent-settings__body { display: flex; flex-direction: column; gap: 14px; padding: 16px; }
  .agent-settings__head { display: flex; justify-content: space-between; align-items: flex-start; }
  .agent-settings__head h2 { font-size: 15px; font-weight: 600; }
  .agent-settings__head p { font-size: 12px; color: var(--fg-mut); max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .agent-settings__x { font-size: 20px; line-height: 1; color: var(--fg-mut); }
  .agent-settings__field { display: flex; flex-direction: column; gap: 6px; }
  .agent-settings__field > span { font-size: 12px; font-weight: 600; color: var(--fg-mut); }
  .agent-settings__field small { align-self: flex-end; font-size: 11px; color: var(--fg-mut); }
  .agent-settings select, .agent-settings textarea { width: 100%; padding: 6px 8px; font-size: 13px; background: var(--color-surface-1); color: var(--fg); border: 1px solid var(--line); border-radius: 7px; }
  .agent-settings__seg { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--color-surface-1); }
  .agent-settings__seg > button { flex: 1; height: 28px; font-size: 12px; border-radius: 6px; color: var(--fg-mut); text-transform: capitalize; }
  .agent-settings__seg > button[aria-checked="true"] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }
  .agent-settings__row { display: flex; gap: 8px; }
  .agent-settings__row > button, .agent-settings__foot > button { height: 30px; padding: 0 12px; font-size: 13px; border: 1px solid var(--line); border-radius: 7px; }
  .agent-settings__foot { display: flex; justify-content: space-between; }
  .agent-settings__save { background: var(--fg); color: var(--bg); }
  .agent-settings__section { display: flex; flex-direction: column; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
  .agent-settings__section > summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--fg-mut); }
  .agent-settings__section[open] > summary { margin-bottom: 8px; }
  .agent-settings__check { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--fg-mut); }
  .agent-settings input[type="text"] { flex: 1; min-width: 0; padding: 6px 8px; font-size: 13px; background: var(--color-surface-1); color: var(--fg); border: 1px solid var(--line); border-radius: 7px; }
  .agent-settings__hook { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .agent-settings__hook code { font-size: 11px; word-break: break-all; color: var(--fg-mut); }
  .agent-settings__hook > button { align-self: flex-start; height: 26px; padding: 0 10px; border: 1px solid var(--line); border-radius: 7px; }
  .agent-settings__error { font-size: 12px; color: var(--color-danger, #d33); }
</style>
