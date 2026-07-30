<script lang="ts">
  import { onMount, tick } from "svelte";

  const selector = ".msg-body img:not([aria-hidden='true']), .tool-call__inline-image";
  let dialog: HTMLDialogElement | null = null;
  let src = $state("");
  let alt = $state("");

  function decorate(root: ParentNode) {
    root.querySelectorAll<HTMLImageElement>(selector).forEach((image) => {
      image.dataset.imageLightbox = "1";
      image.tabIndex = 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-label", image.alt ? `Open image: ${image.alt}` : "Open image");
    });
  }

  async function open(image: HTMLImageElement) {
    src = image.currentSrc || image.src;
    alt = image.alt || "Expanded image";
    await tick();
    dialog?.showModal();
  }

  function close() {
    dialog?.close();
  }

  onMount(() => {
    decorate(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            if (node.matches(selector)) decorate(node.parentNode ?? document);
            else decorate(node);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const onClick = (event: MouseEvent) => {
      const image = event.target instanceof Element ? event.target.closest<HTMLImageElement>(selector) : null;
      if (image) void open(image);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const image = event.target instanceof Element ? event.target.closest<HTMLImageElement>(selector) : null;
      if (!image) return;
      event.preventDefault();
      void open(image);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  });
</script>

<dialog bind:this={dialog} class="image-lightbox" aria-label="Image preview" onclick={(event) => { if (event.target === dialog) close(); }}>
  <div class="image-lightbox__panel">
    <button type="button" class="image-lightbox__close" onclick={close} aria-label="Close image preview">×</button>
    {#if src}
      <img class="image-lightbox__image" {src} {alt} />
      <a class="image-lightbox__original" href={src} target="_blank" rel="noreferrer">Open original</a>
    {/if}
  </div>
</dialog>

<style>
  :global(.msg-body img[data-image-lightbox="1"]),
  :global(.tool-call__inline-image[data-image-lightbox="1"]) {
    cursor: zoom-in;
  }
  :global(.msg-body img[data-image-lightbox="1"]:focus-visible),
  :global(.tool-call__inline-image[data-image-lightbox="1"]:focus-visible) {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
  .image-lightbox {
    width: 100vw;
    max-width: none;
    height: 100dvh;
    max-height: none;
    margin: 0;
    padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
    border: 0;
    background: rgba(3, 7, 12, 0.94);
    color: var(--fg);
  }
  .image-lightbox::backdrop {
    background: rgba(3, 7, 12, 0.82);
    backdrop-filter: blur(10px);
  }
  .image-lightbox__panel {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .image-lightbox__close {
    position: absolute;
    z-index: 1;
    top: 0;
    right: 0;
    width: 2.75rem;
    height: 2.75rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(11, 17, 24, 0.9);
    color: var(--fg);
    font-size: 1.75rem;
    line-height: 1;
  }
  .image-lightbox__image {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 0.5rem;
  }
  .image-lightbox__original {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    padding: 0.55rem 0.85rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(11, 17, 24, 0.9);
    color: var(--fg);
    font-size: 0.75rem;
    text-decoration: none;
  }
</style>
