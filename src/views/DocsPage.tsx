import type { FC } from "hono/jsx";
import { Layout } from "./Layout";
import type { ThemePref } from "../routes/theme";

interface Props {
  identityEmail?: string | null;
  buildId?: string;
  theme?: ThemePref;
  appOrigin?: string;
}

// Four reading paths. Each answers a different question, so the reader picks by
// intent, not by scrolling. Learn, do, look up, understand.
const PATHS: Array<{ anchor: string; label: string; question: string }> = [
  { anchor: "start", label: "Start", question: "Get it running." },
  { anchor: "guides", label: "Guides", question: "Do one task." },
  { anchor: "reference", label: "Reference", question: "Look up an exact fact." },
  { anchor: "concepts", label: "Concepts", question: "Understand the design." },
];

// GUIDES: task-first. Goal, ordered steps, then the result you can read.
const GUIDES: Array<{ anchor: string; goal: string; steps: string[]; result: string }> = [
  {
    anchor: "guide-cloud-run",
    goal: "Spawn a bounded cloud run",
    steps: [
      "Ask the agent to do a task that produces proof.",
      "The agent calls terrarium.spawn to wait for the result, or terrarium.spawn_background to launch and keep working.",
      "The run executes on a Terrarium container, not your laptop and not the worker.",
      "The agent reads the receipt when the run finishes.",
    ],
    result: "A receipt with a runId, a contract status of verified, and an exit code.",
  },
  {
    anchor: "guide-machine",
    goal: "Connect a machine you choose",
    steps: [
      "Install and run machinectl on a machine you choose, under a dedicated least-privilege OS account.",
      "Sign in so the companion connects outbound to your deployment. It opens no inbound port.",
      "Ask the agent to run a command; it uses machine.shell.",
    ],
    result: "The command output and the exact command the agent ran. The companion has the same power as a terminal and runs as the OS account you chose. Read the security posture before you connect a machine.",
  },
  {
    anchor: "guide-jobs",
    goal: "Schedule recurring work",
    steps: [
      "Ask the agent to run a prompt on a cadence.",
      "The agent creates a job through the shared job service.",
      "Each run writes start and terminal events.",
    ],
    result: "A job with durable history. Cadence is 60 seconds to 30 days. A finished or failed run posts an Attention receipt.",
  },
  {
    anchor: "guide-reuse",
    goal: "Save and reuse a procedure",
    steps: [
      "Ask the agent to do a multi-step task with work_code.",
      "The agent marks reusable code with one comment: // reusable-tool: <name>.",
      "Approve the tool in Settings, or turn on automatic enablement.",
      "Ask for the same task later; the agent runs the exact saved code.",
    ],
    result: "A named tool that runs the same code every time, with no regeneration drift.",
  },
  {
    anchor: "guide-artifact",
    goal: "Build a live instrument",
    steps: [
      "Ask the agent to build a UI, for example a status dashboard.",
      "The agent compiles a Svelte component and renders it in a sandboxed iframe.",
      "The artifact registers its own tools on the next turn.",
      "Ask the agent to change the UI; it calls those tools to steer the artifact in place.",
    ],
    result: "An artifact the agent built once and can drive later, without rebuilding it.",
  },
  {
    anchor: "guide-connector",
    goal: "Add an MCP connector",
    steps: [
      "Open Settings, then Connectors, then Add.",
      "Enter an HTTPS MCP endpoint the worker can reach.",
      "Complete the sign-in the worker starts for an OAuth server.",
      "The agent discovers the server's tools on first use.",
    ],
    result: "A connected MCP server. Grants are stored encrypted. Private and credential-bearing URLs are rejected.",
  },
];

const SURFACES: Array<{ ns: string; use: string; receipt: string }> = [
  { ns: "workspace.*", use: "Read, write, and run in a container-backed /home/user.", receipt: "files, command output" },
  { ns: "machine.*", use: "Run commands on your connected laptop.", receipt: "the command and its output" },
  { ns: "terrarium.*", use: "Spawn a bounded cloud run: spawn waits, spawn_background returns a runId, status checks one.", receipt: "runId, contract status, exit code" },
  { ns: "page.*", use: "Drive the open chat tab: read sessions and health, switch sessions, open Settings.", receipt: "session list, health block" },
  { ns: "codemode.*", use: "Discover, describe, and run tools and reusable tools by name.", receipt: "tool output, an execution id" },
  { ns: "browser_open", use: "Open a public web page in a real headless browser.", receipt: "title, text, an rrweb replay" },
];

const LIMITS: Array<{ surface: string; bound: string }> = [
  { surface: "Delegation", bound: "At most 2 concurrent children, depth 1, 8 steps each, 120s timeout. Terminal snapshot, not live progress." },
  { surface: "Recurring jobs", bound: "At most 10 active per owner. Cadence 60s to 30 days. No automatic repair if state drifts." },
  { surface: "Work Code Mode", bound: "Source limited to 32,000 bytes. 60-second wall-clock. No ambient network." },
  { surface: "Workspace", bound: "One shared /home/user per owner. Recent writes can be lost with the container." },
  { surface: "Machine", bound: "Runs as the companion's OS account. Terminal-equivalent. No privilege separation added." },
  { surface: "Terrarium", bound: "Runs in Terrarium's own containers under its authority. My AX holds a bearer control token." },
  { surface: "Page (live UI)", bound: "Works only while a chat tab is connected. Artifact tools are capped and schema-validated." },
];

const ENDPOINTS: Array<{ path: string; use: string }> = [
  { path: "GET /api/check-in", use: "One response: what needs you, what is running, what finished or failed." },
  { path: "GET /api/health", use: "Routing and bindings check. Returns ok: true when the worker is healthy." },
  { path: "GET /api/attention", use: "Owner-scoped unread items with source links." },
  { path: "GET /api/runs", use: "Run status summaries and receipt hrefs." },
  { path: "GET /api/jobs", use: "Recurring job status and history hrefs." },
  { path: "POST /api/sessions/:id/inject", use: "Send a durable turn into a conversation from outside." },
];

const CONCEPTS: Array<{ title: string; body: string }> = [
  { title: "You leave; the agent keeps working", body: "You give the agent a task and close the tab. It works while you are away. Check-in reports what needs you, what is running, and what finished. You read the receipt and decide the next step. The product is built so you can leave." },
  { title: "The agent has more than one computer", body: "The agent picks the place for each task. It uses the workspace for files tied to the conversation. It uses your laptop for local and authenticated state. It uses Terrarium for cloud runs that do not need you present. It uses its own browser for public pages. One tool surface covers all four." },
  { title: "Every action leaves a receipt", body: "A cloud run returns a runId and a verified contract status. A recurring run writes start and terminal events. A reusable-tool run records an execution id. The receipt is the proof. Do not trust a claim; read the receipt." },
  { title: "The owner authorizes the agent", body: "My AX is single-operator. One verified Cloudflare Access identity owns every conversation, record, and tool call. The agent acts with the authority the owner already holds. It is not a remote-access tool and takes no inbound connection to a machine the owner connects. The owner configures each path, gates it with Access, and can stop it." },
  { title: "Confinement does not grant authority", body: "Generated code runs in a bounded sandbox with no direct database, secret, or network access. It calls allowlisted server-side handlers. A handler keeps its normal authority; the sandbox does not add or remove it." },
  { title: "Who owns what", body: "The Agents SDK owns durable identity, sockets, schedules, and child runs. Think owns model turns, history, and recovery. My AX owns authorization, the UI, jobs, Attention, receipts, and the work providers. Think is authoritative for a conversation; D1 is a derived index." },
];

const Section: FC<{ id: string; title: string; lede: string; children?: unknown }> = (p) => (
  <section id={p.id} class="scroll-mt-6 border-t border-line pt-10 mt-10">
    <h2 class="text-xl font-semibold text-fg">{p.title}</h2>
    <p class="mt-1 mb-6 max-w-2xl text-sm leading-relaxed text-fg-mut">{p.lede}</p>
    {p.children}
  </section>
);

const Steps: FC<{ steps: string[] }> = (p) => (
  <ol class="flex flex-col gap-2">
    {p.steps.map((s, i) => (
      <li class="flex gap-3 text-sm leading-relaxed text-fg">
        <span class="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand">{i + 1}</span>
        <span>{s}</span>
      </li>
    ))}
  </ol>
);

export const DocsPage: FC<Props> = (props) => {
  return (
    <Layout title="Docs · my · ax" identityEmail={props.identityEmail} buildId={props.buildId} theme={props.theme} appOrigin={props.appOrigin} ownViewport={false} bodyClass="min-h-dvh bg-bg text-fg">
      <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <header>
          <p class="text-xs font-semibold uppercase tracking-widest text-brand">My AX documentation</p>
          <h1 class="mt-3 text-3xl font-semibold leading-tight text-balance text-fg sm:text-4xl">A single-operator agent that acts with your authority.</h1>
          <p class="mt-4 max-w-2xl text-base leading-relaxed text-fg-mut text-pretty">You deploy My AX into your own Cloudflare account, behind your own Access login. You authorize the agent. It works in a container, on a machine you connect, in bounded cloud runs, and in a headless browser. It is not a remote-access tool and takes no inbound connection. Every action writes a receipt you can read. See the <a class="text-brand hover:underline" href="/docs/security">security posture</a>.</p>
        </header>

        <nav class="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PATHS.map((p) => (
            <a href={`#${p.anchor}`} class="rounded-lg border border-line bg-bg-alt px-4 py-3 transition-colors hover:border-brand/60">
              <span class="block text-sm font-semibold text-fg">{p.label}</span>
              <span class="mt-0.5 block text-sm text-fg-mut">{p.question}</span>
            </a>
          ))}
        </nav>

        <Section id="start" title="Start" lede="Deploy My AX into your own Cloudflare account and send the first turn. The full guide is in the repository; these are the ordered steps.">
          <Steps steps={[
            "Clone the repository and run npm ci.",
            "Sign in with npx wrangler login, then run bash scripts/setup.sh. The script creates the resources and deploys.",
            "Put the hostname behind a Cloudflare Access self-hosted application.",
            "Set the Access and bridge variables, then redeploy.",
            "Confirm anonymous access is rejected and authenticated GET /api/health returns ok: true.",
            "Open the hostname through Access and send one model turn.",
          ]} />
          <p class="mt-6 rounded-lg border border-line bg-surface-1 px-4 py-3 text-sm leading-relaxed text-fg-mut">A connected laptop and a Terrarium service are optional; the workspace and MCP connectors work without them. See the <a class="text-brand hover:underline" href="/docs/deploy">deploy guide</a> for the exact variables and the persistence proof.</p>
        </Section>

        <Section id="guides" title="Guides" lede="One task at a time. Each guide names the goal, the steps, and the result you can read back.">
          <div class="flex flex-col gap-3">
            {GUIDES.map((g) => (
              <div id={g.anchor} class="scroll-mt-6 rounded-xl border border-line bg-bg-alt p-5">
                <h3 class="mb-4 text-base font-semibold text-fg">{g.goal}</h3>
                <Steps steps={g.steps} />
                <p class="mt-4 border-t border-line pt-3 text-sm leading-relaxed text-fg-mut">Result: <span class="text-fg">{g.result}</span></p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="reference" title="Reference" lede="Exact facts. Where work runs, the hard limits, and the owner endpoints.">
          <h3 class="mb-3 text-sm font-semibold text-fg">Where work runs</h3>
          <div class="overflow-hidden rounded-xl border border-line">
            {SURFACES.map((s, i) => (
              <div class={`grid grid-cols-1 gap-1 p-4 sm:grid-cols-[10rem_1fr] sm:gap-4 ${i > 0 ? "border-t border-line" : ""}`}>
                <code class="font-mono text-sm text-brand">{s.ns}</code>
                <div class="text-sm leading-relaxed text-fg-mut"><span class="text-fg">{s.use}</span><span class="mt-1 block text-xs">Receipt: {s.receipt}</span></div>
              </div>
            ))}
          </div>

          <h3 class="mb-3 mt-8 text-sm font-semibold text-fg">Hard limits</h3>
          <div class="overflow-hidden rounded-xl border border-line">
            {LIMITS.map((l, i) => (
              <div class={`grid grid-cols-1 gap-1 p-4 sm:grid-cols-[9rem_1fr] sm:gap-4 ${i > 0 ? "border-t border-line" : ""}`}>
                <span class="text-sm font-medium text-fg">{l.surface}</span>
                <span class="text-sm leading-relaxed text-fg-mut">{l.bound}</span>
              </div>
            ))}
          </div>

          <h3 class="mb-3 mt-8 text-sm font-semibold text-fg">Owner endpoints</h3>
          <div class="overflow-hidden rounded-xl border border-line">
            {ENDPOINTS.map((e, i) => (
              <div class={`grid grid-cols-1 gap-1 p-4 sm:grid-cols-[16rem_1fr] sm:gap-4 ${i > 0 ? "border-t border-line" : ""}`}>
                <code class="font-mono text-sm text-brand">{e.path}</code>
                <span class="text-sm leading-relaxed text-fg-mut">{e.use}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="concepts" title="Concepts" lede="The design, and why it holds. Each idea is stated and bounded.">
          <div class="flex flex-col gap-6">
            {CONCEPTS.map((c) => (
              <div class="border-l-2 border-brand/40 pl-4">
                <h3 class="text-base font-semibold text-fg">{c.title}</h3>
                <p class="mt-1 max-w-2xl text-sm leading-relaxed text-fg-mut">{c.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="deeper" title="Go deeper" lede="Longer references, the source, and the live proof.">
          <div class="flex flex-wrap gap-2">
            <a class="rounded-lg border border-line px-4 py-2 text-sm text-fg transition-colors hover:border-brand/60" href="/docs/security">Security posture</a>
            <a class="rounded-lg border border-line px-4 py-2 text-sm text-fg transition-colors hover:border-brand/60" href="/docs/feature-tour">Feature tour, with receipts</a>
            <a class="rounded-lg border border-line px-4 py-2 text-sm text-fg transition-colors hover:border-brand/60" href="/docs/architecture">Architecture</a>
            <a class="rounded-lg border border-line px-4 py-2 text-sm text-fg transition-colors hover:border-brand/60" href="/docs/feature-matrix">Feature status and limits</a>
            <a class="rounded-lg border border-line px-4 py-2 text-sm text-fg transition-colors hover:border-brand/60" href="/docs/deploy">Deploy</a>
            <a class="rounded-lg border border-line px-4 py-2 text-sm text-fg transition-colors hover:border-brand/60" href="/capabilities">Scoped capabilities lab</a>
            <a class="rounded-lg border border-line px-4 py-2 text-sm text-fg transition-colors hover:border-brand/60" href="https://github.com/acoyfellow/my-ax">Source</a>
            <a class="rounded-lg border border-line px-4 py-2 text-sm text-fg transition-colors hover:border-brand/60" href="/">Back to chat</a>
          </div>
        </Section>
      </main>
    </Layout>
  );
};
