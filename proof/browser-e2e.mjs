#!/usr/bin/env node
/**
 * Browser-authenticated production dogfood proof for my-ax.
 *
 * Uses the approved cmux-browser wrapper and its isolated Chrome For Testing
 * profile. The profile must already have a valid deployment-owner Access session.
 * This is intentionally an operator proof, not a CI credential bridge.
 *
 * Run:
 *   npm run prove:browser
 *
 * Optional, deliberately noisy push proof:
 *   MY_AX_PROVE_PUSH=1 npm run prove:browser
 */
import { execFileSync } from "node:child_process";

const SESSION = process.env.MY_AX_CMUX_SESSION || "myax-e2e";
const PROFILE = process.env.MY_AX_CMUX_PROFILE || `${process.env.HOME}/.cmux-browser`;
const BASE = process.env.MY_AX_BASE_URL;
if (!BASE) {
  console.error("MY_AX_BASE_URL required (e.g. https://ax.example.com)");
  process.exit(2);
}
const PROVE_PUSH = process.env.MY_AX_PROVE_PUSH === "1";
const PROVE_HARNESSES = process.env.MY_AX_PROVE_HARNESSES === "1";
const PROVE_SVELTE_ARTIFACT = process.env.MY_AX_PROVE_SVELTE_ARTIFACT === "1";
const MARKER = `THINK-E2E-OK-${Date.now()}`;
const ARTIFACT_MARKER = `SVELTE-ARTIFACT-E2E-${Date.now()}`;
const ARTIFACT_BUTTON = `Increment-${Date.now()}`;
const HARNESS_PROOF_CWD = process.env.MY_AX_HARNESS_PROOF_CWD || process.cwd();
const results = [];
let tempSessionId = null;
let previousProofModel = null;

function cmux(args, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return execFileSync("cmux-browser", ["--session", SESSION, ...args], {
        encoding: "utf8",
        stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
        input: options.input,
        timeout: options.timeout ?? 180_000,
      }).trim();
    } catch (error) {
      lastError = error;
      const detail = `${error?.message ?? ""}\n${error?.stderr?.toString?.() ?? ""}`;
      if (!/temporarily unavailable|daemon may be busy|os error 35/i.test(detail) || attempt === 3) throw error;
      execFileSync("sleep", ["1"]);
    }
  }
  throw lastError;
}
function evalJson(source, timeout) {
  const raw = cmux(["eval", "--stdin"], { input: source, timeout });
  // cmux prints the returned JS string as a JSON string.
  return JSON.parse(JSON.parse(raw));
}
function gate(id, fn) {
  try {
    const details = fn();
    results.push({ id, status: "pass", details });
    console.log(`✓ ${id}`);
    return details;
  } catch (error) {
    const message = error?.stderr?.toString?.().trim() || error?.message || String(error);
    results.push({ id, status: "fail", error: message });
    console.error(`✗ ${id}: ${message}`);
    return null;
  }
}
function browserOpen(url) {
  try {
    cmux(["get", "url"], { timeout: 10_000 });
    cmux(["open", url]);
  } catch {
    execFileSync("cmux-browser", ["--profile", PROFILE, "--session", SESSION, "open", url], {
      encoding: "utf8",
      timeout: 180_000,
    });
  }
  cmux(["wait", "1500"]);
}
function geometryProof() {
  return evalJson(`(()=>{const conn=[...document.querySelectorAll('[data-state]')].find(x=>x.getAttribute('title')==='Connection status');const bell=[...document.querySelectorAll('button')].find(x=>x.title==='Attention');const settings=document.getElementById('settings-button');const r=x=>{const b=x?.getBoundingClientRect();return b?{left:Math.round(b.left),right:Math.round(b.right),top:Math.round(b.top),bottom:Math.round(b.bottom)}:null};const a=r(conn),b=r(bell),c=r(settings);if(!a||!b||!c)throw new Error('missing app-bar control');if(!(a.right<=b.left&&b.right<=c.left))throw new Error('app-bar controls overlap');return JSON.stringify({conn:a,bell:b,settings:c})})()`);
}
function machineCall(tool, args = {}) {
  return evalJson(`(async()=>{const r=await fetch('/api/machinectl/call',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({tool:${JSON.stringify(tool)},arguments:${JSON.stringify(args)}})});return JSON.stringify(await r.json())})()`);
}
function waitForEvalTrue(expression, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (cmux(["eval", expression], { timeout: 15_000 }) === "true") return;
    } catch {}
    execFileSync("sleep", ["1"]);
  }
  throw new Error(`timed out waiting for browser condition: ${expression}`);
}
function waitForAgentText(text, timeoutMs = 180_000) {
  waitForEvalTrue(`[...document.querySelectorAll('article.msg')].some(node=>node.querySelector('.msg-head__role')?.textContent?.trim()==='Agent'&&node.textContent?.includes(${JSON.stringify(text)}))`, timeoutMs);
}
function forgetActiveSessionAfterCleanup() {
  cmux(["eval", `localStorage.removeItem('my-ax-session-id'); sessionStorage.setItem('my-ax-start-fresh-once','1')`]);
}

browserOpen(`${BASE}/?myax-e2e=1`);

gate("owner-access-session", () => evalJson(`(()=>{if(location.origin!==${JSON.stringify(BASE)})throw new Error('not on my-ax origin: '+location.href);if(!document.querySelector('textarea[aria-label="Message"]'))throw new Error('chat composer missing; deployment-owner Access login may be required');return JSON.stringify({href:location.href,title:document.title})})()`));

gate("owner-api-surface", () => evalJson(`(async()=>{const get=async path=>{const r=await fetch(path,{credentials:'include'});if(r.status!==200)throw new Error(path+' → '+r.status);return r.json()};const health=await get('/api/health');const sessions=await get('/api/sessions?limit=1');const jobs=await get('/api/jobs');const models=await get('/api/models');const attention=await get('/api/attention');const laptop=await get('/api/machinectl/status');const mcps=await get('/api/mcps');if(health.ok!==true)throw new Error('health not ok');if(!Array.isArray(sessions.result?.sessions))throw new Error('sessions shape');if(!Array.isArray(jobs.result?.jobs))throw new Error('jobs shape');if(!Array.isArray(models.result?.data)||!models.result.data.length||models.result.data.some(model=>model.tools!==true))throw new Error('full-tool model catalog shape');if(typeof attention.result?.unread!=='number')throw new Error('attention shape');if(laptop.connected!==true)throw new Error('explicit laptop relay disconnected');const laptopTools=new Set((laptop.tools??[]).map(tool=>tool.name));for(const tool of ['shell','screenshot','local_auth_status','harness_catalog','harness_start','harness_status'])if(!laptopTools.has(tool))throw new Error('laptop tool missing: '+tool);if(!Array.isArray(mcps.result?.mcps))throw new Error('mcps shape');return JSON.stringify({health:health.ok,sessions:sessions.result.sessions.length,jobs:jobs.result.jobs.length,models:models.result.data.length,unread:attention.result.unread,laptop:laptop.connected,laptopTools:[...laptopTools],mcps:mcps.result.mcps.length})})()`, 240_000));

gate("removed-human-surfaces", () => evalJson(`(async()=>{const out={};for(const path of ['/terminal','/api/files']){const r=await fetch(path,{credentials:'include'});out[path]=r.status;if(r.status!==404)throw new Error(path+' expected 404, got '+r.status)}return JSON.stringify(out)})()`));

gate("desktop-appbar-layout", geometryProof);

gate("mobile-appbar-layout", () => {
  cmux(["set", "device", "iPhone 14"]);
  cmux(["reload"]);
  cmux(["wait", "1000"]);
  return geometryProof();
});

gate("mobile-settings-modal-wrap", () => evalJson(`(async()=>{window.dispatchEvent(new Event('my-ax:settings-open'));await new Promise(resolve=>setTimeout(resolve,900));const modal=document.querySelector('dialog#settings-drawer[open]');const modalRect=modal?.getBoundingClientRect();if(!modalRect||modalRect.left<0||modalRect.right>innerWidth||modalRect.bottom>innerHeight)throw new Error('settings modal exceeds the viewport');const connections=[...modal.querySelectorAll('nav button')].find(node=>/Connections/.test(node.textContent||''));connections?.click();await new Promise(resolve=>setTimeout(resolve,100));const row=document.querySelector('[data-mcp-id="machinectl"]');const name=row?.querySelector('.laptop-row__name');const tools=row?.querySelector('.laptop-row__tools');if(!row||!name||!tools)throw new Error('laptop row missing');const nameRect=name.getBoundingClientRect();const toolsRect=tools.getBoundingClientRect();if(row.scrollWidth>row.clientWidth)throw new Error('laptop row overflows settings modal');if(innerWidth<640&&toolsRect.top<=nameRect.top)throw new Error('laptop capability summary did not wrap below name');if([...document.querySelectorAll('footer span')].some(node=>/^\s*session · [0-9a-f]{8}\s*$/i.test(node.textContent||'')))throw new Error('duplicate session id remains in settings');const activeId=document.querySelector('[data-active-session-id]');if(!activeId)throw new Error('minimal active session id missing from app bar');window.dispatchEvent(new Event('my-ax:settings-close'));return JSON.stringify({modal:{top:Math.round(modalRect.top),width:Math.round(modalRect.width),height:Math.round(modalRect.height)},row:{scrollWidth:row.scrollWidth,clientWidth:row.clientWidth},wrapped:innerWidth>=640||toolsRect.top>nameRect.top,activeSession:activeId.textContent.trim()})})()`));

gate("desktop-reset", () => {
  cmux(["set", "viewport", "1920", "1080"]);
  cmux(["reload"]);
  cmux(["wait", "1000"]);
  return geometryProof();
});

gate("conversation-drawer-primary-action", () => evalJson(`(async()=>{window.dispatchEvent(new Event('my-ax:sessions-open'));await new Promise(resolve=>setTimeout(resolve,500));const aside=document.querySelector('aside[aria-label="Conversations"]');const button=aside?.querySelector('button[aria-label="New conversation"]');const title=aside?.querySelector('.session-row__title');if(!aside||!button)throw new Error('conversations sidebar controls missing');const rect=button.getBoundingClientRect();const containerRect=button.parentElement.getBoundingClientRect();const containerStyle=getComputedStyle(button.parentElement);const availableWidth=containerRect.width-parseFloat(containerStyle.paddingLeft)-parseFloat(containerStyle.paddingRight);const style=getComputedStyle(button);if(Math.abs(rect.width-availableWidth)>1)throw new Error('new conversation control is not full width: '+Math.round(rect.width)+' of '+Math.round(availableWidth));if(rect.height<40)throw new Error('new conversation control is shorter than the primary-action target: '+Math.round(rect.height));if(button.textContent.trim()!=='New conversation')throw new Error('new conversation control label is not explicit');if(style.backgroundColor==='rgba(0, 0, 0, 0)'||style.backgroundColor==='transparent')throw new Error('new conversation control is not visually emphasized');if(title&&getComputedStyle(title).textOverflow!=='ellipsis')throw new Error('sidebar does not own title truncation');const firstRow=aside.querySelector('.session-row');if(firstRow&&!/[0-9a-f]{8}/i.test(firstRow.textContent||''))throw new Error('sidebar session short id missing');if(firstRow&&!firstRow.querySelector('a[title="Export markdown"]'))throw new Error('sidebar session export missing');window.dispatchEvent(new Event('my-ax:sessions-close'));return JSON.stringify({button:{width:Math.round(rect.width),containerWidth:Math.round(availableWidth),height:Math.round(rect.height),label:button.textContent.trim(),background:style.backgroundColor},titleTruncation:title?getComputedStyle(title).textOverflow:null,shortId:true,export:true})})()`));

gate("fresh-conversation-load-pinned", () => {
  const latest = evalJson(`(async()=>{const body=await fetch('/api/sessions?limit=1',{credentials:'include'}).then(r=>r.json());const id=body.result?.sessions?.[0]?.id;if(!id)throw new Error('no conversation available for fresh-load proof');return JSON.stringify({id})})()`);
  cmux(["open", `${BASE}/?session=${encodeURIComponent(latest.id)}&myax-e2e-load=1`]);
  waitForEvalTrue(`!document.querySelector('[aria-label="Resuming conversation"]')`, 120_000);
  cmux(["wait", "150"]);
  return evalJson(`(()=>{const log=document.querySelector('main[aria-label="Conversation"]');if(!log)throw new Error('conversation log missing');const bottomGap=Math.max(0,log.scrollHeight-log.clientHeight-log.scrollTop);if(bottomGap>2)throw new Error('fresh conversation load not pinned: '+bottomGap+'px gap');return JSON.stringify({bottomGap,scrollTop:Math.round(log.scrollTop),scrollHeight:log.scrollHeight,clientHeight:log.clientHeight})})()`);
});

gate("think-chat-roundtrip", () => {
  previousProofModel = evalJson(`(()=>JSON.stringify({model:localStorage.getItem('model')}))()`).model;
  cmux(["eval", `localStorage.setItem('model','gpt-5.5')`]);
  const created = evalJson(`(async()=>{const r=await fetch('/api/sessions',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({name:'E2E temporary Think proof'})});if(r.status!==201)throw new Error('session create → '+r.status);return JSON.stringify(await r.json())})()`);
  tempSessionId = created.result.sessionId;
  cmux(["eval", `sessionStorage.setItem('my-ax-resume-session-once','1')`]);
  cmux(["open", `${BASE}/?session=${encodeURIComponent(tempSessionId)}&myax-e2e=1`]);
  waitForEvalTrue(`document.querySelector('[title="Connection status"]')?.getAttribute('data-state')==='live'&&document.querySelector('[data-active-session-id]')?.textContent?.trim()===${JSON.stringify(tempSessionId.slice(0, 8))}`, 120_000);
  cmux(["eval", `document.querySelector('button[aria-label="Rename active conversation"]')?.click()`]);
  cmux(["eval", `(()=>{const input=document.querySelector('input[aria-label="Rename active conversation"]');if(!input)throw new Error('titlebar rename input missing');input.value='E2E renamed titlebar proof';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`]);
  waitForEvalTrue(`document.querySelector('button[aria-label="Rename active conversation"]')?.textContent?.includes('E2E renamed titlebar proof')`, 30_000);
  cmux(["fill", 'textarea[aria-label="Message"]', `Reply with exactly: ${MARKER}`]);
  cmux(["eval", `document.querySelector('button[aria-label="Send message"]')?.click()`]);
  waitForAgentText(MARKER);
  return evalJson(`(()=>{if(!document.body.innerText.includes(${JSON.stringify(MARKER)}))throw new Error('Think response marker missing');return JSON.stringify({sessionId:${JSON.stringify(tempSessionId)},marker:${JSON.stringify(MARKER)}})})()`);
});

gate("fork-thread-from-message", () => evalJson(`(async()=>{const marker=${JSON.stringify(MARKER)};const article=[...document.querySelectorAll('article.msg')].find(node=>node.querySelector('.msg-head__role')?.textContent?.trim()==='Agent'&&node.textContent?.includes(marker));const atMessageId=article?.getAttribute('data-id');if(!atMessageId)throw new Error('fork source message missing');if(!article.querySelector('button[aria-label="Fork conversation from this message"]'))throw new Error('fork affordance missing');const response=await fetch('/api/sessions/${tempSessionId}/fork',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({atMessageId})});const body=await response.json();if(response.status!==201)throw new Error(body?.error?.message||'fork failed');const forkId=body.result.sessionId;const transcript=await fetch('/api/sessions/'+encodeURIComponent(forkId)+'/export?format=markdown',{credentials:'include'}).then(r=>r.text());if(!transcript.includes(marker))throw new Error('fork transcript missing source marker');await fetch('/api/sessions/'+encodeURIComponent(forkId),{method:'DELETE',credentials:'include'});return JSON.stringify({forkId,source:${JSON.stringify(tempSessionId)},atMessageId,messageCount:body.result.messageCount})})()`));

if (PROVE_SVELTE_ARTIFACT && tempSessionId) {
  gate("inline-svelte-artifact", () => {
    const prompt = `Create an interactive Svelte artifact titled ${ARTIFACT_MARKER}. It must display the exact text ${ARTIFACT_MARKER}, include a button labelled ${ARTIFACT_BUTTON}, and increment a visible count when clicked. Use create_svelte_artifact now; do not describe code instead.`;
    cmux(["fill", 'textarea[aria-label="Message"]', prompt]);
    cmux(["eval", `document.querySelector('button[aria-label="Send message"]')?.click()`]);
    waitForEvalTrue(`document.querySelector('iframe.svelte-artifact-frame[data-artifact-id]')!==null`, 240_000);
    return evalJson(`(async()=>{const marker=${JSON.stringify(ARTIFACT_MARKER)};const iframe=document.querySelector('iframe.svelte-artifact-frame[data-artifact-id]');if(!iframe)throw new Error('sandboxed Svelte artifact iframe missing');if(iframe.getAttribute('sandbox')!=='allow-scripts')throw new Error('artifact iframe sandbox contract changed');if(!/^\\/api\\/artifacts\\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\/preview$/i.test(iframe.getAttribute('src')||''))throw new Error('artifact preview is not an allowlisted same-origin route');const artifactId=iframe.getAttribute('data-artifact-id');const preview=await fetch(iframe.getAttribute('src'),{credentials:'include'});if(!preview.ok)throw new Error('artifact preview fetch failed: '+preview.status);const html=await preview.text();if(!html.includes(marker)||!html.includes(${JSON.stringify(ARTIFACT_BUTTON)}))throw new Error('requested interactive artifact content missing in preview output');if(!html.includes('https://esm.sh/svelte@5.55.10'))throw new Error('artifact Svelte runtime mapping missing');const fullscreen=iframe.closest('.svelte-artifact-shell')?.querySelector('button[aria-label="Open artifact fullscreen"]');if(!fullscreen)throw new Error('artifact fullscreen affordance missing');fullscreen.click();await new Promise(resolve=>setTimeout(resolve,50));const shell=iframe.closest('.svelte-artifact-shell');if(shell?.getAttribute('data-fullscreen')!=='1')throw new Error('artifact did not enter fullscreen');const rect=shell.getBoundingClientRect();if(rect.width<innerWidth-4||rect.height<innerHeight-4)throw new Error('fullscreen artifact did not fill viewport');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await new Promise(resolve=>setTimeout(resolve,50));if(shell.getAttribute('data-fullscreen')!=='0')throw new Error('Escape did not exit artifact fullscreen');const list=await fetch('/api/artifacts',{credentials:'include'}).then(r=>r.json());if(!list.result?.artifacts?.some(artifact=>artifact.id===artifactId&&artifact.sessionId===${JSON.stringify(tempSessionId)}))throw new Error('artifact not durable in owner-scoped index');return JSON.stringify({artifactId,src:iframe.getAttribute('src'),sandbox:iframe.getAttribute('sandbox'),preview:true,fullscreen:true})})()`, 60_000);
  });
}

if (PROVE_HARNESSES) {
  gate("laptop-harness-catalog", () => {
    const result = machineCall("harness_catalog");
    if (!result.ok) throw new Error(result.error || "harness_catalog failed");
    const catalog = JSON.parse(result.content);
    const pi = catalog.harnesses?.find((item) => item.id === "pi");
    if (!pi?.capabilities?.includes("steer")) throw new Error("pi steer capability missing");
    return catalog;
  });
  gate("harness-roundtrip", () => {
    const marker = `HARNESS-OK-${Date.now()}`;
    const started = machineCall("harness_start", { harnessId: "pi", cwd: HARNESS_PROOF_CWD, prompt: `Reply with exactly: ${marker}` });
    if (!started.ok) throw new Error(started.error || "harness_start failed");
    const id = JSON.parse(started.content).session.id;
    const deadline = Date.now() + 120_000;
    let status; let logs = "";
    while (Date.now() < deadline) {
      status = machineCall("harness_status", { harnessId: "pi", id });
      logs = machineCall("harness_logs", { harnessId: "pi", id, tailChars: 12000 }).content || "";
      if (logs.includes(marker)) break;
      execFileSync("sleep", ["1"]);
    }
    if (!logs.includes(marker)) { machineCall("harness_stop", { harnessId: "pi", id }); throw new Error("harness marker missing"); }
    return { id, status: JSON.parse(status.content).session.status, marker };
  });
}

if (PROVE_PUSH) {
  gate("push-and-durable-attention", () => evalJson(`(async()=>{const before=await fetch('/api/attention',{credentials:'include'}).then(r=>r.json());const proof=await fetch('/api/push/agent-proof',{method:'POST',credentials:'include'}).then(async r=>({status:r.status,body:await r.json()}));if(proof.status!==200||proof.body?.result?.delivered<1)throw new Error('push delivery failed: '+JSON.stringify(proof));const after=await fetch('/api/attention',{credentials:'include'}).then(r=>r.json());if(after.result.unread<=before.result.unread)throw new Error('durable unread count did not increase');return JSON.stringify({before:before.result.unread,after:after.result.unread,delivery:proof.body.result})})()`, 120_000));
}

gate("compact-attention-popover", () => evalJson(`(async()=>{const bell=[...document.querySelectorAll('button')].find(button=>button.title==='Attention');if(!bell)throw new Error('attention bell missing');bell.click();await new Promise(resolve=>setTimeout(resolve,600));const dialog=document.querySelector('[role="dialog"][aria-label="Attention"]');if(!dialog)throw new Error('attention popover missing');const rect=dialog.getBoundingClientRect();const visibleAtCenter=document.elementFromPoint(rect.left+rect.width/2,rect.top+Math.min(rect.height/2,80))?.closest?.('[role="dialog"][aria-label="Attention"]')===dialog;if(!visibleAtCenter)throw new Error('attention popover is occluded by conversation content');const attention=await fetch('/api/attention',{credentials:'include'}).then(r=>r.json());if(attention.result.unread!==0)throw new Error('visible attention items were not marked seen');return JSON.stringify({popover:true,unread:attention.result.unread,visibleAtCenter})})()`));

if (tempSessionId) {
  gate("temporary-session-cleanup", () => {
    const result = evalJson(`(async()=>{const r=await fetch('/api/sessions/${encodeURIComponent(tempSessionId)}',{method:'DELETE',credentials:'include'});if(r.status!==200)throw new Error('cleanup → '+r.status);${previousProofModel ? `localStorage.setItem('model',${JSON.stringify(previousProofModel)});` : "localStorage.removeItem('model');"}return JSON.stringify({deleted:${JSON.stringify(tempSessionId)}})})()`);
    forgetActiveSessionAfterCleanup();
    return result;
  });
}

const failed = results.filter((result) => result.status === "fail");
console.log("\nmy-ax browser E2E");
for (const result of results) console.log(`  ${result.status === "pass" ? "PASS" : "FAIL"}  ${result.id}`);
console.log(`\n  gates: ${results.length - failed.length}/${results.length}  status: ${failed.length ? "fail" : "pass"}`);
if (failed.length) process.exit(1);
