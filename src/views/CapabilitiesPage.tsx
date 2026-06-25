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
        <div class="cap-hero-copy">
          <p class="cap-eyebrow">AX capability lab / production proof</p>
          <h1>Give an agent links, not the keys to everything.</h1>
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
    <style dangerouslySetInnerHTML={{ __html: `
body>a:first-child:not(:focus){position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important}main{--ax-ink:#07111a;--ax-layer:#0d141d;--ax-layer-2:#111c28;--ax-text:#f7f9fb;--ax-subtle:#c4d0d9;--ax-line:rgba(174,196,216,.16);--ax-line-strong:rgba(246,130,31,.34);--ax-orange:#f6821f;--ax-amber:#f7b53b;--ax-blue:#71b8d8;--ax-muted:#9baaba;color:var(--ax-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.cap-hero{position:relative;isolation:isolate;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(300px,.75fr);gap:28px;align-items:stretch;margin-bottom:14px;overflow:hidden;padding:32px;border:1px solid var(--ax-line);border-radius:28px;background:radial-gradient(circle at 84% 12%,rgba(113,184,216,.2),transparent 31%),radial-gradient(circle at 18% 0,rgba(246,130,31,.22),transparent 35%),linear-gradient(180deg,var(--ax-layer),var(--ax-ink));box-shadow:0 30px 100px rgba(0,0,0,.28);color:var(--ax-text)}.cap-hero:before{content:"";position:absolute;inset:0;background:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(90deg,transparent,black 18%,black 82%,transparent);pointer-events:none;z-index:-1}.cap-hero:after{content:"";position:absolute;right:-10%;bottom:-22%;width:58%;height:52%;background:radial-gradient(ellipse at center,rgba(38,120,164,.34),transparent 62%);filter:blur(6px);z-index:-1}.cap-hero-copy{display:flex;min-height:310px;flex-direction:column;justify-content:center}.cap-eyebrow,.cap-kicker{position:relative;display:inline-flex;width:max-content;margin:0 0 14px;padding:7px 10px;color:var(--ax-orange);font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase}.cap-eyebrow:before,.cap-kicker:before{content:"";position:absolute;inset:0;border:1px solid currentColor;opacity:.55;clip-path:polygon(0 0,22px 0,22px 1px,1px 1px,1px 22px,0 22px,0 0,100% 100%,calc(100% - 22px) 100%,calc(100% - 22px) calc(100% - 1px),calc(100% - 1px) calc(100% - 1px),calc(100% - 1px) calc(100% - 22px),100% calc(100% - 22px),100% 100%)}.cap-hero h1{max-width:850px;margin:0;color:var(--ax-text);font-size:clamp(42px,7vw,86px);line-height:.9;font-weight:850;letter-spacing:-.07em}.cap-lede{max-width:730px;margin:18px 0 0;color:var(--ax-subtle);font-size:18px;line-height:1.65}.cap-hero-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:24px}.cap-primary,.cap-back{border-radius:999px;padding:11px 16px;text-decoration:none;font-size:13px;font-weight:800}.cap-primary{background:var(--ax-orange);color:#170900}.cap-back{border:1px solid var(--ax-line);color:var(--ax-muted);background:rgba(255,255,255,.03)}.cap-schematic{display:grid;gap:1px;align-content:center;overflow:hidden;border:1px solid var(--ax-line);border-radius:22px;background:var(--ax-line);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}.cap-schematic div{display:grid;gap:4px;padding:18px;background:linear-gradient(135deg,var(--ax-layer-2),rgba(13,20,29,.9))}.cap-schematic span,.cap-story span{color:var(--ax-orange);font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em}.cap-schematic strong{color:var(--ax-text);font-size:16px}.cap-schematic small,.cap-story small{color:var(--ax-muted);font-size:12px}.cap-schematic i{display:none}.cap-story{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin-bottom:16px;overflow:hidden;border:1px solid var(--ax-line);border-radius:18px;background:var(--ax-line);color:var(--ax-text)}.cap-story div{display:grid;gap:6px;min-height:112px;padding:16px;background:var(--ax-layer)}.cap-story strong{display:block;color:var(--ax-text);font-size:14px}.cap-runner{margin-bottom:18px;border:1px solid var(--ax-line);border-radius:20px;background:linear-gradient(180deg,var(--ax-layer),var(--ax-layer-2));padding:16px;color:var(--ax-text)}.cap-form{display:grid;gap:12px}.cap-form label{display:grid;gap:6px;color:var(--ax-subtle);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.cap-form input,.cap-form textarea{border:1px solid var(--ax-line);border-radius:12px;background:#080d13;color:var(--ax-text);padding:10px 12px;font:inherit;font-weight:400;letter-spacing:0;text-transform:none}.cap-form textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.cap-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.cap-actions button{border:0;border-radius:999px;background:var(--ax-orange);color:#170900;padding:10px 16px;font-weight:850}.cap-actions span{color:var(--ax-muted);font-size:13px}.cap-outcome{display:flex;align-items:center;justify-content:space-between;gap:18px;border:1px solid var(--ax-line-strong);border-radius:22px;background:linear-gradient(135deg,rgba(246,130,31,.14),var(--ax-layer));padding:22px}.cap-outcome h2{margin:0;color:var(--ax-text);font-size:28px;letter-spacing:-.04em}.cap-outcome p{max-width:760px;margin:8px 0 0;color:var(--ax-subtle);line-height:1.6}.cap-score{min-width:124px;text-align:center;border:1px solid var(--ax-line);border-radius:18px;background:#080d13;padding:14px}.cap-score strong{display:block;color:var(--ax-amber);font-size:46px;line-height:1}.cap-score span{display:block;color:var(--ax-muted);font-size:12px}.cap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.cap-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.cap-card{border:1px solid var(--ax-line);background:var(--ax-layer);border-radius:18px;padding:16px;color:var(--ax-text)}.cap-card h2{color:var(--ax-text);font-size:15px;margin:0 0 12px;font-weight:850}.cap-card p{margin:0;color:var(--ax-subtle);font-size:13px;line-height:1.6}.cap-card ul{display:grid;gap:10px;margin:0;padding:0;list-style:none}.cap-card li{display:grid;gap:5px;padding-top:10px;border-top:1px solid var(--ax-line)}.cap-card li:first-child{padding-top:0;border-top:0}.cap-card li strong{font-size:11px;text-transform:uppercase;letter-spacing:.11em;color:var(--ax-text)}.cap-card code,.cap-pills code{display:inline-block;width:max-content;max-width:100%;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--ax-amber);background:rgba(246,130,31,.1);border:1px solid rgba(246,130,31,.24);border-radius:8px;padding:3px 6px}.cap-card span,.muted{font-size:12px;color:var(--ax-muted);line-height:1.45}.cap-pills{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.cap-good{border-color:rgba(99,213,162,.32)}.cap-bad{border-color:rgba(246,130,31,.38)}.cap-ask{border-color:var(--ax-line-strong)}.cap-details{border:1px solid var(--ax-line);border-radius:16px;background:var(--ax-layer);padding:14px;color:var(--ax-text)}.cap-details summary{cursor:pointer;color:var(--ax-text);font-weight:850}.cap-details pre{max-height:360px;overflow:auto;border-radius:12px;background:#080d13;color:var(--ax-subtle);padding:12px;font-size:11px}@media(max-width:900px){.cap-hero{grid-template-columns:1fr}.cap-schematic{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){.cap-outcome{display:block}.cap-story,.cap-grid-3{grid-template-columns:1fr}.cap-score{margin-top:16px}.cap-hero{padding:22px}.cap-hero h1{font-size:clamp(38px,10.5vw,62px);letter-spacing:-.055em}.cap-lede{font-size:16px}.cap-schematic{grid-template-columns:1fr}.cap-hero-copy{min-height:0}}
` }} />
    <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
  </Layout>;
};
