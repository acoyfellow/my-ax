<script lang="ts">
  import { onMount } from "svelte";
  import type { CodeDiffReceipt } from "../code-diff";
  import type { FileDiff } from "@pierre/diffs";

  const pierreDiffsModule = "@my-ax/pierre-diffs";

  let { diff }: { diff: CodeDiffReceipt } = $props();
  let host: HTMLDivElement;
  let status = $state<"loading" | "ready" | "error">("loading");
  let errorMessage = $state("");

  onMount(() => {
    let disposed = false;
    let instance: FileDiff | undefined;
    let observer: ResizeObserver | undefined;
    let themeObserver: MutationObserver | undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const themeType = () => {
      if (document.documentElement.classList.contains("dark")) return "dark";
      if (document.documentElement.classList.contains("light")) return "light";
      return media.matches ? "dark" : "light";
    };
    const options = () => ({
      diffStyle: host.clientWidth < 720 ? "unified" : "split",
      overflow: host.clientWidth < 720 ? "wrap" : "scroll",
      themeType: themeType(),
      disableFileHeader: true,
      diffIndicators: "bars",
    });
    const update = () => {
      if (!instance || disposed) return;
      instance.setOptions(options());
      instance.render({
        oldFile: { name: diff.path, contents: diff.oldText, ...(diff.language ? { lang: diff.language } : {}) },
        newFile: { name: diff.path, contents: diff.newText, ...(diff.language ? { lang: diff.language } : {}) },
        fileContainer: host,
        forceRender: true,
      });
    };

    void import(pierreDiffsModule).then(({ FileDiff }: typeof import("@pierre/diffs")) => {
      if (disposed) return;
      instance = new FileDiff(options());
      update();
      status = "ready";
      observer = new ResizeObserver(update);
      observer.observe(host);
      themeObserver = new MutationObserver(update);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      media.addEventListener("change", update);
    }).catch((error) => {
      if (disposed) return;
      errorMessage = error instanceof Error ? error.message : "Diff renderer could not load.";
      status = "error";
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      themeObserver?.disconnect();
      media.removeEventListener("change", update);
      instance?.cleanUp();
      host?.replaceChildren();
    };
  });
</script>

<section class="code-diff" data-tool-widget="code-diff" data-state={status}>
  <header>
    <div><strong>{diff.title}</strong><code>{diff.path}</code></div>
    <span>Review only</span>
  </header>
  {#if status === "loading"}<p role="status">Loading diff…</p>{/if}
  {#if status === "error"}
    <details open><summary>Diff preview unavailable</summary><p>{errorMessage}</p><pre>{diff.oldText}
--- changed to ---
{diff.newText}</pre></details>
  {/if}
  <div class="code-diff__host" class:hidden={status === "error"} bind:this={host}></div>
</section>

<style>
  .code-diff { overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); }
  header { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
  header div { min-width: 0; display: grid; gap: 2px; }
  header strong, header code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header code { font-size: 11px; opacity: .72; }
  header span { flex: none; font-size: 11px; font-weight: 700; text-transform: uppercase; opacity: .7; }
  p, details { margin: 12px; }
  pre { max-height: 24rem; overflow: auto; white-space: pre-wrap; }
  .code-diff__host { min-height: 80px; overflow-x: auto; }
  .hidden { display: none; }
  @media (max-width: 719px) { header { align-items: flex-start; } .code-diff__host { overflow-x: hidden; } }
</style>
