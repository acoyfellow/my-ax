<script lang="ts">
  type Skill = { id: string; name: string; description: string; instructions: string; allowedTools: string[]; updatedAt: string };

  type Draft = { id: string | null; name: string; description: string; instructions: string; allowedTools: string };

  type Props = { request: { mode: "new" | "save" | "list"; sessionId: string | null; nonce: number } };

  let { request }: Props = $props();

  let skills = $state<Skill[]>([]);
  let enabled = $state(true);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let draft = $state<Draft | null>(null);
  let saving = $state(false);
  let handledNonce = 0;

  const emptyDraft = (): Draft => ({ id: null, name: "", description: "", instructions: "", allowedTools: "" });

  async function call(path: string, init?: RequestInit) {
    const response = await fetch(path, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
    return body.result;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [list, commands] = await Promise.all([call("/api/skills"), call("/api/commands?limit=1&connectors=0")]);
      skills = list.skills;
      enabled = commands.enabled !== false;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function startSave(sessionId: string | null) {
    if (!sessionId) { error = "Open a conversation first, then use /skill-save"; draft = emptyDraft(); return; }
    try {
      const result = await call(`/api/skills/from-session/${encodeURIComponent(sessionId)}`, { method: "POST", body: "{}" });
      draft = { id: null, name: result.draft.name, description: result.draft.description, instructions: result.draft.instructions, allowedTools: "" };
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      draft = emptyDraft();
    }
  }

  $effect(() => {
    if (request.nonce === handledNonce) return;
    handledNonce = request.nonce;
    if (request.mode === "new") draft = emptyDraft();
    if (request.mode === "save") void startSave(request.sessionId);
  });

  $effect(() => { void load(); });

  async function save() {
    if (!draft) return;
    saving = true;
    error = null;
    const payload = { name: draft.name, description: draft.description, instructions: draft.instructions, allowedTools: draft.allowedTools.split(",").map((tool) => tool.trim()).filter(Boolean) };
    try {
      await call(draft.id ? `/api/skills/${encodeURIComponent(draft.id)}` : "/api/skills", { method: draft.id ? "PATCH" : "POST", body: JSON.stringify(payload) });
      draft = null;
      await load();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving = false;
    }
  }

  async function remove(skill: Skill) {
    if (!window.confirm(`Delete the skill /${skill.name}?`)) return;
    try { await call(`/api/skills/${encodeURIComponent(skill.id)}`, { method: "DELETE" }); await load(); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }

  async function importMarkdown(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try { await call("/api/skills", { method: "POST", body: JSON.stringify({ markdown: await file.text() }) }); await load(); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }

  async function toggleEnabled() {
    try { enabled = (await call("/api/commands/settings", { method: "POST", body: JSON.stringify({ enabled: !enabled }) })).enabled; } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }
</script>

<section class="rounded-lg border border-line bg-bg px-3 py-3 sm:px-4" data-testid="skills-panel">
  <div class="flex items-center justify-between gap-2 mb-2">
    <span class="block text-xs font-medium text-fg-mut">Slash commands</span>
    <label class="inline-flex items-center gap-2 text-xs">
      <input type="checkbox" checked={enabled} onchange={toggleEnabled} data-testid="commands-enabled" />
      Show the / and @ menu in the composer
    </label>
  </div>
  <p class="text-xs text-fg-mut">Type <code>/</code> at the start of a line for commands, reusable tools, skills, MCP tools and laptop tools. Type <code>@</code> to tag a file, a conversation or a skill.</p>
</section>

<section class="rounded-lg border border-line bg-bg px-3 py-3 sm:px-4">
  <div class="flex items-center justify-between gap-2 mb-2">
    <span class="block text-xs font-medium text-fg-mut">Skills</span>
    <div class="flex items-center gap-2">
      <label class="text-xs text-fg-mut hover:text-fg cursor-pointer">Import .md<input type="file" accept=".md,text/markdown" class="hidden" onchange={importMarkdown} /></label>
      <button type="button" class="text-xs rounded border border-line px-2 py-0.5 hover:bg-surface-2" onclick={() => (draft = emptyDraft())} data-testid="skill-new">New skill</button>
    </div>
  </div>
  <p class="mb-3 text-xs text-fg-mut">A skill is a set of instructions you call with <code>/name</code>. It applies to that one message and never grants extra tools.</p>
  {#if error}<p class="mb-2 text-xs text-bad" role="alert">{error}</p>{/if}
  {#if draft}
    <form class="mb-3 space-y-2 rounded-md border border-line p-3" onsubmit={(event) => { event.preventDefault(); void save(); }} data-testid="skill-form">
      <input class="w-full rounded border border-line bg-bg px-2 py-1 text-sm" placeholder="name (becomes /name)" bind:value={draft.name} aria-label="Skill name" />
      <input class="w-full rounded border border-line bg-bg px-2 py-1 text-sm" placeholder="one-line description" bind:value={draft.description} aria-label="Skill description" />
      <textarea class="w-full min-h-40 rounded border border-line bg-bg px-2 py-1 font-mono text-xs" placeholder="Instructions, in markdown" bind:value={draft.instructions} aria-label="Skill instructions"></textarea>
      <input class="w-full rounded border border-line bg-bg px-2 py-1 text-xs" placeholder="tools this skill expects, comma separated (optional)" bind:value={draft.allowedTools} aria-label="Skill tools" />
      <div class="flex gap-2 justify-end">
        <button type="button" class="text-xs px-2 py-1" onclick={() => (draft = null)}>Cancel</button>
        <button type="submit" class="text-xs rounded bg-brand text-white px-3 py-1 disabled:opacity-50" disabled={saving}>{saving ? "Saving…" : "Save skill"}</button>
      </div>
    </form>
  {/if}
  {#if loading}
    <p class="text-xs text-fg-mut">Loading…</p>
  {:else if skills.length === 0}
    <p class="text-xs text-fg-mut italic">No skills yet. Use <code>/skill-new</code>, or <code>/skill-save</code> on a conversation that went well.</p>
  {:else}
    <ul class="divide-y divide-line/60">
      {#each skills as skill (skill.id)}
        <li class="flex items-center gap-3 py-2 text-xs" data-testid="skill-row">
          <code class="font-semibold">/{skill.name}</code>
          <span class="flex-1 truncate text-fg-mut">{skill.description}</span>
          <a class="text-fg-mut hover:text-fg" href={`/api/skills/${encodeURIComponent(skill.id)}?format=md`}>Export</a>
          <button type="button" class="text-fg-mut hover:text-fg" onclick={() => (draft = { id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions, allowedTools: skill.allowedTools.join(", ") })}>Edit</button>
          <button type="button" class="text-fg-mut hover:text-bad" onclick={() => remove(skill)} aria-label={`Delete /${skill.name}`}>Delete</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
