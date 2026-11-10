<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  interface Props extends HTMLButtonAttributes {
    label: string;
    children: Snippet;
  }

  const { label, children, title, class: extraClass = "", ...rest }: Props = $props();
</script>

<button
  type="button"
  class="nav-icon-button flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-md text-fg-mut hover:text-fg hover:bg-surface-2 active:bg-surface-3 {extraClass}"
  aria-label={label}
  title={title ?? label}
  {...rest}
>
  {@render children()}
</button>

<style>
  .nav-icon-button :global(svg) {
    width: 18px;
    height: 18px;
  }
</style>
