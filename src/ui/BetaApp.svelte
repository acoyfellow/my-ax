<script lang="ts">
  // BetaApp.svelte — the proper my.ax frontend: ONE single-root Svelte app that
  // nests the core surfaces as child components, instead of the prod shell's
  // separate hydration mounts wired together with window events. Same
  // @my-ax/store, same API/WS, same child components (1:1 baseline) — assembled
  // as a cohesive tree so state flows by props/store within one mount.
  //
  // Served at /beta (additive, behind the same Access). Prod / is untouched.
  //
  // NOTE (L1 scaffold): ComputerHealth + Connectors still render as sibling
  // nodes that Settings relocates into its Connections tab (the existing
  // mechanism), kept identical here for 1:1 behavior. Converting that to a
  // Svelte snippet slot is a bounded follow-up (L3) that removes the last
  // DOM-move; not required for single-root parity of the main tree.
  import AppShell from "./AppShell.svelte";
  import Chat from "./Chat.svelte";
  import Sessions from "./Sessions.svelte";
  import Settings from "./Settings.svelte";
  import ComputerHealth from "./ComputerHealth.svelte";
  import Connectors from "./Connectors.svelte";

  interface Props {
    identityEmail?: string | null;
    initialTheme?: "system" | "light" | "dark";
  }
  const { identityEmail = null, initialTheme = "system" }: Props = $props();

  let vpDebug = $state<string>("");
  let vpDebugOn = $state(false);
  $effect(() => {
    if (typeof window === "undefined") return;
    if (/[?&]vpdebug=1/.test(location.search)) localStorage.setItem("my-ax-vpdebug", "1");
    if (/[?&]vpdebug=0/.test(location.search)) localStorage.removeItem("my-ax-vpdebug");
    if (localStorage.getItem("my-ax-vpdebug") !== "1") return;
    vpDebugOn = true;
    const measure = () => {
      const b = document.body.getBoundingClientRect();
      const composer = document.querySelector(".safe-area-composer");
      const wrap = composer?.closest(".flex-none") as HTMLElement | null;
      const w = wrap?.getBoundingClientRect();
      const cs = composer ? getComputedStyle(composer) : null;
      const bs = getComputedStyle(document.body);
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;height:env(safe-area-inset-bottom);width:0;visibility:hidden";
      document.body.appendChild(probe);
      const sab = Math.round(parseFloat(getComputedStyle(probe).height) || 0);
      probe.remove();
      vpDebug = [
        `standalone ${standalone}`,
        `innerH ${window.innerHeight}`,
        `visualH ${Math.round(window.visualViewport?.height ?? 0)}`,
        `screenH ${window.screen?.height ?? "?"}`,
        `dvh ${document.documentElement.clientHeight}`,
        `safeAreaBottom ${sab}`,
        `bodyBottom ${Math.round(b.bottom)}`,
        `gapUnderBody ${Math.round(window.innerHeight - b.bottom)}`,
        `composerBottom ${w ? Math.round(w.bottom) : "n/a"}`,
        `gapUnderComposer ${w ? Math.round(window.innerHeight - w.bottom) : "n/a"}`,
        `bodyPos ${bs.position}`,
        `bodyH ${bs.height}`,
        `composerPadB ${cs?.paddingBottom ?? "n/a"}`,
      ].join("  ");
    };
    measure();
    const id = setInterval(measure, 500);
    window.addEventListener("resize", measure, { passive: true });
    return () => { clearInterval(id); window.removeEventListener("resize", measure); };
  });
</script>

{#if vpDebugOn}
  <div style="position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:2147483647">
    <div style="position:absolute;inset:0;border:3px solid magenta"></div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:env(safe-area-inset-bottom);background:rgba(255,0,0,.45)"></div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:2px;background:lime"></div>
    <div style="position:absolute;left:6px;right:6px;top:calc(env(safe-area-inset-top) + 60px);font:600 12px/1.35 ui-monospace,monospace;color:#0f0;background:rgba(0,0,0,.82);padding:8px;border-radius:8px;word-break:break-word">{vpDebug}</div>
  </div>
{/if}

<div class="h-full flex flex-col">
  <AppShell {identityEmail} />
  <div class="flex-1 min-h-0 flex flex-col">
    <Chat />
  </div>
</div>

<Sessions />
<Settings {identityEmail} {initialTheme} />

<!-- Panels Settings relocates into its Connections tab (same mechanism as prod). -->
<div id="settings-drawer-extra-mounts" class="hidden" aria-hidden="true">
  <ComputerHealth />
  <Connectors />
</div>
