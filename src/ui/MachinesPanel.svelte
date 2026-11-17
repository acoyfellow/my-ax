<script lang="ts">
  import { confirmDialog, promptDialog } from "./alert-store.svelte";
  import { addMachineCommand, machineStatusLine, type PairedMachine } from "./machines-panel";
  import { MACHINES_CHANGED, onOwnerEvent } from "./owner-live";

  let { active }: { active: boolean } = $props();

  let machines = $state<PairedMachine[]>([]);
  let loading = $state(false);
  let status = $state("");
  let adding = $state(false);
  let newName = $state("");
  let allowShell = $state(false);
  let copied = $state(false);

  const command = $derived(addMachineCommand(typeof window === "undefined" ? "" : window.location.origin, newName, allowShell));
  const liveCount = $derived(machines.filter((machine) => machine.state !== "logged_out").length);

  async function refresh() {
    loading = true;
    try {
      const response = await fetch("/api/machines", { credentials: "include" });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      machines = body.machines ?? [];
    } catch (error) {
      status = "Could not load machines: " + (error instanceof Error ? error.message : String(error));
    } finally {
      loading = false;
    }
  }

  async function post(path: string, done: string) {
    const response = await fetch(path, { method: "POST", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) { status = body?.error?.message ?? "That did not work."; return; }
    status = done;
    await refresh();
  }

  async function approve(machine: PairedMachine) {
    const ok = await confirmDialog({ title: `Approve “${machine.title}”?`, body: "Only approve a machine you just set up yourself. It gets the tools it publishes, for example screen and keyboard.", confirmLabel: "Approve" });
    if (ok) await post(`/api/machines/${encodeURIComponent(machine.name)}/approve`, "Machine approved.");
  }

  async function logOut(machine: PairedMachine) {
    const ok = await confirmDialog({ title: `Log out “${machine.title}”?`, body: "It disconnects now and stays out until you allow it again.", confirmLabel: "Log out", tone: "danger" });
    if (ok) await post(`/api/machines/${encodeURIComponent(machine.name)}/logout`, "Machine logged out.");
  }

  async function logOutAll() {
    const ok = await confirmDialog({ title: "Log out every machine?", body: "All machines disconnect now and stay out until you allow each one again.", confirmLabel: "Log out all", tone: "danger" });
    if (ok) await post("/api/machines/logout-all", "All machines logged out.");
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

  async function forget(machine: PairedMachine) {
    const response = await fetch("/api/machines/" + encodeURIComponent(machine.name), { method: "DELETE", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) { status = body?.error?.message ?? "Remove failed."; return; }
    machines = machines.filter((item) => item.name !== machine.name);
    status = "Removed from the list.";
  }

  async function copyCommand() {
    try { await navigator.clipboard.writeText(command); copied = true; } catch { status = "Copy failed. Select the command and copy it."; }
  }

  $effect(() => {
    if (!active) return;
    void refresh();
    return onOwnerEvent(MACHINES_CHANGED, () => void refresh());
  });
</script>

<section class="space-y-3" data-machines-panel>
  <header class="flex items-start justify-between gap-3">
    <div>
      <h3 class="text-sm font-semibold text-fg">Machines</h3>
      <p class="mt-1 text-xs leading-relaxed text-fg-mut">Your own computers. Each one signs in with your login, and you approve it before the agent can use it.</p>
    </div>
    <div class="flex shrink-0 gap-2">
      {#if liveCount > 0}<button type="button" onclick={logOutAll} class="job-action-button text-fg-mut hover:border-bad/60 hover:text-bad" data-logout-all>Log out all</button>{/if}
      <button type="button" onclick={() => { adding = !adding; copied = false; }} class="job-action-button hover:border-brand/60" data-add-machine>{adding ? "Close" : "Add machine"}</button>
    </div>
  </header>

  {#if adding}
    <div class="rounded-lg border border-brand/40 bg-bg p-3 space-y-2" data-add-steps>
      <p class="text-xs text-fg">On the machine you want to add, open Terminal and run this. It asks you to sign in, then the machine shows up below for you to approve.</p>
      <label class="block text-[11px] text-fg-mut">Name
        <input bind:value={newName} placeholder="work-laptop" class="mt-1 w-full rounded-md border border-line bg-bg-alt px-2 py-1 text-xs text-fg" />
      </label>
      <label class="flex items-center gap-2 text-[11px] text-fg-mut"><input type="checkbox" bind:checked={allowShell} /> Also let the agent run terminal commands in the home folder</label>
      <pre class="whitespace-pre-wrap break-all rounded-md border border-line bg-bg-alt p-2 font-mono text-[11px] text-fg" data-add-command>{command}</pre>
      <button type="button" onclick={copyCommand} class="job-action-button hover:border-brand/60">{copied ? "Copied" : "Copy"}</button>
    </div>
  {/if}

  {#if loading && machines.length === 0}
    <p class="text-xs text-fg-mut">Loading machines…</p>
  {:else if machines.length === 0 && !adding}
    <p class="rounded-lg border border-dashed border-line bg-bg p-4 text-center text-xs text-fg-mut">No machines yet. Add one to let the agent use it.</p>
  {:else if machines.length > 0}
    <ul class="divide-y divide-line rounded-lg border border-line bg-bg">
      {#each machines as machine (machine.name)}
        <li class="flex flex-wrap items-center gap-3 px-3 py-2" data-machine={machine.name} data-machine-state={machine.state}>
          <span class="h-2 w-2 flex-none rounded-full {machine.connected ? 'bg-good' : machine.state === 'pending' ? 'bg-warn' : 'bg-fg-mut/40'}" aria-hidden="true"></span>
          <div class="min-w-0 flex-1">
            <strong class="block truncate text-sm text-fg">{machine.title}</strong>
            <span class="block truncate text-[11px] text-fg-mut">{machineStatusLine(machine)}</span>
          </div>
          {#if machine.state === "pending"}
            <button type="button" class="job-action-button hover:border-brand/60" onclick={() => approve(machine)} data-approve>Approve</button>
          {/if}
          {#if machine.state === "logged_out"}
            <button type="button" class="job-action-button hover:border-brand/60" onclick={() => approve(machine)} data-allow>Allow again</button>
            <button type="button" class="job-action-button text-fg-mut" onclick={() => forget(machine)}>Remove</button>
          {:else}
            <button type="button" class="job-action-button hover:border-brand/60" onclick={() => rename(machine)}>Rename</button>
            <button type="button" class="job-action-button text-fg-mut hover:border-bad/60 hover:text-bad" onclick={() => logOut(machine)} data-logout>Log out</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if status}<p class="text-xs text-fg-mut" role="status" aria-live="polite">{status}</p>{/if}
</section>
