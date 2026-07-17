// views/ChatPage.tsx — chat page shell. Renders the Layout <head> + Svelte 5
// mount targets that hydrate the UI.
//
// Architecture:
//   - AppShell.svelte      header (logo, conn pill, hamburger, attention, settings)
//   - Sessions.svelte      left-slide-in conversations sidebar
//   - Chat.svelte          the entire chat surface (composer, log, WS, etc)
//   - Settings.svelte      centered settings modal (capabilities, model, jobs, …)
//   - ComputerHealth + Connectors hydrate separately, then Settings moves
//     their mount nodes into its Connections section.

import type { FC } from "hono/jsx";
import { Layout, type ThemePref } from "./Layout";
import { SvelteEmbed } from "../../proof/svelte/SvelteEmbed";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import AppShellComponent from "../../proof/svelte/AppShell.ssr.mjs";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import ChatComponent from "../../proof/svelte/Chat.ssr.mjs";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import SessionsComponent from "../../proof/svelte/Sessions.ssr.mjs";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import SettingsComponent from "../../proof/svelte/Settings.ssr.mjs";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import ComputerHealthComponent from "../../proof/svelte/ComputerHealth.ssr.mjs";
// @ts-expect-error -- pre-compiled Svelte SSR modules, no .d.ts.
import ConnectorsComponent from "../../proof/svelte/Connectors.ssr.mjs";

interface ChatPageProps {
  identityEmail?: string | null;
  /** Worker version id, threaded through to Layout for asset cache-busting. */
  buildId?: string;
  buildTimestamp?: string;
  /** Server-resolved theme preference from the `myax-theme` cookie. */
  theme?: ThemePref;
  appOrigin?: string;
}

export const ChatPage: FC<ChatPageProps> = (props) => {
  return (
    <Layout
      title="My Agent Experience"
      identityEmail={props.identityEmail}
      bodyClass="overflow-hidden"
      buildId={props.buildId}
      buildTimestamp={props.buildTimestamp}
      theme={props.theme}
      appOrigin={props.appOrigin}
    >
      <div class="h-full flex flex-col">
        <SvelteEmbed
          component={AppShellComponent}
          hydrateAs="appshell"
          props={{ identityEmail: props.identityEmail ?? null }}
          buildId={props.buildId}
        />
        <div class="flex-1 min-h-0 flex flex-col">
          <SvelteEmbed component={ChatComponent} hydrateAs="chat" buildId={props.buildId} wrapperClass="contents" />
        </div>
      </div>

      <SvelteEmbed component={SessionsComponent} hydrateAs="sessions" buildId={props.buildId} />
      <SvelteEmbed
        component={SettingsComponent}
        hydrateAs="settings"
        props={{ identityEmail: props.identityEmail ?? null, initialTheme: props.theme ?? "system" }}
        buildId={props.buildId}
      />
      {/* These panels hydrate as separate mounts because svelte-hono SSR does
          not nest component bundles. Settings moves the hydrated nodes into
          its stable Connections slot. */}
      <div id="settings-drawer-extra-mounts" class="hidden" aria-hidden="true">
        <SvelteEmbed component={ComputerHealthComponent} hydrateAs="health" buildId={props.buildId} />
        <SvelteEmbed component={ConnectorsComponent} hydrateAs="connectors" buildId={props.buildId} />
      </div>

    </Layout>
  );
};

