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
  let activeSection = $state<"general" | "capabilities" | "recipes" | "jobs" | "connections">("general");
  let lastActiveElement: HTMLElement | null = null;
  const sections = [
    { id: "general" as const, label: "General", hint: "Model, app, notifications" },
    { id: "capabilities" as const, label: "Capabilities", hint: "What the agent can use" },
    { id: "recipes" as const, label: "Snippets", hint: "Saved Code Mode shortcuts" },
    { id: "jobs" as const, label: "Recurring jobs", hint: "Scheduled work" },
    { id: "connections" as const, label: "Connections", hint: "Runtime and services" },
  ];

  const capabilityGroups = [
    {
      title: "Can work here",
      summary: "Available in a normal chat.",
      items: [
        { name: "Workspace", tools: "work_search · work_code", description: "Read files, search, edit, and run bounded commands in your workspace." },
        { name: "Saved snippets", tools: "codemode.search · codemode.run", description: "Run owner-approved Code Mode shortcuts from work_code." },
        { name: "Recurring work", tools: "manage_jobs", description: "Create and inspect scheduled prompts." },
      ],
    },
    {
      title: "Can look around",
      summary: "Useful context without local secrets.",
      items: [
        { name: "Public browser", tools: "browser_open", description: "Open public pages with a screenshot and replay. No personal cookies." },
        { name: "Conversation recall", tools: "search_conversations", description: "Search your earlier My AX conversations." },
        { name: "Interactive output", tools: "create_svelte_artifact", description: "Attach a sandboxed Svelte widget to the conversation." },
      ],
    },
    {
      title: "Can ask or delegate",
      summary: "Human checkpoints and bounded child analysis.",
      items: [
        { name: "Human decisions", tools: "ask_user", description: "Pause for one multiple-choice decision." },
        { name: "Read-only delegation", tools: "delegate_many", description: "Ask up to two child agents for independent read-only analysis." },
        { name: "Owner attention", tools: "notify_owner", description: "Leave an Attention item when background work needs you." },
      ],
    },
    {
      title: "When connected",
      summary: "Only appears after you configure the service.",
      items: [
        { name: "MCP servers", tools: "server tools · mcp_code_mode", description: "Use tools from servers you add. Credentials stay server-side." },
        { name: "Workspace container", tools: "machine.* through work_code", description: "Use methods from the connected runtime with that runtime’s account." },
        { name: "Cloudbox", tools: "cloudbox.* through work_code", description: "Run bounded repo work in a clean Cloudflare computer." },
        { name: "Push notifications", tools: "browser subscription", description: "Send Attention updates to subscribed browsers." },
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
    refreshRecipes();
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
  let jobActionBusy = $state<Record<string, boolean>>({});

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
  async function jobAction(id: string, operation: "run" | "pause" | "delete", request: () => Promise<Response>, success?: string) {
    const key = `${id}:${operation}`;
    if (jobActionBusy[key]) return;
    jobActionBusy[key] = true;
    try {
      const response = await request();
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message || body?.error?.code || `Job ${operation} failed (${response.status}).`);
      }
      if (success) jobsStatusText = success;
      await refreshJobs();
    } catch (err: any) {
      jobsStatusText = err?.message || `Could not ${operation} job.`;
    } finally {
      jobActionBusy[key] = false;
    }
  }
  async function runJob(id: string) {
    await jobAction(id, "run", () => fetch(`/api/jobs/${encodeURIComponent(id)}/run`, { method: "POST" }), "Job queued.");
  }
  async function pauseJob(job: Job) {
    await jobAction(job.id, "pause", () => fetch(`/api/jobs/${encodeURIComponent(job.id)}/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: job.status !== "paused" }),
    }));
  }
  async function deleteJob(id: string) {
    if (!confirm("Delete this recurring job? Existing run receipts stay, but it will not run again.")) return;
    await jobAction(id, "delete", () => fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }));
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

  // ── Saved snippets ─────────────────────────────────────────────────
  interface Recipe {
    id: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    capabilities: string[];
    sourceRunId?: string | null;
    status: "enabled" | "disabled";
    updatedAt?: string;
  }
  let recipes = $state<Recipe[]>([]);
  let recipeStatusText = $state("");
  let recipeBusy = $state<Record<string, boolean>>({});
  let editingRecipeId = $state<string | null>(null);
  let recipeName = $state("");
  let recipeDescription = $state("");
  let recipeInputSchema = $state('{"type":"object","properties":{}}');
  let recipeCode = $state("");
  let recipeCapabilities = $state("workspace.read");
  const recipeTemplates = [
    {
      name: "read_workspace_file",
      title: "Read a workspace file",
      description: "Read one explicit file from the My AX workspace.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      code: "return await workspace.read({ path: input.path });",
      capabilities: ["workspace.read"],
    },
    {
      name: "search_workspace",
      title: "Search workspace notes",
      description: "Search the owner workspace for a query in a bounded path.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, path: { type: "string", default: "/home/user" } }, required: ["query"] },
      code: "return await workspace.search({ query: input.query, path: input.path || \"/home/user\" });",
      capabilities: ["workspace.search"],
    },
    {
      name: "write_workspace_note",
      title: "Write a workspace note",
      description: "Write reviewed text to one explicit workspace path.",
      inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      code: "return await workspace.write({ path: input.path, content: input.content });",
      capabilities: ["workspace.write"],
    },
    {
      name: "run_workspace_check",
      title: "Run a bounded workspace check",
      description: "Run one reviewed command in the workspace with a short timeout.",
      inputSchema: { type: "object", properties: { command: { type: "string" }, timeoutMs: { type: "number", default: 30000 } }, required: ["command"] },
      code: "return await workspace.exec({ command: input.command, timeoutMs: Math.min(Number(input.timeoutMs || 30000), 60000) });",
      capabilities: ["workspace.exec"],
    },
  ];

  async function refreshRecipes() {
    try {
      const response = await fetch("/api/recipes", { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || "Recipes unavailable.");
      recipes = body?.result?.recipes ?? [];
    } catch (err: any) {
      recipeStatusText = err?.message || "Recipes unavailable.";
    }
  }
  function resetRecipeForm() {
    editingRecipeId = null;
    recipeName = "";
    recipeDescription = "";
    recipeInputSchema = '{"type":"object","properties":{}}';
    recipeCode = "";
    recipeCapabilities = "workspace.read";
  }
  function useRecipeTemplate(template: (typeof recipeTemplates)[number]) {
    editingRecipeId = null;
    recipeName = template.name;
    recipeDescription = template.description;
    recipeInputSchema = JSON.stringify(template.inputSchema, null, 2);
    recipeCode = template.code;
    recipeCapabilities = template.capabilities.join("\n");
    recipeStatusText = `Template loaded: ${template.title}. Review it, then save.`;
  }
  async function editRecipe(recipe: Recipe) {
    editingRecipeId = recipe.id;
    recipeName = recipe.name;
    recipeDescription = recipe.description;
    recipeInputSchema = JSON.stringify(recipe.inputSchema ?? { type: "object", properties: {} }, null, 2);
    recipeCode = "Loading…";
    recipeCapabilities = recipe.capabilities.join("\n");
    try {
      const response = await fetch(`/api/recipes/${encodeURIComponent(recipe.id)}`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || "Could not load recipe.");
      recipeCode = body.result.recipe.code ?? "";
    } catch (err: any) {
      recipeStatusText = err?.message || "Could not load recipe.";
    }
  }
  function recipePayload() {
    let inputSchema: Record<string, unknown>;
    try { inputSchema = JSON.parse(recipeInputSchema); }
    catch { throw new Error("Input schema must be valid JSON."); }
    return {
      name: recipeName.trim(),
      description: recipeDescription.trim(),
      inputSchema,
      code: recipeCode.trim(),
      capabilities: recipeCapabilities.split(/[\n,]/).map((cap) => cap.trim()).filter(Boolean),
    };
  }
  async function submitRecipe(e: SubmitEvent) {
    e.preventDefault();
    try {
      const payload = recipePayload();
      const url = editingRecipeId ? `/api/recipes/${encodeURIComponent(editingRecipeId)}` : "/api/recipes";
      const response = await fetch(url, { method: editingRecipeId ? "PATCH" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || "Could not save recipe.");
      recipeStatusText = editingRecipeId ? "Recipe updated." : "Recipe saved.";
      resetRecipeForm();
      await refreshRecipes();
    } catch (err: any) {
      recipeStatusText = err?.message || "Could not save recipe.";
    }
  }
  async function recipeAction(id: string, operation: "status" | "delete" | "run", request: () => Promise<Response>, success?: string) {
    const key = `${id}:${operation}`;
    if (recipeBusy[key]) return;
    recipeBusy[key] = true;
    try {
      const response = await request();
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || `Recipe ${operation} failed.`);
      recipeStatusText = success ?? "Recipe updated.";
      await refreshRecipes();
    } catch (err: any) {
      recipeStatusText = err?.message || `Could not ${operation} recipe.`;
    } finally {
      recipeBusy[key] = false;
    }
  }
  async function toggleRecipe(recipe: Recipe) {
    await recipeAction(recipe.id, "status", () => fetch(`/api/recipes/${encodeURIComponent(recipe.id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: recipe.status === "enabled" ? "disabled" : "enabled" }) }));
  }
  async function deleteRecipe(id: string) {
    if (!confirm("Delete this saved recipe? Existing run receipts stay, but Code Mode can no longer use it.")) return;
    await recipeAction(id, "delete", () => fetch(`/api/recipes/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" }), "Recipe deleted.");
    if (editingRecipeId === id) resetRecipeForm();
  }
  async function runRecipe(recipe: Recipe) {
    const sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      recipeStatusText = "Start a conversation before running a recipe.";
      return;
    }
    await recipeAction(recipe.id, "run", () => fetch(`/api/recipes/${encodeURIComponent(recipe.id)}/run`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, input: {} }) }), "Recipe run queued; Check-in will show the receipt.");
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
          <h3 class="text-sm font-semibold text-fg">What the agent can use</h3>
          <p class="mt-1 text-xs leading-relaxed text-fg-mut">These are callable tools. They are not raw credentials.</p>
        </header>
        <div class="grid gap-3 sm:grid-cols-2">
          {#each capabilityGroups as group}
            <section class="rounded-lg border border-line bg-bg p-3">
              <div>
                <h4 class="text-xs font-semibold text-fg">{group.title}</h4>
                <p class="mt-0.5 text-[11px] text-fg-mut">{group.summary}</p>
              </div>
              <ul class="mt-3 grid gap-2">
                {#each group.items as item}
                  <li class="rounded-md border border-line/60 bg-bg-alt/40 px-2.5 py-2">
                    <div class="flex min-w-0 items-center justify-between gap-2">
                      <strong class="truncate text-xs font-medium text-fg">{item.name}</strong>
                      <code class="shrink-0 max-w-[48%] truncate text-[10px] text-brand" title={item.tools}>{item.tools}</code>
                    </div>
                    <p class="mt-1 text-[11px] leading-snug text-fg-mut">{item.description}</p>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
        <section class="rounded-lg border border-line bg-bg px-3 py-3">
          <h4 class="text-xs font-semibold text-fg">Boundaries</h4>
          <ul class="mt-2 grid gap-1.5 text-[11px] leading-relaxed text-fg-mut sm:grid-cols-2">
            <li>Workspace files are shared across your conversations.</li>
            <li>The public browser has no personal cookies.</li>
            <li>Connected runtimes use their own account authority.</li>
            <li>Delegated child agents are read-only and model-only.</li>
            <li>Work Code Mode only calls named callbacks.</li>
          </ul>
        </section>
      </div>

      <div hidden={activeSection !== "recipes"} class="space-y-4">
        <section class="rounded-lg border border-line bg-bg px-3 py-3 sm:px-4">
          <span class="block text-[11px] font-medium text-fg-mut mb-1.5 uppercase tracking-wider">Saved snippets</span>
          <p class="mb-3 text-xs text-fg-mut">
            Owner-approved Code Mode snippets. Enabled snippets appear inside <code>work_code</code> through <code>codemode.search()</code>, <code>codemode.describe(...)</code>, and <code>codemode.run(...)</code>; every run creates a receipt.
          </p>
          <div class="grid gap-2">
            {#if recipes.length === 0}
              <p class="text-xs text-fg-mut">No saved snippets yet. Promote a successful work_code run, or create one below.</p>
            {:else}
              {#each recipes as recipe (recipe.id)}
                <article class="rounded-lg border border-line bg-bg-alt/40 p-3 text-xs">
                  <div class="flex min-w-0 items-start justify-between gap-3">
                    <div class="min-w-0">
                      <strong class="break-words text-sm text-fg">{recipe.name}</strong>
                      <p class="mt-1 text-fg-mut line-clamp-2">{recipe.description}</p>
                    </div>
                    <span class="shrink-0 rounded-full bg-surface-2 px-2 py-1 text-[10px] text-fg-mut">{recipe.status}</span>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-1">
                    {#each recipe.capabilities as capability}
                      <code class="rounded-full bg-bg px-2 py-1 text-[10px] text-brand">{capability}</code>
                    {/each}
                  </div>
                  <div class="mt-3 flex justify-end gap-1.5" aria-label={`Actions for ${recipe.name}`}>
                    <button type="button" onclick={() => runRecipe(recipe)} disabled={recipeBusy[`${recipe.id}:run`] || recipe.status !== "enabled"} aria-busy={recipeBusy[`${recipe.id}:run`]} aria-label={`Run ${recipe.name}`} title="Run" class="settings-icon-action text-brand hover:border-brand/60 disabled:opacity-40"><span aria-hidden="true">▶</span></button>
                    <button type="button" onclick={() => editRecipe(recipe)} aria-label={`Edit ${recipe.name}`} title="Edit" class="settings-icon-action hover:border-brand/60"><span aria-hidden="true">✎</span></button>
                    <button type="button" onclick={() => toggleRecipe(recipe)} disabled={recipeBusy[`${recipe.id}:status`]} aria-busy={recipeBusy[`${recipe.id}:status`]} aria-label={recipe.status === "enabled" ? `Disable ${recipe.name}` : `Enable ${recipe.name}`} title={recipe.status === "enabled" ? "Disable" : "Enable"} class="settings-icon-action hover:border-brand/60 disabled:opacity-40"><span aria-hidden="true">{recipe.status === "enabled" ? "⏸" : "⏵"}</span></button>
                    <button type="button" onclick={() => deleteRecipe(recipe.id)} disabled={recipeBusy[`${recipe.id}:delete`]} aria-busy={recipeBusy[`${recipe.id}:delete`]} aria-label={`Delete ${recipe.name}`} title="Delete" class="settings-icon-action text-fg-mut hover:border-red-500/60 hover:text-red-500 disabled:opacity-40"><span aria-hidden="true">×</span></button>
                  </div>
                </article>
              {/each}
            {/if}
          </div>
          <p class="mt-2 text-xs text-fg-mut" role="status" aria-live="polite">{recipeStatusText}</p>
        </section>

        <section class="rounded-lg border border-line bg-bg px-3 py-3 sm:px-4">
          <span class="block text-[11px] font-medium text-fg-mut mb-1.5 uppercase tracking-wider">Starter snippets</span>
          <p class="mb-3 text-xs text-fg-mut">Pick a generic snippet, review the code and capabilities, then save your own copy. Templates are never enabled automatically.</p>
          <div class="grid gap-2 sm:grid-cols-2">
            {#each recipeTemplates as template}
              <button type="button" onclick={() => useRecipeTemplate(template)} class="rounded-lg border border-line bg-bg-alt/40 p-3 text-left hover:border-brand/60">
                <strong class="text-sm text-fg">{template.title}</strong>
                <p class="mt-1 text-xs leading-relaxed text-fg-mut">{template.description}</p>
                <div class="mt-2 flex flex-wrap gap-1">
                  {#each template.capabilities as capability}<code class="rounded-full bg-bg px-2 py-1 text-[10px] text-brand">{capability}</code>{/each}
                </div>
              </button>
            {/each}
          </div>
        </section>

        <form onsubmit={submitRecipe} class="rounded-lg border border-line bg-bg px-3 py-3 sm:px-4 grid gap-2">
          <div class="flex items-center justify-between gap-3">
            <span class="block text-[11px] font-medium text-fg-mut uppercase tracking-wider">{editingRecipeId ? "Edit recipe" : "Create manually"}</span>
            {#if editingRecipeId}<button type="button" onclick={resetRecipeForm} class="text-xs text-fg-mut hover:text-fg">Cancel edit</button>{/if}
          </div>
          <input type="text" maxlength={64} placeholder="name_like_this" bind:value={recipeName} class="w-full min-h-[44px] rounded-md bg-bg border border-line text-fg text-base sm:text-sm px-3 py-2 focus:outline-none focus:border-brand/60" />
          <textarea rows={2} maxlength={500} placeholder="Description" bind:value={recipeDescription} class="w-full min-h-[64px] rounded-md bg-bg border border-line text-fg text-base sm:text-sm px-3 py-2 focus:outline-none focus:border-brand/60"></textarea>
          <textarea rows={4} placeholder="return input;" bind:value={recipeCode} class="font-mono w-full min-h-[112px] rounded-md bg-bg border border-line text-fg text-sm px-3 py-2 focus:outline-none focus:border-brand/60"></textarea>
          <textarea rows={3} placeholder="Input schema JSON" bind:value={recipeInputSchema} class="font-mono w-full min-h-[88px] rounded-md bg-bg border border-line text-fg text-xs px-3 py-2 focus:outline-none focus:border-brand/60"></textarea>
          <textarea rows={2} placeholder="workspace.read" bind:value={recipeCapabilities} class="font-mono w-full min-h-[64px] rounded-md bg-bg border border-line text-fg text-xs px-3 py-2 focus:outline-none focus:border-brand/60"></textarea>
          <button type="submit" class="min-h-[44px] rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90">{editingRecipeId ? "Update recipe" : "Save recipe"}</button>
        </form>
      </div>

      <div hidden={activeSection !== "jobs"}>
    <section id="jobs" class="rounded-lg border border-line bg-bg px-3 py-3 sm:px-4">
      <span class="block text-[11px] font-medium text-fg-mut mb-1.5 uppercase tracking-wider">Recurring jobs</span>
      <p class="mb-3 text-xs text-fg-mut">
        Runs in this conversation on each tick. A future setting can start a fresh conversation per run; today, job history stays attached here.
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
              <div class="mt-3 flex justify-end gap-1.5" aria-label={`Actions for ${job.name}`}>
                <button type="button" onclick={() => runJob(job.id)} disabled={jobActionBusy[`${job.id}:run`]} aria-busy={jobActionBusy[`${job.id}:run`]} aria-label={`Run ${job.name} now`} title="Run now" class="settings-icon-action text-brand hover:border-brand/60 disabled:opacity-40"><span aria-hidden="true">▶</span></button>
                <button type="button" onclick={() => pauseJob(job)} disabled={jobActionBusy[`${job.id}:pause`]} aria-busy={jobActionBusy[`${job.id}:pause`]} aria-label={job.status === "paused" ? `Resume ${job.name}` : `Pause ${job.name}`} title={job.status === "paused" ? "Resume" : "Pause"} class="settings-icon-action hover:border-brand/60 disabled:opacity-40"><span aria-hidden="true">{job.status === "paused" ? "⏵" : "⏸"}</span></button>
                <button type="button" onclick={() => deleteJob(job.id)} disabled={jobActionBusy[`${job.id}:delete`]} aria-busy={jobActionBusy[`${job.id}:delete`]} aria-label={`Delete ${job.name}`} title="Delete" class="settings-icon-action text-fg-mut hover:border-red-500/60 hover:text-red-500 disabled:opacity-40"><span aria-hidden="true">×</span></button>
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
      <p class="mt-2 text-xs text-fg-mut" role="status" aria-live="polite">{jobsStatusText}</p>
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

  .settings-icon-action {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    border: 1px solid var(--line);
    background: var(--bg);
    font-size: 0.875rem;
    font-weight: 700;
    transition: border-color 120ms, color 120ms, background 120ms;
  }

  .settings-icon-action:hover {
    background: var(--surface-2);
  }

  .settings-icon-action:focus-visible {
    outline: 2px solid rgba(246, 130, 31, 0.7);
    outline-offset: 2px;
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
