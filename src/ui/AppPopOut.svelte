<script lang="ts">
  import { onMount } from "svelte";
  import NavIconButton from "./NavIconButton.svelte";
  import { APP_PIP_OPTIONS, copiedStyles, documentPip, mirroredAttributes } from "./root-pip";

  const APP_MOUNT_ID = "svelte-hono-beta-root";
  const PIP_RESET_PROPERTIES = ["--sessions-dock-width", "--attention-dock-width"] as const;

  let supported = $state(false);
  let popped = $state(false);
  let pipWindow: Window | null = null;

  function copyDocumentShell(target: Document) {
    for (const [name, value] of mirroredAttributes(document.documentElement)) target.documentElement.setAttribute(name, value);
    for (const style of copiedStyles(document.styleSheets)) {
      if (style.kind === "link") {
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = style.href;
        target.head.append(link);
      } else {
        const element = target.createElement("style");
        element.textContent = style.css;
        target.head.append(element);
      }
    }
    for (const name of PIP_RESET_PROPERTIES) target.documentElement.style.setProperty(name, "0px");
    target.documentElement.dataset.pip = "1";
    target.title = document.title;
    target.body.className = document.body.className;
    target.body.style.cssText = "margin:0;height:100vh;display:flex;flex-direction:column;";
  }

  async function popOut() {
    const api = documentPip(window);
    const app = document.getElementById(APP_MOUNT_ID);
    if (!api || !app) return;
    if (api.window) { api.window.focus(); return; }
    const opened = await api.requestWindow(APP_PIP_OPTIONS).catch(() => null);
    if (!opened) return;
    copyDocumentShell(opened.document);
    const placeholder = document.createElement("div");
    placeholder.dataset.appPoppedOut = "";
    placeholder.className = "app-popped-out";
    placeholder.innerHTML = `<p>my ax is in the pop-out window.</p><button type="button">Bring it back</button>`;
    placeholder.querySelector("button")?.addEventListener("click", () => opened.close());
    app.before(placeholder);
    opened.document.body.append(app);
    pipWindow = opened;
    popped = true;
    document.documentElement.dataset.pipActive = "1";
    opened.addEventListener("pagehide", () => {
      placeholder.replaceWith(app);
      pipWindow = null;
      popped = false;
      delete document.documentElement.dataset.pipActive;
    }, { once: true });
  }

  function toggle() {
    if (pipWindow) pipWindow.close();
    else void popOut();
  }

  onMount(() => {
    supported = documentPip(window) !== null;
  });
</script>

{#if supported}
  <NavIconButton label={popped ? "Return my ax to the tab" : "Pop out my ax (stays on top)"} title={popped ? "Back to tab" : "Pop out"} onclick={toggle} aria-pressed={popped} data-app-popout="" data-popped={popped ? "1" : "0"}>
    {#if popped}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 9l-5 5M10 9.5V14h4.5" /></svg>
    {:else}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><rect x="12" y="11" width="7" height="7" rx="1" fill="currentColor" stroke="none" /></svg>
    {/if}
  </NavIconButton>
{/if}

<style>
  :global(html[data-pip="1"] #sessions-panel), :global(html[data-pip="1"] [aria-label="Toggle conversations sidebar"]) { display: none !important; }
  :global(.app-popped-out) { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: var(--bg); color: var(--fg-mut); font-size: 14px; }
  :global(.app-popped-out button) { min-height: 44px; padding: 0 16px; border: 1px solid var(--line); border-radius: 8px; color: var(--fg); background: var(--bg-alt); }
</style>
