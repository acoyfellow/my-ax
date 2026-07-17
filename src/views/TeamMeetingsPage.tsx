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
  async function apiPost(path, body){
    const r = await fetch(path, { method:'POST', credentials:'include', headers:{ 'content-type':'application/json', 'accept':'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if(!j || !j.ok){ const e = new Error((j && j.error && j.error.message) || ('Request failed ('+r.status+')')); e.data = j; throw e; }
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
  function setupSubmit(){
    const dlg = document.getElementById('tm-dialog');
    if(!dlg || typeof dlg.showModal !== 'function') return;
    const form = document.getElementById('tm-form');
    const fileInput = document.getElementById('tm-file');
    const content = document.getElementById('tm-content');
    const guestWrap = document.getElementById('tm-guest-wrap');
    const guestInput = document.getElementById('tm-guest-input');
    const guestChips = document.getElementById('tm-guest-chips');
    const publishBtn = document.getElementById('tm-publish');
    const errEl = document.getElementById('tm-form-err');
    const guests = [];
    function setErr(m){ errEl.textContent = m || ''; }
    document.getElementById('tm-add').addEventListener('click', function(){ setErr(''); dlg.showModal(); });
    document.getElementById('tm-close').addEventListener('click', function(){ dlg.close(); });
    document.getElementById('tm-cancel').addEventListener('click', function(){ dlg.close(); });
    fileInput.addEventListener('change', async function(){
      const f = fileInput.files && fileInput.files[0];
      if(!f) return;
      try { content.value = await f.text(); setErr(''); } catch(_){ setErr('Could not read that file.'); }
    });
    form.querySelectorAll('input[name="tm-vis"]').forEach(function(r){
      r.addEventListener('change', function(){
        guestWrap.hidden = form.querySelector('input[name="tm-vis"]:checked').value !== 'custom';
      });
    });
    function renderChips(){
      guestChips.innerHTML = '';
      guests.forEach(function(g, i){
        const chip = document.createElement('span'); chip.className = 'tm-chip'; chip.append(g + ' ');
        const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Remove ' + g);
        x.addEventListener('click', function(){ guests.splice(i, 1); renderChips(); });
        chip.appendChild(x); guestChips.appendChild(chip);
      });
    }
    function addGuest(){
      const v = guestInput.value.trim().toLowerCase();
      if(!v) return;
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)){ setErr('Enter a valid email address.'); return; }
      if(guests.indexOf(v) === -1) guests.push(v);
      guestInput.value = ''; setErr(''); renderChips();
    }
    document.getElementById('tm-guest-add').addEventListener('click', addGuest);
    guestInput.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); addGuest(); } });
    form.addEventListener('submit', async function(e){
      e.preventDefault(); setErr('');
      const raw = content.value.trim();
      if(!raw){ setErr('Add a file or paste some notes first.'); return; }
      const visibility = form.querySelector('input[name="tm-vis"]:checked').value;
      if(visibility === 'custom' && !guests.length){ setErr('Add at least one guest, or choose AX team.'); return; }
      const body = { raw_doc_markdown: raw, visibility: visibility, guest_emails: visibility === 'custom' ? guests.slice() : [], store_raw_source: document.getElementById('tm-store').checked };
      const title = document.getElementById('tm-title').value.trim();
      const mdate = document.getElementById('tm-date').value;
      if(title) body.title = title;
      if(mdate) body.meeting_date = mdate;
      publishBtn.disabled = true; const label = publishBtn.textContent; publishBtn.textContent = 'Regenerating…';
      try {
        const result = await apiPost('/api/team/meetings', body);
        dlg.close(); form.reset(); content.value = ''; guests.length = 0; renderChips(); guestWrap.hidden = true;
        location.hash = result && result.id ? '#/m/' + result.id : '#/';
      } catch(err){
        const existing = err.data && err.data.result && err.data.result.id;
        if(existing){
          errEl.textContent = 'Already published. ';
          const a = document.createElement('a'); a.href = '#/m/' + existing; a.textContent = 'Open it'; a.className = 'tm-link';
          a.addEventListener('click', function(){ dlg.close(); });
          errEl.appendChild(a);
        } else { setErr(err.message || 'Publish failed.'); }
      } finally { publishBtn.disabled = false; publishBtn.textContent = label; }
    });
  }
  setupSubmit();
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
            <p class="tm-lede">Regenerated notes from the shared team reading room. AX members can publish here; oatmeal stays the authority on who may publish.</p>
          </div>
          <div class="tm-head-actions">
            <button type="button" id="tm-add" class="tm-btn-primary">＋ Add notes</button>
            <a href="/" class="tm-link">← Back to chat</a>
          </div>
        </header>
        <section data-tm-app class="tm-app">
          <p class="tm-muted">Loading…</p>
        </section>
      </main>

      <dialog id="tm-dialog" class="tm-dialog">
        <form id="tm-form" class="tm-form">
          <div class="tm-dlg-head">
            <h2 class="tm-dlg-title">Add meeting notes</h2>
            <button type="button" id="tm-close" class="tm-btn-ghost" aria-label="Close">✕</button>
          </div>
          <div class="tm-dlg-body">
            <div>
              <label for="tm-file" class="tm-label">Upload a Gemini doc (.md or .txt)</label>
              <input type="file" id="tm-file" accept=".md,.txt,text/markdown,text/plain" />
              <p class="tm-hint">The file's text is loaded into the box below — you can edit it before publishing.</p>
            </div>
            <div>
              <label for="tm-content" class="tm-label">— or — paste raw notes / transcript</label>
              <textarea id="tm-content" class="tm-input" rows={7} placeholder="# Notes …"></textarea>
            </div>
            <div>
              <label for="tm-title" class="tm-label">Title <span class="tm-hint tm-inline">(optional — parsed from the doc if blank)</span></label>
              <input type="text" id="tm-title" class="tm-input" maxlength={300} />
            </div>
            <div>
              <label for="tm-date" class="tm-label">Meeting date <span class="tm-hint tm-inline">(optional)</span></label>
              <input type="date" id="tm-date" class="tm-input" />
            </div>
            <div>
              <span class="tm-label">Visibility</span>
              <div class="tm-radios">
                <label class="tm-choice"><input type="radio" name="tm-vis" value="ax_team" checked /> AX team</label>
                <label class="tm-choice"><input type="radio" name="tm-vis" value="custom" /> AX + specific guests</label>
              </div>
              <div id="tm-guest-wrap" hidden>
                <div class="tm-row">
                  <input type="text" id="tm-guest-input" class="tm-input" placeholder="guest@cloudflare.com" />
                  <button type="button" id="tm-guest-add" class="tm-btn-ghost">Add</button>
                </div>
                <div class="tm-chips" id="tm-guest-chips"></div>
              </div>
            </div>
            <div>
              <label class="tm-choice"><input type="checkbox" id="tm-store" /> Store raw source (expires after the retention window)</label>
            </div>
          </div>
          <div class="tm-dlg-foot">
            <span class="tm-error" id="tm-form-err"></span>
            <button type="button" id="tm-cancel" class="tm-btn-ghost">Cancel</button>
            <button type="submit" id="tm-publish" class="tm-btn-primary">Regenerate &amp; publish</button>
          </div>
        </form>
      </dialog>
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
        .tm-head-actions{display:flex;align-items:center;gap:14px;flex:none}
        .tm-btn-primary{font:inherit;font-weight:600;cursor:pointer;background:var(--color-brand,#f6821f);color:#fff;border:1px solid transparent;border-radius:8px;padding:7px 13px}
        .tm-btn-primary:disabled{opacity:.6;cursor:default}
        .tm-btn-ghost{font:inherit;cursor:pointer;background:transparent;color:var(--color-fg,#e6e9ef);border:1px solid var(--color-line,#262b36);border-radius:8px;padding:7px 13px}
        .tm-dialog{width:min(640px,calc(100vw - 32px));border:1px solid var(--color-line,#262b36);border-radius:14px;background:var(--color-bg,#111318);color:var(--color-fg,#e6e9ef);padding:0}
        .tm-dialog::backdrop{background:rgba(0,0,0,.5)}
        .tm-form{margin:0;padding:0}
        .tm-dlg-head,.tm-dlg-foot{display:flex;align-items:center;gap:10px;padding:16px 20px}
        .tm-dlg-head{justify-content:space-between;border-bottom:1px solid var(--color-line,#262b36)}
        .tm-dlg-foot{justify-content:flex-end;border-top:1px solid var(--color-line,#262b36)}
        .tm-dlg-title{margin:0;font-size:16px}
        .tm-dlg-body{padding:18px 20px;display:grid;gap:14px;max-height:70vh;overflow:auto}
        .tm-label{display:block;font-weight:600;font-size:13px;margin-bottom:6px}
        .tm-inline{display:inline;font-weight:400}
        .tm-input{width:100%;background:var(--color-bg-alt,#1b1f28);border:1px solid var(--color-line,#262b36);color:var(--color-fg,#e6e9ef);padding:9px 12px;border-radius:8px;font:inherit}
        textarea.tm-input{resize:vertical;min-height:120px}
        .tm-hint{color:var(--color-fg-mut,#9aa3b2);font-size:12px;margin:5px 0 0}
        .tm-radios{display:flex;gap:18px}
        .tm-choice{display:inline-flex;align-items:center;gap:6px;font-size:14px}
        .tm-row{display:flex;gap:10px;align-items:center;margin-top:10px}
        .tm-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
        .tm-chip{display:inline-flex;align-items:center;gap:4px;background:var(--color-bg-alt,#1b1f28);border:1px solid var(--color-line,#262b36);border-radius:999px;padding:3px 6px 3px 10px;font-size:13px}
        .tm-chip button{border:none;background:none;color:var(--color-fg-mut,#9aa3b2);cursor:pointer;font-size:14px;line-height:1;padding:0 2px}
        .tm-dlg-foot .tm-error{margin-right:auto}
      ` }} />
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </Layout>
  );
};
