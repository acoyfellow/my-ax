<script lang="ts">
  // Settings command modal: model/theme/PWA, capabilities, jobs, push,
  // health, and connector configuration.
  //
  // The modal:
  //   - opens/closes via window events 'my-ax:settings-toggle' / -open / -close
  //   - reads model/reasoning from the shared store; writes back via setters
  //   - owns its own /api/jobs CRUD, /api/push/* subscribe/test, install-PWA
  //     prompt capture, theme cycle, model-catalog search

  import { onMount, tick } from "svelte";
  import {
    modelState,
    setModel,
    setReasoning,
    type Reasoning,
    themeState,
    applyTheme,
    SESSION_KEY,
  } from "@my-ax/store";
  import { MODELS, DEFAULT_MODEL_ID } from "../../src/models";

  interface Props {
    identityEmail?: string | null;
    initialTheme?: "system" | "light" | "dark";
  }
  const { identityEmail = null, initialTheme = "system" }: Props = $props();

  // Apply server-resolved theme on mount; the inline <head> script in
  // Layout.tsx already stamped the right class, this just lines up our
  // store value with what's on <html>.
  onMount(() => {
    const html = document.documentElement;
    const pref = (html.dataset.themePref as "system" | "light" | "dark") || initialTheme;
    themeState.pref = pref;
  });

  // ── open/close ──────────────────────────────────────────────────────
  let open = $state(false);
  let dialogEl = $state<HTMLDialogElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);
  let settingsQuery = $state("");
  let activeSection = $state<"general" | "capabilities" | "jobs" | "connections">("general");
  let lastActiveElement: HTMLElement | null = null;
  const sections = [
    { id: "general" as const, label: "General", hint: "Model, app, notifications" },
    { id: "capabilities" as const, label: "Capabilities", hint: "Tools, memory, and boundaries" },
    { id: "jobs" as const, label: "Recurring jobs", hint: "Scheduled prompts and history" },
    { id: "connections" as const, label: "Connections", hint: "Health, computers, MCP servers" },
  ];

  const capabilityGroups = [
    {
      title: "Every conversation",
      summary: "Built in and available without another connection.",
      items: [
        { name: "Workspace", tools: "work_search · work_code", description: "Find, read, write, search, and run bounded code or processes in the persistent owner workspace." },
        { name: "Public browser", tools: "browser_open", description: "Open and inspect public web pages in hosted Chrome, including a screenshot and replay. It has no personal browser cookies." },
        { name: "Conversation recall", tools: "search_conversations", description: "Search the owner’s earlier My AX conversation index. Conversation-local memory is also retained and compacted by Think." },
        { name: "Human decisions", tools: "ask_user", description: "Pause for one explicit multiple-choice decision and return the answer to the source conversation." },
        { name: "Recurring work", tools: "manage_jobs", description: "Create, update, pause, resume, run, delete, and inspect scheduled prompts." },
        { name: "Read-only delegation", tools: "delegate_many", description: "Ask up to two bounded child agents for independent analysis; the parent remains responsible for synthesis." },
        { name: "Interactive output", tools: "create_svelte_artifact", description: "Create a durable, sandboxed Svelte widget attached to this conversation." },
        { name: "Owner attention", tools: "notify_owner", description: "Create an owner-scoped Attention item and best-effort push for requested or important background updates." },
      ],
    },
    {
      title: "Available when connected",
      summary: "These appear only when the operator configures the provider.",
      items: [
        { name: "MCP servers", tools: "server-defined tools · mcp_code_mode", description: "Use tools and resources exposed by servers you add. Credentials stay in the server-side broker; approved read methods can be composed." },
        { name: "My Machine", tools: "machine.* through work_code", description: "Use methods published by the outbound machine companion, with the authority of its operating-system account." },
        { name: "Cloudbox", tools: "cloudbox.* through work_code", description: "Create a bounded clean repository run, inspect or modify its checkout, and execute commands with receipts." },
        { name: "Push notifications", tools: "browser subscription", description: "Deliver Attention updates to subscribed installed apps when VAPID and browser permission are configured." },
      ],
    },
  ];
  const visibleSections = $derived.by(() => {
    const query = settingsQuery.trim().toLowerCase();
    return query ? sections.filter((section) => `${section.label} ${section.hint}`.toLowerCase().includes(query)) : sections;
  });
  $effect(() => {
    if (settingsQuery && visibleSections.length && !visibleSections.some((section) => section.id === activeSection)) {
      activeSection = visibleSections[0].id;
    }
  });
  function openDrawer() {
    lastActiveElement = document.activeElement as HTMLElement | null;
    open = true;
    refreshJobs();
    tick().then(() => {
      if (dialogEl && !dialogEl.open) dialogEl.showModal();
      searchInput?.focus();
    });
  }
  function closeDrawer() {
    open = false;
    settingsQuery = "";
    if (dialogEl?.open) dialogEl.close();
    (lastActiveElement ?? document.getElementById("settings-button"))?.focus?.();
    lastActiveElement = null;
  }
  function toggleDrawer() {
    if (open) closeDrawer();
    else openDrawer();
  }
  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      toggleDrawer();
      return;
    }
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeDrawer();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const options = visibleSections;
      if (!options.length) return;
      e.preventDefault();
      const current = Math.max(0, options.findIndex((section) => section.id === activeSection));
      const delta = e.key === "ArrowDown" ? 1 : -1;
      activeSection = options[(current + delta + options.length) % options.length].id;
    }
  }

  // ── PWA install ─────────────────────────────────────────────────────
  let installPromptEvent = $state<any>(null);
  let showInstall = $state(false);
  let installHelp = $state<string | null>(null);

  function setupPwa() {
    window.addEventListener("beforeinstallprompt", (event: any) => {
      event.preventDefault();
      installPromptEvent = event;
      showInstall = true;
    });
    window.addEventListener("appinstalled", () => {
      showInstall = false;
    });
    const runningInstalled =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: window-controls-overlay)").matches ||
      (navigator as any).standalone === true;
    if (runningInstalled) return;
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showInstall = true;
    if (iOS) {
      installHelp = "On iPhone or iPad, use Share → Add to Home Screen.";
    } else if (!installPromptEvent) {
      installHelp =
        "If install is available, your browser will show an app install prompt here.";
    }
  }
  async function installPwa() {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    installPromptEvent = null;
    showInstall = false;
  }

  // ── Push ────────────────────────────────────────────────────────────
  type PushState = "unsupported" | "denied" | "available" | "enabled";
  let pushState = $state<PushState>("available");
  let pushStatus = $state("Not configured.");
  let pushNeedsRelink = $state(false);

  function urlBase64ToBytes(value: string) {
    const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
    const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  function bytesToUrlBase64(value: ArrayBuffer | null | undefined) {
    if (!value) return null;
    const bytes = new Uint8Array(value);
    let raw = "";
    for (const byte of bytes) raw += String.fromCharCode(byte);
    return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function currentVapidPublicKey() {
    const key = await fetch("/api/push/public-key", { credentials: "include" }).then((r) => r.json());
    const publicKey = key?.result?.publicKey as string | undefined;
    if (!publicKey) throw new Error("Push server key is not configured yet");
    return publicKey;
  }
  function subscriptionMatchesServerKey(sub: PushSubscription, publicKey: string) {
    const existingKey = bytesToUrlBase64(sub.options?.applicationServerKey);
    // Older browsers may not expose applicationServerKey; in that case keep
    // treating the subscription as usable and let server diagnostics decide.
    return !existingKey || existingKey === publicKey;
  }
  function setPushUi(state: PushState, message: string) {
    pushState = state;
    pushStatus = message;
  }
  async function savePushSubscription(sub: PushSubscription, oldEndpoint?: string) {
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(oldEndpoint ? { subscription: sub, oldEndpoint } : sub),
    });
    if (!response.ok) throw new Error("Subscription save failed");
  }
  async function refreshPushUi() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushUi("unsupported", "Push is not supported in this browser.");
      return;
    }
    if (Notification.permission === "denied") {
      setPushUi("denied", "Notifications are blocked in browser/site settings.");
      return;
    }
    const sub = await navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription());
    if (sub) {
      try {
        const publicKey = await currentVapidPublicKey();
        if (!subscriptionMatchesServerKey(sub, publicKey)) {
          pushNeedsRelink = true;
          setPushUi("available", "Notifications were registered with an old server key. Tap Relink push to repair.");
          return;
        }
        // The browser can retain its endpoint after the server row is lost or
        // stale. Re-upsert it whenever the app loads so an apparent local
        // “enabled” state cannot leave notify_owner with zero devices.
        await savePushSubscription(sub);
        pushNeedsRelink = false;
        setPushUi("enabled", "Push enabled and registered for this browser.");
      } catch {
        // Keep the repair action tappable rather than claiming an endpoint is
        // usable when it could not be stored for agent delivery.
        setPushUi("available", "Push is enabled locally but could not sync. Tap Enable push to retry.");
      }
      return;
    }
    setPushUi("available", Notification.permission === "granted" ? "Permission granted — finish push setup." : "Not configured.");
  }
  async function enablePush(forceRelink = false) {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw new Error("Push is not supported in this browser");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted");
      const publicKey = await currentVapidPublicKey();
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      let oldEndpoint: string | undefined;
      if (existing && (forceRelink || !subscriptionMatchesServerKey(existing, publicKey))) {
        oldEndpoint = existing.endpoint;
        await existing.unsubscribe().catch(() => false);
      }
      const current = await reg.pushManager.getSubscription();
      const sub = current ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey) as any,
      });
      await savePushSubscription(sub, oldEndpoint);
      pushNeedsRelink = false;
      setPushUi("enabled", "Push enabled and registered for this browser.");
    } catch (err: any) {
      pushStatus = err.message;
      refreshPushUi().catch(() => {});
    }
  }
  async function testPush() {
    try {
      const r = await fetch("/api/push/test", { method: "POST", credentials: "include" });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error?.message || `Test push failed${body?.result?.status ? ` (${body.result.status} ${body.result.statusText || ""})` : ""}`);
      const result = body?.result;
      pushStatus = result?.devices
        ? `Test push: ${result.delivered}/${result.devices} devices delivered${result.expired ? `, ${result.expired} needs relinking` : ""}${result.failed ? `, ${result.failed} failed` : ""}.`
        : "Test push sent.";
    } catch (err: any) {
      pushStatus = err.message;
    } finally {
      refreshPushUi().catch(() => {});
    }
  }

  // ── Recurring jobs ──────────────────────────────────────────────────
  interface Job {
    id: string;
    name: string;
    prompt: string;
    cadence_secs: number;
    status: "active" | "paused";
    last_run_at?: string | null;
    next_run_at?: string | null;
    last_error?: string | null;
  }
  let jobs = $state<Job[]>([]);
  let jobsStatusText = $state("");
  let jobName = $state("");
  let jobPrompt = $state("");
  let jobCadence = $state("60");

  function cadenceLabel(seconds: number) {
    return seconds === 60
      ? "every minute"
      : seconds === 300
        ? "every 5 min"
        : seconds === 900
          ? "every 15 min"
          : seconds === 3600
            ? "hourly"
            : seconds === 86400
              ? "daily"
              : `every ${seconds}s`;
  }
  function jobTimeLabel(value: string | null | undefined, empty: string) {
    if (!value) return empty;
    const v = value as string;
    const date = new Date(v.endsWith("Z") || v.includes("+") ? v : v.replace(" ", "T") + "Z");
    if (!Number.isFinite(date.getTime())) return empty;
    const delta = date.getTime() - Date.now();
    const abs = Math.abs(delta);
    if (abs < 55_000) return delta >= 0 ? "in <1m" : "<1m ago";
    if (abs < 3_600_000) return delta >= 0 ? `in ${Math.round(abs / 60_000)}m` : `${Math.round(abs / 60_000)}m ago`;
    if (abs < 86_400_000) return delta >= 0 ? `in ${Math.round(abs / 3_600_000)}h` : `${Math.round(abs / 3_600_000)}h ago`;
    return date.toLocaleString();
  }
  async function refreshJobs() {
    try {
      const response = await fetch("/api/jobs", { credentials: "include" });
      const body = await response.json();
      jobs = [...new Map((body?.result?.jobs ?? []).map((job: Job) => [job.id, job])).values()] as Job[];
    } catch (err: any) {
      jobsStatusText = err.message || "Jobs unavailable.";
    }
  }
  async function runJob(id: string) {
    await fetch(`/api/jobs/${encodeURIComponent(id)}/run`, { method: "POST" });
    jobsStatusText = "Job queued.";
    await refreshJobs();
  }
  async function pauseJob(job: Job) {
    await fetch(`/api/jobs/${encodeURIComponent(job.id)}/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: job.status !== "paused" }),
    });
    await refreshJobs();
  }
  async function deleteJob(id: string) {
    await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshJobs();
  }
  async function submitJob(e: SubmitEvent) {
    e.preventDefault();
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      jobsStatusText = "Start a conversation before adding a job.";
      return;
    }
    const response = await fetch("/api/jobs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: jobName.trim(),
        prompt: jobPrompt.trim(),
        cadenceSecs: Number(jobCadence),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      jobsStatusText = body?.error?.message || "Could not add job.";
      return;
    }
    jobName = "";
    jobPrompt = "";
    jobsStatusText = "Job added.";
    await refreshJobs();
  }

  // ── Model picker + catalog search ──────────────────────────────────
  function shortName(id: string) {
    return id.split("/").pop() ?? id;
  }
  function onModelChange(e: Event) {
    const sel = e.target as HTMLSelectElement;
    const opt = sel.selectedOptions?.[0];
    const reasoning = opt?.dataset.reasoning === "1";
    const declared = MODELS.find((m) => m.id === sel.value);
    setModel(sel.value, declared?.label ?? sel.value, declared?.reasoning ?? reasoning);
  }
  // Reasoning effort segmented control
  function pickReasoning(v: Reasoning) {
    setReasoning(v);
  }

  // Model catalog search (debounced)
  let modelSearch = $state("");
  let modelSearchResults = $state<{ id: string; label?: string }[]>([]);
  let modelSearchMsg = $state<string | null>(null);
  let modelSearchTimer: ReturnType<typeof setTimeout> | null = null;
  function onModelSearchInput(e: Event) {
    const q = (e.target as HTMLInputElement).value.trim();
    modelSearch = q;
    if (modelSearchTimer) clearTimeout(modelSearchTimer);
    if (!q) {
      modelSearchResults = [];
      modelSearchMsg = null;
      return;
    }
    modelSearchMsg = "Searching…";
    modelSearchTimer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/models/catalog?q=${encodeURIComponent(q)}`);
        const body = await response.json();
        const models = body?.result?.data ?? [];
        modelSearchResults = [...new Map(models.map((model: { id: string }) => [model.id, model])).values()] as typeof modelSearchResults;
        modelSearchMsg = models.length ? null : "No matching models.";
      } catch {
        modelSearchMsg = "Model search failed.";
      }
    }, 180);
  }
  function chooseFromCatalog(m: { id: string; label?: string; reasoning?: boolean }) {
    setModel(m.id, m.label ?? m.id, !!m.reasoning);
    modelSearch = "";
    modelSearchResults = [];
    modelSearchMsg = null;
  }

  // ── Theme cycle ─────────────────────────────────────────────────────
  function nextTheme(curr: "system" | "light" | "dark") {
    if (curr === "system") return "light";
    if (curr === "light") return "dark";
    return "system";
  }
  async function cycleTheme() {
    const prev = themeState.pref;
    const next = nextTheme(prev);
    applyTheme(next);
    try {
      const r = await fetch("/api/preferences/theme", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: next }),
      });
      if (!r.ok && r.status !== 204) throw new Error("theme save failed: " + r.status);
    } catch (err) {
      applyTheme(prev);
      console.warn("[theme]", err);
    }
  }
  function onSystemThemeChange() {
    if (themeState.pref === "system") applyTheme("system");
  }

  // ── lifecycle ───────────────────────────────────────────────────────
  // Relocate Health + Connectors mounts into the modal. ChatPage.tsx renders
  // them as siblings in <div id="settings-drawer-extra-mounts">; here we move
  // them into <div id="settings-extras-slot">. The mounts hydrate normally
  // on their original DOM nodes —
  // moving the node post-hydrate is harmless because Svelte tracks the
  // reactive root via the mount element identity, not its parent.
  function relocateExtras() {
    const slot = document.getElementById("settings-extras-slot");
    const source = document.getElementById("settings-drawer-extra-mounts");
    if (!slot || !source) return;
    while (source.firstChild) slot.appendChild(source.firstChild);
    source.remove();
  }

  onMount(() => {
    setupPwa();
    refreshPushUi();
    relocateExtras();
    // Settings open/close events
    window.addEventListener("my-ax:settings-open", openDrawer);
    window.addEventListener("my-ax:settings-close", closeDrawer);
    window.addEventListener("my-ax:settings-toggle", toggleDrawer);
    window.addEventListener("keydown", handleKeydown);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", onSystemThemeChange);
    return () => {
      window.removeEventListener("my-ax:settings-open", openDrawer);
      window.removeEventListener("my-ax:settings-close", closeDrawer);
      window.removeEventListener("my-ax:settings-toggle", toggleDrawer);
      window.removeEventListener("keydown", handleKeydown);
      mq.removeEventListener("change", onSystemThemeChange);
    };
  });

  // Derived: the active model's reasoning flag (drives effort visibility)
  const selectedSupportsReasoning = $derived(
    MODELS.find((m) => m.id === modelState.current)?.reasoning ??
      modelState.catalog.get(modelState.current)?.reasoning ??
      false,
  );

  // Model dropdown — declared list + any catalog-added.
  const allModels = $derived.by(() => {
    // Be defensive at the render boundary: catalog results and curated models
    // can converge on the same id after a deploy. A keyed Svelte each block
    // must never crash the entire Settings mount because of that overlap.
    const models = new Map<string, { id: string; label: string; reasoning: boolean }>();
    for (const m of MODELS) models.set(m.id, { id: m.id, label: m.label, reasoning: m.reasoning });
    for (const m of modelState.catalog.values()) if (!models.has(m.id)) models.set(m.id, m);
    return [...models.values()];
  });
</script>

<dialog
  bind:this={dialogEl}
  id="settings-drawer"
  data-open={open ? "1" : "0"}
  aria-labelledby="settings-title"
  class="settings-command z-50 w-[min(760px,calc(100vw-1rem))] max-h-[min(760px,calc(100dvh-1rem))] overflow-hidden border border-line bg-bg-alt p-0 text-fg"
  onclick={(event) => event.target === event.currentTarget && closeDrawer()}
  oncancel={(event) => { event.preventDefault(); closeDrawer(); }}
  onclose={() => { if (open) closeDrawer(); }}
>
  <header class="settings-header safe-area-appbar">
    <h2 id="settings-title" class="sr-only">Settings</h2>
    <div class="settings-search">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
      </svg>
      <input
        bind:this={searchInput}
        bind:value={settingsQuery}
        type="search"
        placeholder="Search settings…"
        aria-label="Search settings"
      />
      <kbd class="hidden sm:inline">⌘K</kbd>
    </div>
    <button type="button" onclick={closeDrawer} class="settings-close" aria-label="Close settings">Esc</button>
  </header>

  <div class="settings-layout grid flex-1 min-h-0 overflow-hidden">
    <nav aria-label="Settings sections" class="settings-nav flex gap-1 overflow-x-auto border-b border-line p-2 sm:flex-col sm:border-b-0 sm:border-r">
      {#each visibleSections as section}
        <button
          type="button"
          onclick={() => (activeSection = section.id)}
          aria-current={activeSection === section.id ? "page" : undefined}
          class="settings-nav-item min-w-max px-3 py-2 text-left sm:min-w-0"
          class:is-active={activeSection === section.id}
        >
          <span class="block text-sm font-medium">{section.label}</span>
          <span class="hidden text-[11px] text-fg-mut sm:block">{section.hint}</span>
        </button>
      {/each}
      {#if visibleSections.length === 0}<p class="px-2 py-3 text-xs text-fg-mut">No settings match.</p>{/if}
    </nav>

    <div class="settings-content min-h-0 max-h-full overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:thin] p-4 sm:p-5" data-settings-scroll>
      <div class="space-y-4" hidden={activeSection !== "general"}>
    {#if identityEmail}
      <div>
        <span class="block text-[11px] font-medium text-fg-mut mb-1.5 uppercase tracking-wider">Signed in</span>
        <div class="w-full rounded-md bg-bg border border-line text-fg text-sm font-mono px-3 py-2.5 min-h-[44px] flex items-center truncate" title={identityEmail}>
          {identityEmail}
        </div>
      </div>
    {/if}

    <div>
      <label for="drawer-model" class="block text-[11px] font-medium text-fg-mut mb-1.5 uppercase tracking-wider">Model</label>
      <select
        id="drawer-model"
        bind:value={modelState.current}
        onchange={onModelChange}
        class="w-full rounded-md bg-bg border border-line text-fg text-base sm:text-sm px-3 py-2.5 min-h-[44px] focus:outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/40"
      >
        {#each allModels as m (m.id)}
          <option value={m.id} data-reasoning={m.reasoning ? "1" : ""}>
            {shortName(m.label || m.id)}
          </option>
        {/each}
      </select>

      <div class="mt-2">
        <input
          type="search"
          placeholder="Search models"
          autocomplete="off"
          value={modelSearch}
          oninput={onModelSearchInput}
          class="w-full rounded-md bg-bg border border-line text-fg text-sm px-3 py-2 min-h-[40px] focus:outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/40"
        />
        <div class="mt-1.5 grid gap-1" aria-live="polite">
          {#if modelSearchMsg}
            <div class="text-xs text-fg-mut px-1">{modelSearchMsg}</div>
          {/if}
          {#each modelSearchResults as m (m.id)}
            <button
              type="button"
              onclick={() => chooseFromCatalog(m)}
              class="w-full text-left rounded-md border border-line bg-bg px-3 py-2 text-sm text-fg hover:border-brand/60"
            >
              {m.label && m.label !== m.id ? `${m.label} · ${m.id}` : m.id}
            </button>
          {/each}
        </div>
      </div>
    </div>

    {#if selectedSupportsReasoning}
      <div>
        <label class="block text-[11px] font-medium text-fg-mut mb-1.5 uppercase tracking-wider">
          Reasoning effort
        </label>
        <div class="grid grid-cols-3 gap-1 rounded-md bg-bg border border-line p-1">
          {#each ["low", "medium", "high"] as v}
            <button
              type="button"
              onclick={() => pickReasoning(v as Reasoning)}
              data-active={modelState.reasoning === v ? "1" : "0"}
              class="py-2 rounded text-xs font-medium text-fg-mut hover:text-fg data-[active='1']:bg-bg-alt data-[active='1']:text-fg data-[active='1']:shadow-raise transition-colors"
            >
              {v}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if showInstall}
      <section class="rounded-md border border-line bg-bg px-3 py-3">
        <span class="block text-[11px] font-medium text-fg-mut mb-1.5 uppercase tracking-wider">App</span>
        {#if installPromptEvent}
          <button
            type="button"
            onclick={installPwa}
            class="w-full rounded-md bg-brand text-white text-sm font-medium px-3 py-2.5 hover:bg-brand/90"
          >
            Install my · ax
          </button>
        {/if}
        {#if installHelp}
          <p class="mt-2 text-xs text-fg-mut">{installHelp}</p>
        {/if}
      </section>
    {/if}

    <section class="rounded-md border border-line bg-bg px-3 py-3">
      <span class="block text-[11px] font-medium text-fg-mut mb-1.5 uppercase tracking-wider">Notifications</span>
      <div class="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onclick={() => enablePush(pushNeedsRelink)}
          disabled={pushState === "enabled" || pushState === "unsupported"}
          class="rounded-md border border-line px-3 py-2 text-sm hover:border-brand/60 disabled:opacity-50"
        >
          {pushState === "enabled"
            ? "Push enabled"
            : pushState === "denied"
              ? "Notifications blocked"
              : pushNeedsRelink
                ? "Relink push"
                : "Enable push"}
        </button>
        {#if pushState === "enabled"}
          <button
            type="button"
            onclick={testPush}
            class="rounded-md border border-line px-3 py-2 text-sm hover:border-brand/60"
          >
            Send test push
          </button>
          <button
            type="button"
            onclick={() => enablePush(true)}
            class="rounded-md border border-line px-3 py-2 text-sm text-fg-mut hover:border-brand/60 hover:text-fg"
          >
            Relink push
          </button>
        {/if}
      </div>
      <p class="mt-2 text-xs text-fg-mut">{pushStatus}</p>
    </section>

      </div>

      <div hidden={activeSection !== "capabilities"} class="space-y-4">
        <header>
          <h3 class="text-sm font-semibold text-fg">Agent capabilities</h3>
          <p class="mt-1 text-xs leading-relaxed text-fg-mut">The model receives callable capabilities, not your raw credentials. Availability can still depend on deployment configuration and provider health.</p>
        </header>
        {#each capabilityGroups as group}
          <section class="rounded-lg border border-line bg-bg">
            <div class="border-b border-line px-3 py-2.5">
              <h4 class="text-xs font-semibold text-fg">{group.title}</h4>
              <p class="mt-0.5 text-[11px] text-fg-mut">{group.summary}</p>
            </div>
            <ul class="divide-y divide-line">
              {#each group.items as item}
                <li class="px-3 py-3">
                  <div class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <strong class="text-xs font-medium text-fg">{item.name}</strong>
                    <code class="max-w-full break-all text-[10px] text-brand">{item.tools}</code>
                  </div>
                  <p class="mt-1 text-[11px] leading-relaxed text-fg-mut">{item.description}</p>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
        <section class="rounded-lg border border-line bg-bg px-3 py-3">
          <h4 class="text-xs font-semibold text-fg">Important boundaries</h4>
          <ul class="mt-2 grid gap-1.5 text-[11px] leading-relaxed text-fg-mut">
            <li>• Workspace files are shared across this owner’s conversations; concurrent writes are not automatically merged.</li>
            <li>• Public Browser has no local cookies. Authenticated browsing requires an explicitly connected Machine capability.</li>
            <li>• Machine methods run with the companion OS account’s authority. Cloudbox and MCP retain their own configured authority.</li>
            <li>• Delegated children are model-only, depth one, and cannot use your application tools or connections.</li>
            <li>• Work Code Mode has no ambient secrets, database, network, or filesystem access; only named callbacks are callable.</li>
          </ul>
        </section>
      </div>

      <div hidden={activeSection !== "jobs"}>
    <section id="jobs" class="rounded-lg border border-line bg-bg px-3 py-3 sm:px-4">
      <span class="block text-[11px] font-medium text-fg-mut mb-1.5 uppercase tracking-wider">Recurring jobs</span>
      <p class="mb-3 text-xs text-fg-mut">
        Run a saved prompt in this conversation later. Prompts can ask the agent to notify you when attention is needed.
      </p>
      <div class="grid gap-2">
        {#if jobs.length === 0}
          <p class="text-xs text-fg-mut">No recurring jobs yet.</p>
        {:else}
          {#each jobs as job (job.id)}
            {@const lastRun = jobTimeLabel(job.last_run_at, "never run")}
            {@const nextRun = job.status === "paused" ? "paused" : jobTimeLabel(job.next_run_at, "not scheduled")}
            {@const result = job.last_error ? `failed · ${job.last_error}` : job.last_run_at ? "ok" : "waiting"}
            {@const state = job.status === "paused" ? "paused" : "active"}
            <article class="rounded-lg border border-line bg-bg-alt/40 p-3 text-xs">
              <div class="flex min-w-0 items-start justify-between gap-3">
                <strong class="min-w-0 break-words text-sm text-fg">{job.name}</strong>
                <span class="shrink-0 rounded-full bg-surface-2 px-2 py-1 text-[10px] text-fg-mut">{cadenceLabel(job.cadence_secs)}</span>
              </div>
              <div class="mt-1 text-fg-mut line-clamp-2">{job.prompt}</div>
              <div class="mt-2 grid gap-0.5 font-mono text-[11px] text-fg-mut">
                <div>{state} · next {nextRun}</div>
                <div data-job-result={job.last_error ? "error" : "ok"}>last {lastRun} · {result}</div>
              </div>
              <div class="mt-3 grid grid-cols-3 gap-2">
                <button type="button" onclick={() => runJob(job.id)} class="min-h-[40px] rounded-md border border-line px-2 py-2 font-medium hover:border-brand/60">Run</button>
                <button type="button" onclick={() => pauseJob(job)} class="min-h-[40px] rounded-md border border-line px-2 py-2 font-medium hover:border-brand/60">
                  {job.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button type="button" onclick={() => deleteJob(job.id)} class="min-h-[40px] rounded-md border border-line px-2 py-2 text-fg-mut hover:border-red-500/60 hover:text-red-500">Delete</button>
              </div>
            </article>
          {/each}
        {/if}
      </div>
      <form onsubmit={submitJob} class="mt-3 grid gap-2">
        <input
          type="text"
          maxlength={200}
          placeholder="Job name"
          bind:value={jobName}
          class="w-full min-h-[44px] rounded-md bg-bg border border-line text-fg text-base sm:text-sm px-3 py-2 focus:outline-none focus:border-brand/60"
        />
        <textarea
          rows={2}
          maxlength={4000}
          placeholder="Prompt to run"
          bind:value={jobPrompt}
          class="w-full min-h-[72px] rounded-md bg-bg border border-line text-fg text-base sm:text-sm px-3 py-2 focus:outline-none focus:border-brand/60"
        ></textarea>
        <select bind:value={jobCadence} class="w-full min-h-[44px] rounded-md bg-bg border border-line text-fg text-base sm:text-sm px-3 py-2">
          <option value="60">Every minute</option>
          <option value="300">Every 5 minutes</option>
          <option value="900">Every 15 minutes</option>
          <option value="3600">Every hour</option>
          <option value="86400">Every day</option>
        </select>
        <button type="submit" class="min-h-[44px] rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90">Add recurring job</button>
      </form>
      <p class="mt-2 text-xs text-fg-mut">{jobsStatusText}</p>
    </section>

      </div>

      <!-- Health + Connectors panels live in other Svelte mounts and are
           relocated into this stable slot by the mount effect. -->
      <div hidden={activeSection !== "connections"}>
        <div id="settings-extras-slot" class="space-y-4"></div>
      </div>

    <!-- Footer: theme cycle + gitlab link -->
    <footer class="pt-3 mt-1 flex flex-col items-center gap-2">
      <button
        type="button"
        onclick={cycleTheme}
        aria-label="Cycle theme"
        title="Cycle theme (system → light → dark)"
        data-theme={themeState.pref}
        class="inline-flex items-center justify-center w-7 h-7 rounded-md text-fg-mut/70 hover:text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors"
      >
        {#if themeState.pref === "system"}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4Z" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
          </svg>
        {:else if themeState.pref === "light"}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
          </svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        {/if}
      </button>
      <a
        href="https://github.com/acoyfellow/my-ax"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1.5 text-[11px] text-fg-mut/70 hover:text-fg-mut transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.4.8-1.7-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/>
        </svg>
        <span>github.com/acoyfellow/my-ax</span>
      </a>
    </footer>
    </div>
  </div>
</dialog>

<style>
  .settings-command {
    position: fixed;
    inset: max(0.5rem, env(safe-area-inset-top)) auto auto 50%;
    height: min(760px, calc(100dvh - 1rem));
    margin: 0;
    transform: translateX(-50%);
    border-radius: 18px;
    box-shadow: 0 28px 80px rgb(0 0 0 / 0.32), 0 2px 10px rgb(0 0 0 / 0.12);
  }

  .settings-command[open] {
    display: flex;
    flex-direction: column;
  }

  .settings-command::backdrop {
    background: rgb(0 0 0 / 0.56);
    backdrop-filter: blur(3px);
  }

  .settings-header {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    min-height: 68px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-alt);
  }

  .settings-search {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 10px;
    height: 42px;
    padding: 0 10px 0 12px;
    color: var(--fg-mut);
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
    transition: border-color 120ms, box-shadow 120ms, background 120ms;
  }

  .settings-search:focus-within {
    color: var(--fg);
    border-color: color-mix(in srgb, var(--brand) 70%, var(--line));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 14%, transparent);
  }

  .settings-search input {
    min-width: 0;
    flex: 1;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    outline: 0;
    color: var(--fg);
    background: transparent;
    font: inherit;
    font-size: 15px;
    box-shadow: none;
    appearance: none;
  }

  .settings-search input::-webkit-search-cancel-button { display: none; }
  .settings-search input::placeholder { color: color-mix(in srgb, var(--fg-mut) 78%, transparent); }

  .settings-search kbd,
  .settings-close {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    padding: 0 8px;
    color: var(--fg-mut);
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--bg-alt);
    font-family: 'JetBrains Mono Variable', 'JetBrains Mono', monospace;
    font-size: 10px;
    line-height: 1;
    box-shadow: 0 1px 1px rgb(0 0 0 / 0.05);
  }

  .settings-close {
    min-height: 36px;
    padding-inline: 11px;
    background: var(--bg);
    font-family: inherit;
    font-size: 12px;
    transition: color 120ms, border-color 120ms, background 120ms;
  }

  .settings-close:hover {
    color: var(--fg);
    border-color: color-mix(in srgb, var(--fg-mut) 55%, var(--line));
    background: var(--surface-2);
  }

  .settings-layout {
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--bg-alt);
  }

  .settings-nav {
    background: color-mix(in srgb, var(--bg) 68%, var(--bg-alt));
    scrollbar-width: none;
  }

  .settings-nav::-webkit-scrollbar { display: none; }

  .settings-nav-item {
    position: relative;
    color: var(--fg-mut);
    border: 1px solid transparent;
    border-radius: 9px;
    transition: color 120ms, border-color 120ms, background 120ms, box-shadow 120ms;
  }

  .settings-nav-item:hover {
    color: var(--fg);
    background: color-mix(in srgb, var(--surface-2) 70%, transparent);
  }

  .settings-nav-item.is-active {
    color: var(--fg);
    border-color: var(--line);
    background: var(--bg-alt);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
  }

  .settings-nav-item.is-active::before {
    content: "";
    position: absolute;
    top: 9px;
    bottom: 9px;
    left: -1px;
    width: 2px;
    border-radius: 2px;
    background: var(--brand);
  }

  .settings-content {
    background: var(--bg-alt);
    scrollbar-gutter: stable;
  }

  @media (min-width: 640px) {
    .settings-command { top: 6vh; }
    .settings-layout {
      grid-template-columns: 190px minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
    }
  }

  @media (max-width: 639px) {
    .settings-command {
      width: calc(100vw - 1rem);
      height: calc(100dvh - max(1rem, env(safe-area-inset-top) + env(safe-area-inset-bottom)));
      max-height: calc(100dvh - max(1rem, env(safe-area-inset-top) + env(safe-area-inset-bottom)));
      border-radius: 14px;
    }
    .settings-header { min-height: 60px; padding: 9px; gap: 8px; }
    .settings-search { height: 40px; }
    .settings-close { min-height: 40px; }
    .settings-nav-item.is-active::before { display: none; }
  }
</style>
