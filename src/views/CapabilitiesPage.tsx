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
  function esc(value){ return String(value).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function render(result){
    const bundle = result.bundle;
    const proof = result.proof;
    const grants = bundle.capabilities.map((cap) => '<li><strong>'+esc(cap.resource.system)+'</strong><code>'+esc(cap.kind+':'+cap.resource.id)+'</code><span>Only this exact resource. No search, nearby records, or writes.</span></li>').join('');
    const allowed = proof.allowed.map((entry) => '<li><strong>Read allowed</strong><code>'+esc(entry.operation+':'+entry.resource)+'</code><span>Content was read, then stored only as a hash and byte count.</span></li>').join('');
    const denied = proof.denied.map((entry) => '<li><strong>'+(entry.beforeResolver ? 'Stopped before resolver' : 'Unavailable')+'</strong><code>'+esc(entry.operation+':'+entry.resource)+'</code><span>'+esc(entry.result)+'</span></li>').join('');
    const asks = proof.asks.map((entry) => '<li><strong>Needs approval</strong><code>'+esc(entry.requestedCapability)+'</code><span>'+esc(entry.reason)+'</span></li>').join('');
    out.innerHTML = '<section class="cap-outcome"><div><span class="cap-kicker">Result</span><h2>Safe-by-default review sandbox</h2><p>The child can inspect the pasted links, but cannot wander across internal systems. Missing access becomes an ask, not a workaround.</p></div><div class="cap-score"><strong>'+bundle.capabilities.length+'</strong><span>scoped grants</span></div></section>'+ 
      '<section class="cap-grid cap-grid-3"><div class="cap-card cap-good"><h2>1. Granted handles</h2><ul>'+grants+'</ul></div><div class="cap-card"><h2>2. Child tools</h2><div class="cap-pills">'+proof.childSurface.tools.map(t => '<code>'+esc(t)+'</code>').join('')+'</div><p class="muted">The child receives handles, not upstream credentials.</p></div><div class="cap-card cap-bad"><h2>3. Tools not present</h2><p class="muted">'+esc(proof.forbiddenTools.join(' · '))+'</p></div></section>'+ 
      '<section class="cap-grid"><div class="cap-card cap-good"><h2>Allowed</h2><ul>'+allowed+'</ul></div><div class="cap-card cap-bad"><h2>Denied</h2><ul>'+denied+'</ul></div></section>'+ 
      '<section class="cap-card cap-ask"><h2>Ask flow</h2><p>If the child needs more, it emits a request instead of searching broadly.</p><ul>'+asks+'</ul></section>'+ 
      '<details class="cap-details"><summary>Receipt JSON for audit</summary><pre>'+esc(JSON.stringify(proof,null,2))+'</pre></details>';
  }
  async function run(ev){
    if(ev) ev.preventDefault();
    status.textContent = 'Running proof…';
    const body = { task: task.value, urls: urls.value.split(/\n+/).map(s => s.trim()).filter(Boolean) };
    const response = await fetch('/api/capabilities/demo', { method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    const json = await response.json();
    if(!response.ok || !json.ok){ status.textContent = json.error && json.error.message || 'Failed; keeping existing proof'; return; }
    status.textContent = 'Proof passed';
    render(json.result);
  }
  status.textContent = 'Proof passed';
  form.addEventListener('submit', run);
})();`;

export const CapabilitiesPage: FC<Props> = (props) => {
  const bundle = createCapabilityBundle({ principal: props.identityEmail || "unknown", urls: defaultUrls, task: "Review these resources without broad internal search" });
  const proof = runCapabilityReviewDemo(bundle);
  return <Layout title="Scoped capabilities · my · ax" identityEmail={props.identityEmail} buildId={props.buildId} theme={props.theme} appOrigin={props.appOrigin} bodyClass="min-h-dvh bg-bg text-fg">
    <main class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <section class="cap-hero">
        <div>
          <p class="cap-eyebrow">Scoped capability review</p>
          <h1>Give an agent links, not the keys to everything.</h1>
          <p class="cap-lede">My AX turns pasted work URLs into narrow read handles. The child can use exactly three capability tools, proves what it read, and must ask before going anywhere else.</p>
        </div>
        <a href="/" class="cap-back">Back to chat</a>
      </section>

      <section class="cap-story" aria-label="Capability story">
        <div><strong>Paste URLs</strong><span>Jira, Wiki, GitLab, docs, chat, or MCP endpoints.</span></div>
        <div><strong>Derive handles</strong><span>Each link becomes one exact read grant.</span></div>
        <div><strong>Run child</strong><span>Only list, read, and request-more tools exist.</span></div>
        <div><strong>Audit receipt</strong><span>Reads and denials are recorded without raw content.</span></div>
      </section>

      <section class="cap-runner">
        <form data-cap-form class="cap-form">
          <label>Task
            <input data-cap-task value="Review these resources without broad internal search" />
          </label>
          <label>Resource URLs
            <textarea data-cap-urls rows={4}>{demoUrls}</textarea>
          </label>
          <div class="cap-actions">
            <button type="submit">Run scoped proof</button>
            <span data-cap-status>idle</span>
          </div>
        </form>
      </section>

      <div data-cap-output class="grid gap-4">
        <section class="cap-outcome">
          <div>
            <span class="cap-kicker">Result</span>
            <h2>Safe-by-default review sandbox</h2>
            <p>The child can inspect the pasted links, but cannot wander across internal systems. Missing access becomes an ask, not a workaround.</p>
          </div>
          <div class="cap-score"><strong>{bundle.capabilities.length}</strong><span>scoped grants</span></div>
        </section>

        <section class="cap-grid cap-grid-3">
          <div class="cap-card cap-good"><h2>1. Granted handles</h2><ul>{bundle.capabilities.map((cap) => <li><strong>{cap.resource.system}</strong><code>{cap.kind}:{cap.resource.id}</code><span>Only this exact resource. No search, nearby records, or writes.</span></li>)}</ul></div>
          <div class="cap-card"><h2>2. Child tools</h2><div class="cap-pills">{proof.childSurface.tools.map((tool) => <code>{tool}</code>)}</div><p class="muted">The child receives handles, not upstream credentials.</p></div>
          <div class="cap-card cap-bad"><h2>3. Tools not present</h2><p class="muted">{proof.forbiddenTools.join(" · ")}</p></div>
        </section>

        <section class="cap-grid">
          <div class="cap-card cap-good"><h2>Allowed</h2><ul>{proof.allowed.map((entry) => <li><strong>Read allowed</strong><code>{entry.operation}:{entry.resource}</code><span>Content was read, then stored only as a hash and byte count.</span></li>)}</ul></div>
          <div class="cap-card cap-bad"><h2>Denied</h2><ul>{proof.denied.map((entry) => <li><strong>{entry.beforeResolver ? "Stopped before resolver" : "Unavailable"}</strong><code>{entry.operation}:{entry.resource}</code><span>{entry.result}</span></li>)}</ul></div>
        </section>

        <section class="cap-card cap-ask"><h2>Ask flow</h2><p>If the child needs more, it emits a request instead of searching broadly.</p><ul>{proof.asks.map((ask) => <li><strong>Needs approval</strong><code>{ask.requestedCapability}</code><span>{ask.reason}</span></li>)}</ul></section>
        <details class="cap-details"><summary>Receipt JSON for audit</summary><pre>{JSON.stringify(proof, null, 2)}</pre></details>
      </div>
    </main>
    <style dangerouslySetInnerHTML={{ __html: `
.cap-hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:20px;padding:28px;border:1px solid var(--color-line);border-radius:24px;background:linear-gradient(135deg,color-mix(in srgb,var(--color-brand) 14%,transparent),var(--color-bg-alt) 45%,var(--color-bg-alt));box-shadow:0 18px 50px rgba(0,0,0,.16)}
.cap-eyebrow,.cap-kicker{margin:0 0 8px;color:var(--color-brand);font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}.cap-hero h1{max-width:760px;margin:0;font-size:clamp(32px,5vw,58px);line-height:.96;font-weight:800;letter-spacing:-.05em}.cap-lede{max-width:720px;margin:16px 0 0;color:var(--color-fg-mut);font-size:17px;line-height:1.6}.cap-back{flex:0 0 auto;border:1px solid var(--color-line);border-radius:999px;padding:10px 14px;color:var(--color-fg-mut);font-size:14px}.cap-story{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}.cap-story div{border:1px solid var(--color-line);border-radius:16px;background:var(--color-bg-alt);padding:14px}.cap-story strong{display:block;font-size:14px}.cap-story span{display:block;margin-top:4px;color:var(--color-fg-mut);font-size:12px;line-height:1.45}.cap-runner{margin-bottom:18px;border:1px solid var(--color-line);border-radius:20px;background:var(--color-bg-alt);padding:16px}.cap-form{display:grid;gap:12px}.cap-form label{display:grid;gap:6px;font-size:13px;font-weight:700}.cap-form input,.cap-form textarea{border:1px solid var(--color-line);border-radius:12px;background:var(--color-bg);color:var(--color-fg);padding:10px 12px;font:inherit;font-weight:400}.cap-form textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.cap-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.cap-actions button{border:0;border-radius:999px;background:var(--color-brand);color:#000;padding:10px 16px;font-weight:800}.cap-actions span{color:var(--color-fg-mut);font-size:13px}.cap-outcome{display:flex;align-items:center;justify-content:space-between;gap:18px;border:1px solid color-mix(in srgb,var(--color-brand) 45%,var(--color-line));border-radius:22px;background:color-mix(in srgb,var(--color-brand) 10%,var(--color-bg-alt));padding:22px}.cap-outcome h2{margin:0;font-size:24px;letter-spacing:-.03em}.cap-outcome p{max-width:740px;margin:8px 0 0;color:var(--color-fg-mut);line-height:1.55}.cap-score{min-width:120px;text-align:center;border:1px solid var(--color-line);border-radius:18px;background:var(--color-bg);padding:14px}.cap-score strong{display:block;font-size:42px;line-height:1}.cap-score span{display:block;color:var(--color-fg-mut);font-size:12px}.cap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.cap-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.cap-card{border:1px solid var(--color-line);background:var(--color-bg-alt);border-radius:18px;padding:16px}.cap-card h2{font-size:15px;margin:0 0 12px;font-weight:800}.cap-card p{margin:0;color:var(--color-fg-mut);font-size:13px;line-height:1.55}.cap-card ul{display:grid;gap:10px;margin:0;padding:0;list-style:none}.cap-card li{display:grid;gap:4px}.cap-card li strong{font-size:12px;text-transform:uppercase;letter-spacing:.08em}.cap-card code,.cap-pills code{display:inline-block;width:max-content;max-width:100%;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--color-brand);background:color-mix(in srgb,var(--color-brand) 10%,transparent);border:1px solid color-mix(in srgb,var(--color-brand) 25%,transparent);border-radius:8px;padding:3px 6px}.cap-card span,.muted{font-size:12px;color:var(--color-fg-mut);line-height:1.45}.cap-pills{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.cap-good{border-color:color-mix(in srgb,#22c55e 42%,var(--color-line))}.cap-bad{border-color:color-mix(in srgb,#f97316 42%,var(--color-line))}.cap-ask{border-color:color-mix(in srgb,var(--color-brand) 55%,var(--color-line))}.cap-details{border:1px solid var(--color-line);border-radius:16px;background:var(--color-bg-alt);padding:14px}.cap-details summary{cursor:pointer;font-weight:800}.cap-details pre{max-height:360px;overflow:auto;border-radius:12px;background:var(--color-bg);padding:12px;font-size:11px}@media(max-width:760px){.cap-hero,.cap-outcome{display:block}.cap-story,.cap-grid-3{grid-template-columns:1fr}.cap-back{display:inline-block;margin-top:18px}.cap-score{margin-top:16px}}
` }} />
    <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
  </Layout>;
};
