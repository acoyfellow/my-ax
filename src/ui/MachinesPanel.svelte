<script lang="ts">
  import { confirmDialog, promptDialog } from "./alert-store.svelte";
  import { pairCommandFor, type PairedMachine, type PairCode } from "./machines-panel";

  let { active }: { active: boolean } = $props();

  let machines = $state<PairedMachine[]>([]);
  let loading = $state(false);
  let status = $state("");
  let pairCode = $state<PairCode | null>(null);
  let pairName = $state("");
  let copied = $state(false);
  let now = $state(Date.now());

  const command = $derived(pairCode ? pairCommandFor(pairCode, pairName) : "");
  const minutesLeft = $derived(pairCode ? Math.max(0, Math.ceil((pairCode.expiresAt - now) / 60_000)) : 0);

  async function refresh() {
    loading = true;
    try {
      const response = await fetch("/api/machines", { credentials: "include" });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      const before = machines.length;
      machines = body.machines ?? [];
      if (pairCode && machines.length > before) { pairCode = null; status = "Machine paired."; }
    } catch (error) {
      status = "Could not load machines: " + (error instanceof Error ? error.message : String(error));
    } finally {
      loading = false;
    }
  }

  async function addMachine() {
    status = "";
    copied = false;
    const response = await fetch("/api/machines/pair-codes", { method: "POST", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) { status = body?.error?.message ?? "Could not make a pairing code."; return; }
    pairCode = { code: body.code, expiresAt: body.expiresAt, origin: window.location.origin };
    pairName = "";
  }

  async function copyCommand() {
    try { await navigator.clipboard.writeText(command); copied = true; } catch { status = "Copy failed. Select the command and copy it."; }
  }

  async function rename(machine: PairedMachine) {
    const title = (await promptDialog({ title: "Rename machine", value: machine.title }))?.trim();
    if (!title || title === machine.title) return;
    const response = await fetch("/api/machines/" + encodeURIComponent(machine.name), { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) { status = body?.error?.message ?? "Rename failed."; return; }
    machines = machines.map((item) => (item.name === machine.name ? { ...item, title: body.title } : item));
    status = "Machine renamed.";
  }

  async function remove(machine: PairedMachine) {
    if (!(await confirmDialog({ title: `Remove “${machine.title}”?`, body: "It disconnects now and must be paired again to come back.", confirmLabel: "Remove", tone: "danger" }))) return;
    const response = await fetch("/api/machines/" + encodeURIComponent(machine.name), { method: "DELETE", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) { status = body?.error?.message ?? "Remove failed."; return; }
    machines = machines.filter((item) => item.name !== machine.name);
    status = "Machine removed.";
  }

  $effect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => { now = Date.now(); void refresh(); }, pairCode ? 3_000 : 15_000);
    return () => clearInterval(timer);
  });
</script>

<section class="space-y-3" data-machines-panel>
  <header class="flex items-start justify-between gap-3">
    <div>
      <h3 class="text-sm font-semibold text-fg">Machines</h3>
      <p class="mt-1 text-xs leading-relaxed text-fg-mut">Your own computers. The agent can use each one you add.</p>
    </div>
    <button type="button" onclick={addMachine} class="job-action-button shrink-0 hover:border-brand/60" data-add-machine>Add machine</button>
  </header>

  {#if pairCode}
    <div class="rounded-lg border border-brand/40 bg-bg p-3 space-y-2" data-pair-code>
      <p class="text-xs text-fg">On the machine you want to add, open Terminal and run:</p>
      <label class="block text-[11px] text-fg-mut">Name (optional)
        <input bind:value={pairName} placeholder="work-laptop" class="mt-1 w-full rounded-md border border-line bg-bg-alt px-2 py-1 text-xs text-fg" />
      </label>
      <pre class="whitespace-pre-wrap break-all rounded-md border border-line bg-bg-alt p-2 font-mono text-[11px] text-fg" data-pair-command>{command}</pre>
      <div class="flex items-center gap-2">
        <button type="button" onclick={copyCommand} class="job-action-button hover:border-brand/60">{copied ? "Copied" : "Copy"}</button>
        <span class="text-[11px] text-fg-mut">Code {pairCode.code} works once, for {minutesLeft} more min.</span>
        <button type="button" onclick={() => (pairCode = null)} class="ml-auto text-[11px] text-fg-mut hover:text-fg">Cancel</button>
      </div>
    </div>
  {/if}

  {#if loading && machines.length === 0}
    <p class="text-xs text-fg-mut">Loading machines…</p>
  {:else if machines.length === 0 && !pairCode}
    <p class="rounded-lg border border-dashed border-line bg-bg p-4 text-center text-xs text-fg-mut">No machines yet. Add one to let the agent use it.</p>
  {:else}
    <ul class="divide-y divide-line rounded-lg border border-line bg-bg">
      {#each machines as machine (machine.name)}
        <li class="flex items-center gap-3 px-3 py-2" data-machine={machine.name}>
          <span class="h-2 w-2 flex-none rounded-full {machine.connected ? 'bg-good' : 'bg-fg-mut/40'}" aria-hidden="true"></span>
          <div class="min-w-0 flex-1">
            <strong class="block truncate text-sm text-fg">{machine.title}</strong>
            <span class="block truncate text-[11px] text-fg-mut">{machine.connected ? `Connected${machine.hostName ? " · " + machine.hostName : ""} · ${machine.tools.length} tools` : "Offline"}</span>
          </div>
          <button type="button" class="job-action-button hover:border-brand/60" onclick={() => rename(machine)}>Rename</button>
          <button type="button" class="job-action-button text-fg-mut hover:border-bad/60 hover:text-bad" onclick={() => remove(machine)}>Remove</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if status}<p class="text-xs text-fg-mut" role="status" aria-live="polite">{status}</p>{/if}
</section>
