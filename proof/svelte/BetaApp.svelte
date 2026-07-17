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
</script>

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
