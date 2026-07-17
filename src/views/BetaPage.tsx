// views/BetaPage.tsx — the /beta frontend shell. ONE Svelte mount (BetaApp)
// instead of ChatPage's six. Same Layout <head>, same API/WS, behind the same
// Access. Additive: prod / (ChatPage) is untouched.
import type { FC } from "hono/jsx";
import { Layout, type ThemePref } from "./Layout";
import { SvelteEmbed } from "../../proof/svelte/SvelteEmbed";
// @ts-expect-error -- pre-compiled Svelte SSR module, no .d.ts.
import BetaAppComponent from "../../proof/svelte/BetaApp.ssr.mjs";

interface BetaPageProps {
  identityEmail?: string | null;
  buildId?: string;
  buildTimestamp?: string;
  theme?: ThemePref;
  appOrigin?: string;
}

export const BetaPage: FC<BetaPageProps> = (props) => {
  return (
    <Layout
      title="My Agent Experience (beta)"
      identityEmail={props.identityEmail}
      bodyClass="overflow-hidden"
      buildId={props.buildId}
      buildTimestamp={props.buildTimestamp}
      theme={props.theme}
      appOrigin={props.appOrigin}
    >
      <SvelteEmbed
        component={BetaAppComponent}
        hydrateAs="beta"
        props={{ identityEmail: props.identityEmail ?? null, initialTheme: props.theme ?? "system" }}
        buildId={props.buildId}
        wrapperClass="contents"
      />
    </Layout>
  );
};
