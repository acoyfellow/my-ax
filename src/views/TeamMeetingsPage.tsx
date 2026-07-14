import type { FC } from "hono/jsx";
import { Layout } from "./Layout";
import type { ThemePref } from "../routes/theme";

interface Props {
  identityEmail?: string | null;
  buildId?: string;
  theme?: ThemePref;
  appOrigin?: string;
}

// Thin, read-only reading room for the shared team meeting-notes service.
// All data comes from the same-origin proxy (/api/team/meetings*), which
// forwards the caller's Access token to oatmeal. Hash routing keeps it a
// single server-rendered document with no client framework.
const SCRIPT = String.raw`
(function(){
  const app = document.querySelector('[data-tm-app]');
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  async function api(path){
    const r = await fetch(path, { credentials:'include', headers:{ 'accept':'application/json' } });
    const j = await r.json().catch(() => null);
    if(!j || !j.ok){ throw new Error((j && j.error && j.error.message) || ('Request failed ('+r.status+')')); }
    return j.result;
  }
  function loading(msg){ app.innerHTML = '<p class="tm-muted">'+esc(msg||'Loading…')+'</p>'; }
  function fail(msg){ app.innerHTML = '<p class="tm-error">'+esc(msg)+'</p><p><a href="#" class="tm-link">Retry</a></p>'; }

  async function renderList(){
    loading('Loading meetings…');
    try {
      const result = await api('/api/team/meetings');
      const meetings = (result && result.meetings) || [];
      if(!meetings.length){ app.innerHTML = '<p class="tm-muted">No meetings you can read yet.</p>'; return; }
      const rows = meetings.map(m => '<tr class="tm-row" data-id="'+esc(m.id)+'">'
        + '<td class="tm-topic">'+esc(m.topic || m.title || 'Untitled')+'</td>'
        + '<td class="tm-muted">'+esc(m.meeting_date || '—')+'</td>'
        + '<td><span class="tm-pill tm-'+(m.visibility === 'custom' ? 'custom' : 'team')+'">'+esc(m.visibility === 'custom' ? 'custom' : 'team')+'</span></td>'
        + '</tr>').join('');
      app.innerHTML = '<table class="tm-table"><thead><tr><th>Topic</th><th>Date</th><th>Visibility</th></tr></thead><tbody>'+rows+'</tbody></table>';
      app.querySelectorAll('.tm-row').forEach(tr => tr.addEventListener('click', () => { location.hash = '#/m/'+tr.getAttribute('data-id'); }));
    } catch(e){ fail(e.message); }
  }

  async function renderDetail(id){
    loading('Loading meeting…');
    try {
      const result = await api('/api/team/meetings/'+encodeURIComponent(id));
      const m = result.meeting || {};
      const note = result.note || {};
      const attendees = (result.attendees || []).map(a => esc(a.name || a.email || '')).filter(Boolean);
      const body = note.body_md || note.summary || '';
      app.innerHTML = '<a href="#" class="tm-link">← All meetings</a>'
        + '<h2 class="tm-title">'+esc(m.topic || m.title || 'Untitled')+'</h2>'
        + '<p class="tm-muted">'+esc(m.meeting_date || '')+(m.created_by ? ' · '+esc(m.created_by) : '')+'</p>'
        + (note.summary ? '<p class="tm-summary">'+esc(note.summary)+'</p>' : '')
        + (attendees.length ? '<p class="tm-muted"><strong>Attendees:</strong> '+attendees.join(', ')+'</p>' : '')
        + '<pre class="tm-body">'+esc(body)+'</pre>';
    } catch(e){ fail(e.message); }
  }

  function route(){
    const h = location.hash || '';
    const m = h.match(/^#\/m\/(.+)$/);
    if(m){ renderDetail(decodeURIComponent(m[1])); } else { renderList(); }
  }
  window.addEventListener('hashchange', route);
  route();
})();`;

export const TeamMeetingsPage: FC<Props> = (props) => {
  return (
    <Layout
      title="Team meetings · my · ax"
      identityEmail={props.identityEmail}
      buildId={props.buildId}
      theme={props.theme}
      appOrigin={props.appOrigin}
      bodyClass="min-h-dvh bg-bg text-fg"
    >
      <main class="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <header class="tm-head">
          <div>
            <p class="tm-eyebrow">Agent Experience</p>
            <h1 class="tm-h1">Team meetings</h1>
            <p class="tm-lede">Regenerated notes from the shared team reading room. Read-only here; publish from the standalone app.</p>
          </div>
          <a href="/" class="tm-link">← Back to chat</a>
        </header>
        <section data-tm-app class="tm-app">
          <p class="tm-muted">Loading…</p>
        </section>
      </main>
      <style dangerouslySetInnerHTML={{ __html: `
        main{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
        .tm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:22px}
        .tm-eyebrow{margin:0 0 6px;font:700 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--color-brand,#f6821f)}
        .tm-h1{margin:0;font-size:24px;letter-spacing:.2px}
        .tm-lede{margin:6px 0 0;color:var(--color-fg-mut,#9aa3b2);max-width:52ch}
        .tm-app{margin-top:8px}
        .tm-table{width:100%;border-collapse:collapse}
        .tm-table th,.tm-table td{text-align:left;padding:11px 10px;border-bottom:1px solid var(--color-line,#262b36)}
        .tm-table th{color:var(--color-fg-mut,#9aa3b2);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
        .tm-row{cursor:pointer}
        .tm-row:hover td{background:var(--color-bg-alt,#1b1f28)}
        .tm-topic{font-weight:600}
        .tm-pill{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--color-line,#262b36)}
        .tm-pill.tm-team{color:var(--color-good,#2fa96b)}
        .tm-pill.tm-custom{color:var(--color-warn,#d98a2b)}
        .tm-muted{color:var(--color-fg-mut,#9aa3b2)}
        .tm-error{color:var(--color-bad,#e5534b)}
        .tm-link{color:var(--color-brand,#f6821f);text-decoration:none;font-size:14px}
        .tm-title{margin:14px 0 2px;font-size:20px}
        .tm-summary{margin:12px 0;font-size:15px;line-height:1.55}
        .tm-body{white-space:pre-wrap;word-break:break-word;background:var(--color-bg-alt,#111318);border:1px solid var(--color-line,#262b36);border-radius:10px;padding:16px;font:14px/1.6 ui-sans-serif,system-ui;margin-top:12px}
      ` }} />
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </Layout>
  );
};
