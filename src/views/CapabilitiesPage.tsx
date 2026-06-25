import type { FC } from "hono/jsx";
import { Layout } from "./Layout";
import type { ThemePref } from "../routes/theme";
import { createCapabilityBundle, runCapabilityReviewDemo } from "../capability-review";

interface Props {
  identityEmail?: string | null;
  buildId?: string;
  theme?: ThemePref;
  appOrigin?: string;
}

const demoUrls = `https://jira.cfdata.org/browse/DEVTOOLS-123\nhttps://wiki.cfdata.org/spaces/TEAM/pages/123456/Foo+Spec\nhttps://gitlab.cfdata.org/group/project/-/merge_requests/42`;
const defaultUrls = demoUrls.split("\n");

const SCRIPT = String.raw`
(function(){
  const form = document.querySelector('[data-cap-form]');
  const urls = document.querySelector('[data-cap-urls]');
  const task = document.querySelector('[data-cap-task]');
  const out = document.querySelector('[data-cap-output]');
  const status = document.querySelector('[data-cap-status]');
  function render(result){
    const bundle = result.bundle;
    const proof = result.proof;
    const grants = bundle.capabilities.map((cap) => '<li><code>'+cap.kind+':'+cap.resource.id+'</code><span> search '+cap.constraints.allowSearch+' · adjacent '+cap.constraints.allowAdjacent+' · write '+cap.constraints.allowWrite+'</span></li>').join('');
    const allowed = proof.allowed.map((entry) => '<li><code>'+entry.operation+':'+entry.resource+'</code><span>success · sha256 '+entry.contentHash.slice(0,12)+'… · '+entry.contentLength+' bytes</span></li>').join('');
    const denied = proof.denied.map((entry) => '<li><code>'+entry.operation+':'+entry.resource+'</code><span>'+entry.result+' · before resolver '+entry.beforeResolver+'</span></li>').join('');
    const asks = proof.asks.map((entry) => '<li><code>'+entry.requestedCapability+'</code><span>'+entry.reason+'</span></li>').join('');
    out.innerHTML = '<section class="cap-card"><h2>Capability bundle</h2><p><strong>Principal:</strong> '+bundle.principal.id+'</p><p><strong>Bundle:</strong> <code>'+bundle.hash.slice(0,24)+'…</code></p><ul>'+grants+'</ul></section>'+
      '<section class="cap-card"><h2>Child surface</h2><p><code>'+proof.childSurface.tools.join('</code> <code>')+'</code></p><p class="muted">Forbidden: '+proof.forbiddenTools.join(', ')+'</p></section>'+
      '<section class="cap-grid"><div class="cap-card"><h2>Allowed reads</h2><ul>'+allowed+'</ul></div><div class="cap-card"><h2>Denied / unavailable</h2><ul>'+denied+'</ul></div></section>'+
      '<section class="cap-card"><h2>Ask receipt</h2><ul>'+asks+'</ul></section>'+
      '<section class="cap-card"><h2>Receipt JSON</h2><pre>'+JSON.stringify(proof,null,2).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</pre></section>';
  }
  async function run(ev){
    if(ev) ev.preventDefault();
    status.textContent = 'running scoped proof…';
    const body = { task: task.value, urls: urls.value.split(/\n+/).map(s => s.trim()).filter(Boolean) };
    const response = await fetch('/api/capabilities/demo', { method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    const json = await response.json();
    if(!response.ok || !json.ok){ status.textContent = json.error && json.error.message || 'failed; server-rendered proof below is unchanged'; return; }
    status.textContent = 'pass: granted reads succeeded; adjacent/search/raw cfi denied; ask receipt emitted';
    render(json.result);
  }
  status.textContent = 'pass: server-rendered scoped proof below';
  form.addEventListener('submit', run);
})();`;

export const CapabilitiesPage: FC<Props> = (props) => {
  const bundle = createCapabilityBundle({ principal: props.identityEmail || "unknown", urls: defaultUrls, task: "Review these resources without broad internal search" });
  const proof = runCapabilityReviewDemo(bundle);
  return <Layout title="Scoped capabilities · my · ax" identityEmail={props.identityEmail} buildId={props.buildId} theme={props.theme} appOrigin={props.appOrigin} bodyClass="min-h-dvh bg-bg text-fg">
    <main class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <section class="mb-6 rounded-2xl border border-line bg-bg-alt p-5 shadow-sm">
        <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.22em] text-brand">my · ax capability lab</p>
            <h1 class="mt-1 text-2xl font-semibold text-fg">Scoped capability review</h1>
            <p class="mt-2 max-w-3xl text-sm leading-6 text-fg-mut">Paste Cloudflare work URLs. My AX derives narrow read handles, demos a three-tool child surface, and records a receipt showing allowed reads, denied adjacent/search/raw-tool attempts, and an ask flow.</p>
          </div>
          <a href="/" class="rounded-lg border border-line px-3 py-2 text-sm text-fg-mut hover:bg-surface-2">Back to chat</a>
        </div>
        <form data-cap-form class="grid gap-3">
          <label class="grid gap-1 text-sm font-medium">Task
            <input data-cap-task class="rounded-lg border border-line bg-bg px-3 py-2 font-normal text-fg" value="Review these resources without broad internal search" />
          </label>
          <label class="grid gap-1 text-sm font-medium">Resource URLs
            <textarea data-cap-urls rows={5} class="rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-fg">{demoUrls}</textarea>
          </label>
          <div class="flex flex-wrap items-center gap-3">
            <button type="submit" class="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-black hover:opacity-90">Run scoped proof</button>
            <span data-cap-status class="text-sm text-fg-mut">idle</span>
          </div>
        </form>
      </section>
      <div data-cap-output class="grid gap-4">
        <section class="cap-card">
          <h2>Capability bundle</h2>
          <p><strong>Principal:</strong> {bundle.principal.id}</p>
          <p><strong>Bundle:</strong> <code>{bundle.hash.slice(0, 24)}…</code></p>
          <ul>{bundle.capabilities.map((cap) => <li><code>{cap.kind}:{cap.resource.id}</code><span> search {String(cap.constraints.allowSearch)} · adjacent {String(cap.constraints.allowAdjacent)} · write {String(cap.constraints.allowWrite)}</span></li>)}</ul>
        </section>
        <section class="cap-card">
          <h2>Child surface</h2>
          <p>{proof.childSurface.tools.map((tool) => <code>{tool} </code>)}</p>
          <p class="muted">Forbidden: {proof.forbiddenTools.join(", ")}</p>
        </section>
        <section class="cap-grid">
          <div class="cap-card"><h2>Allowed reads</h2><ul>{proof.allowed.map((entry) => <li><code>{entry.operation}:{entry.resource}</code><span>success · sha256 {entry.contentHash.slice(0, 12)}… · {entry.contentLength} bytes</span></li>)}</ul></div>
          <div class="cap-card"><h2>Denied / unavailable</h2><ul>{proof.denied.map((entry) => <li><code>{entry.operation}:{entry.resource}</code><span>{entry.result} · before resolver {String(entry.beforeResolver)}</span></li>)}</ul></div>
        </section>
        <section class="cap-card"><h2>Ask receipt</h2><ul>{proof.asks.map((ask) => <li><code>{ask.requestedCapability}</code><span>{ask.reason}</span></li>)}</ul></section>
        <section class="cap-card"><h2>Receipt JSON</h2><pre>{JSON.stringify(proof, null, 2)}</pre></section>
      </div>
    </main>
    <style dangerouslySetInnerHTML={{ __html: `.cap-card{border:1px solid var(--color-line);background:var(--color-bg-alt);border-radius:16px;padding:16px}.cap-card h2{font-size:14px;margin:0 0 10px;font-weight:700}.cap-card ul{display:grid;gap:8px;margin:0;padding:0;list-style:none}.cap-card li{display:grid;gap:3px}.cap-card code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--color-brand)}.cap-card span,.muted{font-size:12px;color:var(--color-fg-mut)}.cap-card pre{max-height:360px;overflow:auto;border-radius:12px;background:var(--color-bg);padding:12px;font-size:11px}.cap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}` }} />
    <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
  </Layout>;
};
