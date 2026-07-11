// JSX wrapper around proof/svelte/embed.ts so panel sites can write
//
//   <SvelteEmbed component={ComputerHealthComponent} hydrateAs="health" />
//
// instead of the verbose IIFE+dangerouslySetInnerHTML dance.

import type { FC } from "hono/jsx";
import { embedSvelte } from "./embed";

interface Props {
  // svelte/server's render() takes the component default export. We type
  // it as `any` because the SSR module is pre-compiled to .mjs with no
  // .d.ts; we don't want to fake one.
  // deno-lint-ignore no-explicit-any
  component: any;
  /** Must match the id in proof/svelte/build.mjs components map. */
  hydrateAs: string;
  /** Props handed to the component for both SSR and hydration. */
  props?: Record<string, unknown>;
  /** Worker deploy id: cache-bust generated hydration modules after release. */
  buildId?: string;
  /** Class for the mount wrapper. Use "contents" so the wrapper does not break
   *  a height:100% (h-full) ancestry chain — required for the chat frame where
   *  the composer footer must sit at the bottom of a fixed-height column. */
  wrapperClass?: string;
}

export const SvelteEmbed: FC<Props> = ({ component, hydrateAs, props, buildId, wrapperClass }) => {
  const e = embedSvelte(component, hydrateAs, props ?? {}, buildId);
  return (
    <>
      {e.cssUrl ? <link rel="stylesheet" href={e.cssUrl} /> : null}
      <div class={wrapperClass} dangerouslySetInnerHTML={{ __html: e.html }} />
      <script type="module" dangerouslySetInnerHTML={{ __html: e.scriptBody }} />
    </>
  );
};
