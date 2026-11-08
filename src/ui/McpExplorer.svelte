<script lang="ts">
  import { onMount } from "svelte";
  import { argsFromFields, EMPTY_EXPLORE, schemaFields, type ConnectorExploreResult, type ExploredTool } from "../connector-explore";

  type Props = { server: string; label: string };

  let { server, label }: Props = $props();

  let data = $state<ConnectorExploreResult>(EMPTY_EXPLORE);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let tab = $state<"tools" | "resources" | "prompts">("tools");
  let openTool = $state<string | null>(null);
  let values = $state<Record<string, string>>({});
  let running = $state(false);
  let output = $state<{ ok: boolean; ms: number; text: string } | null>(null);
  let filter = $state("");

  const serverInfo = $derived(data.servers.find((entry) => entry.id === server) ?? null);
  const tools = $derived((data.tools[server] ?? []).filter((tool) => !filter || `${tool.name} ${tool.description}`.toLowerCase().includes(filter.toLowerCase())));
  const resources = $derived(data.resources[server] ?? []);
  const prompts = $derived(data.prompts[server] ?? []);

  export async function refresh() {
    loading = true;
    error = null;
    try {
      const response = await fetch("/api/mcps/explore", { credentials: "include" });
      const body = await response.json().catch(() => null);
      data = body?.result ?? EMPTY_EXPLORE;
      if (!body?.ok) error = body?.error?.message ?? `HTTP ${response.status}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => { void refresh(); });

  function toggleTool(tool: ExploredTool) {
    openTool = openTool === tool.name ? null : tool.name;
    values = {};
    output = null;
  }

  async function tryTool(tool: ExploredTool) {
    const parsed = argsFromFields(schemaFields(tool.inputSchema), values);
    if (!parsed.ok) { output = { ok: false, ms: 0, text: parsed.error }; return; }
    if (!window.confirm(`Run ${label} · ${tool.name} now? MCP tools can change things.`)) return;
    running = true;
    output = null;
    try {
      const response = await fetch(`/api/mcps/${encodeURIComponent(server)}/tools/${encodeURIComponent(tool.name)}/call`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ arguments: parsed.args, confirmed: true }) });
      const body = await response.json().catch(() => null);
      output = body?.ok ? { ok: true, ms: body.result.ms, text: JSON.stringify(body.result.output, null, 2) } : { ok: false, ms: 0, text: body?.error?.message ?? `HTTP ${response.status}` };
    } catch (cause) {
      output = { ok: false, ms: 0, text: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      running = false;
    }
  }
</script>

<div class="mcp-explorer" data-testid="mcp-explorer" data-server={server}>
  <div class="mcp-explorer__bar">
    <span class="mcp-explorer__state" data-state={serverInfo?.state ?? "unknown"}>{serverInfo ? serverInfo.state : loading ? "loading" : "not connected"}</span>
    <span class="text-fg-mut">{(data.tools[server] ?? []).length} tools · {resources.length} resources · {prompts.length} prompts</span>
    <button type="button" class="mcp-explorer__btn" onclick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
  </div>
  {#if error || serverInfo?.error}<p class="mcp-explorer__error" role="alert">{serverInfo?.error ?? error}</p>{/if}
  <div class="mcp-explorer__tabs" role="tablist">
    {#each ["tools", "resources", "prompts"] as name (name)}
      <button type="button" role="tab" aria-selected={tab === name} onclick={() => (tab = name as typeof tab)}>{name}</button>
    {/each}
    {#if tab === "tools"}<input class="mcp-explorer__filter" placeholder="Filter tools" bind:value={filter} aria-label="Filter tools" />{/if}
  </div>

  {#if tab === "tools"}
    <ul class="mcp-explorer__list" data-testid="mcp-tools">
      {#each tools as tool (tool.name)}
        {@const fields = schemaFields(tool.inputSchema)}
        <li>
          <button type="button" class="mcp-explorer__row" onclick={() => toggleTool(tool)} aria-expanded={openTool === tool.name}>
            <code>{tool.name}</code>
            <span class="truncate">{tool.description}</span>
            <span class="text-fg-mut">{fields.length} args</span>
          </button>
          {#if openTool === tool.name}
            <div class="mcp-explorer__detail">
              {#if tool.description}<p class="whitespace-pre-wrap">{tool.description}</p>{/if}
              <form onsubmit={(event) => { event.preventDefault(); void tryTool(tool); }}>
                {#each fields as field (field.name)}
                  <label class="mcp-explorer__field">
                    <span><code>{field.name}</code>{field.required ? " *" : ""} <em>{field.type}</em></span>
                    {#if field.enumValues}
                      <select bind:value={values[field.name]}><option value=""></option>{#each field.enumValues as option (option)}<option value={option}>{option}</option>{/each}</select>
                    {:else if field.type === "boolean"}
                      <select bind:value={values[field.name]}><option value=""></option><option value="true">true</option><option value="false">false</option></select>
                    {:else if field.type === "json"}
                      <textarea rows="2" placeholder="JSON" bind:value={values[field.name]}></textarea>
                    {:else}
                      <input bind:value={values[field.name]} placeholder={field.description} />
                    {/if}
                  </label>
                {/each}
                <details><summary>Input schema</summary><pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details>
                <button type="submit" class="mcp-explorer__btn" disabled={running} data-testid="mcp-try">{running ? "Running…" : "Try it"}</button>
              </form>
              {#if output}
                <pre class="mcp-explorer__output" data-ok={output.ok ? "1" : "0"} data-testid="mcp-try-output">{output.ok ? `${output.ms} ms\n` : ""}{output.text}</pre>
              {/if}
            </div>
          {/if}
        </li>
      {:else}
        <li class="text-fg-mut italic">{loading ? "Loading…" : "No tools discovered yet. Authorize or refresh."}</li>
      {/each}
    </ul>
  {:else if tab === "resources"}
    <ul class="mcp-explorer__list">
      {#each resources as resource (resource.uri)}
        <li class="mcp-explorer__row"><code>{resource.name}</code><span class="truncate">{resource.description || resource.uri}</span><span class="text-fg-mut">{resource.mimeType ?? ""}</span></li>
      {:else}
        <li class="text-fg-mut italic">This server lists no resources.</li>
      {/each}
    </ul>
  {:else}
    <ul class="mcp-explorer__list">
      {#each prompts as prompt (prompt.name)}
        <li class="mcp-explorer__row"><code>{prompt.name}</code><span class="truncate">{prompt.description}</span><span class="text-fg-mut">{prompt.arguments.map((argument) => argument.name + (argument.required ? "*" : "")).join(", ")}</span></li>
      {:else}
        <li class="text-fg-mut italic">This server lists no prompts.</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .mcp-explorer__row code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: min(14rem, 40vw); }
  .mcp-explorer__field input, .mcp-explorer__field select, .mcp-explorer__field textarea { min-width: 0; width: 100%; box-sizing: border-box; }
  .mcp-explorer { min-width: 0; max-width: 100%; overflow-x: hidden; margin: 4px 0 10px; padding: 8px; border: 1px solid var(--color-line, rgba(127,127,127,.25)); border-radius: 8px; font-size: 12px; }
  .mcp-explorer__bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .mcp-explorer__state { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; padding: 1px 6px; border-radius: 999px; background: rgba(127,127,127,.15); }
  .mcp-explorer__state[data-state="ready"] { background: rgba(34,197,94,.18); }
  .mcp-explorer__state[data-state="failed"] { background: rgba(239,68,68,.18); }
  .mcp-explorer__btn { margin-left: auto; border: 1px solid var(--color-line, rgba(127,127,127,.3)); border-radius: 6px; padding: 2px 8px; }
  .mcp-explorer__error { color: var(--color-bad, #dc2626); font-family: ui-monospace, monospace; margin-top: 4px; }
  .mcp-explorer__tabs { display: flex; gap: 6px; margin: 8px 0 4px; align-items: center; }
  .mcp-explorer__tabs button { text-transform: capitalize; padding: 2px 8px; border-radius: 6px; opacity: .7; }
  .mcp-explorer__tabs button[aria-selected="true"] { background: rgba(127,127,127,.15); opacity: 1; }
  .mcp-explorer__filter { margin-left: auto; border: 1px solid var(--color-line, rgba(127,127,127,.3)); border-radius: 6px; padding: 2px 6px; background: transparent; }
  .mcp-explorer__list { max-height: 360px; overflow-y: auto; overflow-x: hidden; }
  .mcp-explorer__row { display: grid; min-width: 0; grid-template-columns: minmax(0, max-content) minmax(0, 1fr) auto; gap: 8px; width: 100%; text-align: left; padding: 4px 2px; }
  .mcp-explorer__detail { padding: 6px 4px 10px 12px; display: grid; gap: 6px; }
  .mcp-explorer__field { display: grid; gap: 2px; margin-bottom: 4px; }
  .mcp-explorer__field input, .mcp-explorer__field select, .mcp-explorer__field textarea { border: 1px solid var(--color-line, rgba(127,127,127,.3)); border-radius: 6px; padding: 3px 6px; background: transparent; font-family: ui-monospace, monospace; }
  .mcp-explorer__field em { opacity: .55; font-style: normal; }
  .mcp-explorer__output { max-height: 240px; overflow-y: auto; overflow-x: hidden; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 11px; padding: 6px; border-radius: 6px; background: rgba(127,127,127,.1); }
  .mcp-explorer__output[data-ok="0"] { color: var(--color-bad, #dc2626); }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
</style>
