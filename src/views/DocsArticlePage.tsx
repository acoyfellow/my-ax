import type { FC } from "hono/jsx";
import { Marked } from "marked";
import { Layout } from "./Layout";
import type { ThemePref } from "../routes/theme";
import { DOC_PAGES, type DocPage } from "../docs-content.generated";

interface Props {
  page: DocPage;
  identityEmail?: string | null;
  buildId?: string;
  theme?: ThemePref;
  appOrigin?: string;
}

// One Marked instance, GitHub-flavored defaults, no raw HTML passthrough beyond
// what the source authored. The rendered HTML is styled by the .prose-invert
// token rules already shipped in app.css (the same styles chat markdown uses).
const md = new Marked({ gfm: true, breaks: false });

// Rewrite in-repo doc links (./architecture.md, feature-tour.md) to internal
// /docs/<slug> subpages so navigation stays on-site instead of jumping to code.
const KNOWN = new Set(DOC_PAGES.map((p) => p.slug));
function internalizeLinks(html: string): string {
  return html.replace(/href="([^"]+\.md)(#[^"]*)?"/g, (whole, path: string, hash: string = "") => {
    const base = path.split("/").pop() || "";
    const slug = base.replace(/\.md$/, "");
    return KNOWN.has(slug) ? `href="/docs/${slug}${hash}"` : whole;
  });
}

export const DocsArticlePage: FC<Props> = (props) => {
  const html = internalizeLinks(md.parse(props.page.markdown, { async: false }) as string);
  return (
    <Layout title={`${props.page.title} · my · ax`} identityEmail={props.identityEmail} buildId={props.buildId} theme={props.theme} appOrigin={props.appOrigin} ownViewport={false} bodyClass="min-h-dvh bg-bg text-fg">
      <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <nav class="mb-8 flex flex-wrap items-center gap-2 text-sm text-fg-mut">
          <a class="text-brand hover:underline" href="/docs">Docs</a>
          <span aria-hidden="true">/</span>
          <span class="text-fg">{props.page.title}</span>
        </nav>

        <nav class="mb-8 flex flex-wrap gap-2">
          {DOC_PAGES.map((p) => (
            <a
              href={`/docs/${p.slug}`}
              aria-current={p.slug === props.page.slug ? "page" : undefined}
              class={
                p.slug === props.page.slug
                  ? "rounded-lg border border-brand/60 bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand"
                  : "rounded-lg border border-line px-3 py-1.5 text-sm text-fg transition-colors hover:border-brand/60"
              }
            >
              {p.title}
            </a>
          ))}
        </nav>

        <article
          class="prose-invert max-w-none [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-line [&_pre]:bg-surface-1 [&_pre]:p-4 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        <footer class="mt-12 border-t border-line pt-6">
          <a class="text-sm text-brand hover:underline" href="/docs">Back to docs</a>
        </footer>
      </main>
    </Layout>
  );
};
