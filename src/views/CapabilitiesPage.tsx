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
    <main class="cap-page mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <section class="cap-hero">
        <div class="cap-hero-copy">
          <p class="cap-eyebrow">AX capability lab / production proof</p>
          <h1>Give an agent links.<br />Not keys to everything.</h1>
          <p class="cap-lede">My AX turns pasted work URLs into narrow read handles. The child gets a tiny tool surface, proves what it read, and must ask before crossing a boundary.</p>
          <div class="cap-hero-actions"><a href="#proof" class="cap-primary">View proof ↓</a><a href="/" class="cap-back">Back to chat</a></div>
        </div>
        <div class="cap-schematic" aria-label="Capability boundary diagram">
          <div><span>01</span><strong>Pasted links</strong><small>human intent</small></div>
          <i></i>
          <div><span>02</span><strong>Exact handles</strong><small>frozen scope</small></div>
          <i></i>
          <div><span>03</span><strong>Child tools</strong><small>list · read · ask</small></div>
          <i></i>
          <div><span>04</span><strong>Receipt</strong><small>hashes + denials</small></div>
        </div>
      </section>

      <section class="cap-story" aria-label="Capability story">
        <div><span>01</span><strong>Paste URLs</strong><small>Jira, Wiki, GitLab, docs, chat, or MCP endpoints.</small></div>
        <div><span>02</span><strong>Derive handles</strong><small>Each link becomes one exact read grant.</small></div>
        <div><span>03</span><strong>Run child</strong><small>Only list, read, and request-more tools exist.</small></div>
        <div><span>04</span><strong>Audit receipt</strong><small>Reads and denials are recorded without raw content.</small></div>
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

      <div id="proof" data-cap-output class="grid gap-4">
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
    <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
  </Layout>;
};
