import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";

function recordingUrl(env: Cloudflare.Env, sessionId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/recording/${encodeURIComponent(sessionId)}`;
}

/**
 * Replay UI for Browser Run's native rrweb recordings.
 *
 * Cloudflare records structured replay events, not a video file. This route
 * retrieves the owner-visible native recording server-side with a dedicated
 * Browser Rendering API token, while the app page renders it with rrweb-player.
 */
export function registerBrowserRoutes(app: Hono<AppEnv>) {
  app.get("/api/browser/recordings/:id", async (c) => {
    const id = c.req.param("id");
    const email = c.get("identity").email.toLowerCase();
    const owned = await c.env.DB.prepare("SELECT id FROM browser_recordings WHERE id = ? AND owner_email = ?").bind(id, email).first<{ id: string }>();
    if (!owned) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Browser recording not found" }, next_actions: [] }, 404);
    const token = c.env.BROWSER_API_TOKEN;
    if (!token) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BROWSER_REPLAY_NOT_CONFIGURED", message: "Browser Run recording is unavailable: BROWSER_API_TOKEN secret is not set on this worker. Set it with `wrangler secret put BROWSER_API_TOKEN` to enable replay." }, next_actions: [] }, 503);
    const response = await fetch(recordingUrl(c.env, id), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BROWSER_REPLAY_FAILED", message: `Browser Run recording returned HTTP ${response.status}` }, next_actions: [] }, 502);
    return new Response(response.body, { headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=60" } });
  });

  // Compact `?embed=1` variant drops the standalone-page chrome (header,
  // outer padding) and lets the rrweb player size to the iframe so the
  // browser tool card can mount it inline without nested headers.
  app.get("/browser/replay/:id", (c) => {
    const embed = c.req.query("embed") === "1";
    const id = JSON.stringify(c.req.param("id"));
    const header = embed ? "" : `<header>my · ax · browser replay</header>`;
    const layout = embed
      ? `html,body{margin:0;background:#0b0d12;color:#e8edf5;font:13px system-ui;overflow:hidden}#shell{position:relative;width:100vw;height:100vh;background:#0b0d12}#replay{display:grid;place-items:center;width:100%;height:100%}.loading,.error,.still{display:grid;place-items:center;gap:8px;height:100%;padding:20px;box-sizing:border-box;text-align:center}.error{color:#fb7185}.still{color:#e8edf5}.still strong{font-size:14px}.still span{color:#9ca9bd;max-width:420px}.badge{position:absolute;top:10px;left:10px;z-index:10;border-radius:999px;background:rgba(11,13,18,.82);border:1px solid #293243;color:#e8edf5;padding:5px 10px;font-size:11px;font-weight:600;letter-spacing:.02em;pointer-events:none}.rr-player{max-height:100vh!important}.rr-player__frame{max-height:calc(100vh - 96px)!important}.rr-controller{position:sticky!important;bottom:0!important;z-index:5!important;box-sizing:border-box!important;height:96px!important;padding:8px 10px 10px!important;gap:7px!important;background:#0b0d12!important;border-top:1px solid #293243!important;color:#e8edf5!important}.rr-timeline{width:100%!important;gap:8px!important}.rr-timeline__time{width:42px!important;color:#9ca9bd!important;font:11px ui-monospace,monospace!important}.rr-progress{border-color:#0b0d12!important;background:#293243!important}.rr-progress__step{background:#777cfb!important}.rr-controller__btns{gap:5px!important;color:#e8edf5!important}.rr-controller__btns button{color:#e8edf5!important}.rr-controller__btns button svg{fill:currentColor!important}.rr-controller__btns button:active{background:#293243!important}.rr-controller__btns button.active{color:#fff!important;background:#4950f6!important}.switch .label{color:#e8edf5!important}@media(max-width:520px){.rr-controller{padding-inline:8px!important}.rr-controller__btns{width:100%!important;justify-content:space-between!important}.rr-controller__btns button:nth-of-type(4),.rr-controller__btns button:nth-of-type(5){display:none!important}.switch .label{display:none!important}}`
      : `html,body{margin:0;background:#0b0d12;color:#e8edf5;font:14px system-ui}header{padding:12px 16px;border-bottom:1px solid #232936}#shell{position:relative}#replay{display:grid;place-items:center;min-height:calc(100dvh - 48px)}.loading,.error,.still{display:grid;place-items:center;gap:8px;padding:32px;text-align:center}.error{color:#fb7185}.still span{color:#9ca9bd}.badge{display:none}`;
    // rrweb-player adds its controls below the recorded viewport. Reserve
    // that vertical control strip in embed mode instead of sizing the player
    // itself to the iframe height and clipping the controls offscreen.
    const playerSize = embed
      ? `width:Math.min(window.innerWidth,1200),height:Math.max(160,Math.min(window.innerHeight-96,1200))`
      : `width:Math.min(window.innerWidth-24,900),height:Math.min(window.innerHeight-80,700)`;
    return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Browser replay · my · ax</title><link rel="stylesheet" href="/static/vendor/rrweb-player.css"><style>${layout}</style>${header}<main id="shell"><div class="badge" id="badge">Loading playback…</div><div id="replay" class="loading">Loading replay…</div><noscript><div class="error" style="padding:32px;text-align:center">This replay needs JavaScript to render. Enable it, or open the raw recording below.</div></noscript></main><script type="module">const root=document.getElementById("replay");const badge=document.getElementById("badge");const id=${id};const clock=(ms)=>ms<1000?ms+" ms":(ms/1000).toFixed(ms<10000?1:0)+" s";const rawHref='/api/browser/recordings/'+encodeURIComponent(id);const fail=(msg)=>{badge?.remove();root.className='error';root.textContent='';const p=document.createElement('p');p.textContent=msg||'Replay could not be loaded.';const a=document.createElement('a');a.href=rawHref;a.textContent='Open the raw recording data';a.style.color='#8b93ff';a.target='_blank';a.rel='noreferrer';root.append(p,a);};let mounted=false;const watchdog=setTimeout(()=>{if(!mounted)fail('The replay did not load. This can happen if the player script was blocked or the recording is unavailable.');},12000);try{const rrwebPlayer=(await import("/static/vendor/rrweb-player.mjs")).default;const r=await fetch(rawHref);if(!r.ok)throw new Error((await r.json().catch(()=>null))?.error?.message||('Replay unavailable (HTTP '+r.status+')'));const body=await r.json();const events=Object.values((body.result||body).events||{})[0]||[];const times=events.map((event)=>event.timestamp).filter((value)=>Number.isFinite(value));const duration=times.length>1?Math.max(0,times[times.length-1]-times[0]):0;if(events.length<2){clearTimeout(watchdog);mounted=true;badge?.remove();root.className='still';root.innerHTML='<strong>No replay recorded</strong><span>This browser run did not capture enough frames to play back.</span>';}else if(duration<1000){clearTimeout(watchdog);mounted=true;badge?.remove();root.className='still';root.innerHTML='<strong>Snapshot captured</strong><span>This browser run finished in '+clock(duration)+' — there is no meaningful playback to scrub.</span>';}else{badge.textContent='Visual replay · '+clock(duration);root.className='';root.textContent='';new rrwebPlayer({target:root,props:{events,autoPlay:false,showController:true,skipInactive:false,${playerSize}}});clearTimeout(watchdog);mounted=true;}}catch(e){clearTimeout(watchdog);mounted=true;fail(e&&e.message);}</script>`, 200, {
      // The player is an inline <script type="module"> whose bytes vary per
      // request (id + playerSize interpolation), so a static CSP hash can't
      // cover it. script-src 'self' silently BLOCKED the inline module, leaving
      // the page stuck on "Loading replay…" (no visible error). Allow inline
      // script (matches artifacts.ts / decisions.ts, the other inline-script
      // routes) plus 'self' for the imported rrweb-player.mjs. Widen img-src to
      // blob:/data: so the rrweb-reconstructed DOM can render its captured
      // images/screenshots; keep everything else locked to 'none'/'self'.
      "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
  });
}
