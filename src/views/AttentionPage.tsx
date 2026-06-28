import type { FC } from "hono/jsx";
import { Layout, type ThemePref } from "./Layout";

type AttentionItem = { id: string; session_id: string | null; kind: string; title: string; body: string; href: string; created_at: string; seen_at: string | null };

type AttentionPageProps = {
  identityEmail: string | null;
  buildId?: string;
  theme?: ThemePref;
  appOrigin?: string;
  unread: number;
  items: AttentionItem[];
  filter: { kind: string | null; sessionId: string | null };
};

function age(value: string) {
  const ms = Date.now() - new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z")).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export const AttentionPage: FC<AttentionPageProps> = (props) => {
  const title = props.filter.kind ? `Attention · ${props.filter.kind}` : "Attention";
  return (
    <Layout title={`${title} · my · ax`} identityEmail={props.identityEmail} buildId={props.buildId} theme={props.theme} appOrigin={props.appOrigin} bodyClass="min-h-dvh bg-bg text-fg">
      <main class="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6">
        <header class="flex flex-col gap-3 rounded-2xl border border-line bg-bg-alt p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <a href="/" class="text-xs font-semibold text-fg-mut hover:text-fg">← Back to shell</a>
            <h1 class="mt-2 text-2xl font-bold text-fg">Attention</h1>
            <p class="mt-1 text-sm text-fg-mut">
              {props.unread} unread{props.filter.kind ? ` · kind: ${props.filter.kind}` : ""}{props.filter.sessionId ? ` · session: ${props.filter.sessionId}` : ""}
            </p>
          </div>
          <a href="/api/attention" class="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-fg-mut hover:border-brand/50 hover:text-fg">API receipt</a>
        </header>
        {props.items.length === 0 ? (
          <section class="rounded-2xl border border-line bg-bg-alt p-6 text-sm text-fg-mut">Nothing needs you in this Attention view.</section>
        ) : (
          <ol class="space-y-3">
            {props.items.map((item) => (
              <li class="rounded-2xl border border-line bg-bg-alt p-4" data-attention-list-item={item.id}>
                <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-mut">{item.kind || "attention"}</p>
                    <h2 class="mt-1 text-sm font-semibold text-fg">{item.title}</h2>
                  </div>
                  <time class="text-xs text-fg-mut">{age(item.created_at)}</time>
                </div>
                <p class="mt-2 text-sm leading-6 text-fg-mut">{item.body}</p>
                <div class="mt-3 flex flex-wrap items-center gap-2">
                  <a href={item.href || "/"} class="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-white hover:opacity-90">Open source</a>
                  <span class="font-mono text-[10px] text-fg-mut">{item.id}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
    </Layout>
  );
};
