// routes/decisions.ts — interactive decision widgets delivered over push.
//
// The agent calls the ask_user tool, which creates an owner-scoped decision
// (stored as a Run Receipt), pushes a deep link, and pauses for input. Tapping
// the push opens a sandboxed decision page; answering validates the choice
// server-side, records a receipt event, and injects the decision back into the
// originating Think session so the agent resumes.

import { SESSION_SQL, sessionWrite, type SessionStoreDb } from "../domain/Session/Session.store";
import { dismissRunRecord, dismissRunRecords, startRunRecord, type RunStoreDb } from "../domain/Run/Run.store";
import { applyRunEvent } from "../fsm/run-status";
import { closeOwnerNotifications, decisionNotificationTag } from "../notify";
import { markAttentionItemsSeen, type AttentionStoreDb } from "../domain/Attention/Attention.store";
import { sessionControl } from "../session-control";
import { Effect } from "effect";
import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import type { DecisionResponseStore } from "../decision-response";
import { decisionResponseLiveLayer, recordDecisionResponse } from "../decision-response-program";

import { jsonForHtml } from "../html-embed";
import { RIG_APPROVAL_EVENT } from "../rig-pipeline";

export { jsonForHtml };

const ID_RE = /^run-decision-[0-9a-f-]{36}$/i;

type DecisionBounds = { surface: "decision"; question: string; options: string[]; sessionId: string; rigInstanceId?: string };

export async function resumeRigWorkflow(env: Pick<AppEnv["Bindings"], "RIG_PIPELINE">, instanceId: string, choice: string): Promise<void> {
  const instance = await env.RIG_PIPELINE.get(instanceId);
  await instance.sendEvent({ type: RIG_APPROVAL_EVENT, payload: { choice, via: "push" } });
}

type DecisionDb = Pick<AppEnv["Bindings"], "DB">;

export function decisionThreadHref(sessionId: string, decisionId: string): string {
  return `/?session=${encodeURIComponent(sessionId)}&decision=${encodeURIComponent(decisionId)}`;
}

export type DecisionState = {
  id: string;
  sessionId: string;
  question: string;
  options: string[];
  state: "open" | "answered" | "replaced" | "dismissed";
  choice: string | null;
  answeredAt: string | null;
  replacedBy: string | null;
};

async function readDecisionState(env: DecisionDb, id: string, email: string): Promise<DecisionState | null> {
  const row = await env.DB.prepare("SELECT bounds_json, status FROM runs WHERE id = ? AND owner_email = ?").bind(id, email).first<{ bounds_json: string; status: string }>();
  const bounds = row ? parseBounds(row.bounds_json) : null;
  if (!row || !bounds) return null;
  const base = { id, sessionId: bounds.sessionId, question: bounds.question, options: bounds.options, choice: null, answeredAt: null, replacedBy: null };
  if (row.status === "open") return { ...base, state: "open" };
  if (row.status === "aborted") {
    const dismissed = await env.DB.prepare("SELECT ts FROM run_events WHERE run_id = ? AND owner_email = ? AND type = 'decision.dismissed' ORDER BY ts DESC LIMIT 1").bind(id, email).first<{ ts: string }>();
    if (dismissed) return { ...base, state: "dismissed", answeredAt: dismissed.ts };
    const event = await env.DB.prepare("SELECT data_json FROM run_events WHERE run_id = ? AND owner_email = ? AND type = 'decision.superseded' ORDER BY ts DESC LIMIT 1").bind(id, email).first<{ data_json: string }>();
    const replacedBy = event ? (JSON.parse(event.data_json) as { replacedBy?: string }).replacedBy ?? null : null;
    return { ...base, state: "replaced", replacedBy: replacedBy && ID_RE.test(replacedBy) ? replacedBy : null };
  }
  const event = await env.DB.prepare("SELECT ts, data_json FROM run_events WHERE run_id = ? AND owner_email = ? AND type = 'decision.answered' ORDER BY ts DESC LIMIT 1").bind(id, email).first<{ ts: string; data_json: string }>();
  const choice = event ? (JSON.parse(event.data_json) as { choice?: string }).choice ?? null : null;
  return { ...base, state: "answered", choice, answeredAt: event?.ts ?? null };
}

export function sameDecision(bounds: Pick<DecisionBounds, "question" | "options">, question: string, options: readonly string[]): boolean {
  return bounds.question === question && bounds.options.length === options.length && bounds.options.every((option, index) => option === options[index]);
}

function parseBounds(json: string): DecisionBounds | null {
  try {
    const bounds = JSON.parse(json) as DecisionBounds;
    return typeof bounds.question === "string" && Array.isArray(bounds.options) ? bounds : null;
  } catch {
    return null;
  }
}

export async function createDecision(env: DecisionDb, ownerEmail: string, sessionId: string, question: string, options: string[]) {
  const open = await env.DB.prepare("SELECT id, bounds_json FROM runs WHERE owner_email = ? AND session_id = ? AND status = 'open' AND task_summary = ? AND json_extract(bounds_json, '$.surface') = 'decision' ORDER BY created_at DESC")
    .bind(ownerEmail, sessionId, question.slice(0, 200)).all<{ id: string; bounds_json: string }>();
  const candidates = (open.results ?? []).map((row) => ({ id: row.id, bounds: parseBounds(row.bounds_json) }));
  const identical = candidates.find((candidate) => candidate.bounds && sameDecision(candidate.bounds, question, options));
  if (identical) return { id: identical.id, href: decisionThreadHref(sessionId, identical.id), reused: true };
  const id = `run-decision-${crypto.randomUUID()}`;
  const bounds: DecisionBounds = { surface: "decision", question, options, sessionId };
  await startRunRecord(env.DB as unknown as RunStoreDb, { id, ownerEmail, sessionId, status: "open", title: "Decision requested", taskSummary: question.slice(0, 200), boundsJson: JSON.stringify(bounds), createdAt: null });
  const superseded = candidates.filter((candidate) => candidate.bounds?.question === question).map((candidate) => candidate.id);
  for (const staleId of superseded) await supersedeDecision(env, ownerEmail, staleId, id);
  return { id, href: decisionThreadHref(sessionId, id), ...(superseded.length ? { superseded } : {}) };
}

async function supersedeDecision(env: DecisionDb, ownerEmail: string, staleId: string, replacementId: string): Promise<void> {
  if (!await applyRunEvent(env.DB, { id: staleId, ownerEmail }, "decision_superseded")) return;
  await env.DB.prepare("INSERT INTO run_events(run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json) VALUES (?, ?, ?, ?, ?, 'decision.superseded', ?, NULL)")
    .bind(staleId, crypto.randomUUID(), ownerEmail, new Date().toISOString(), JSON.stringify({ id: "my-ax", kind: "agent", mode: "live" }), JSON.stringify({ replacedBy: replacementId })).run();
}

export type DismissOutcome = "dismissed" | "already_closed" | "not_found";

export async function dismissDecision(env: DecisionDb, ownerEmail: string, id: string): Promise<DismissOutcome> {
  const row = await env.DB.prepare("SELECT status FROM runs WHERE id = ? AND owner_email = ? AND json_extract(bounds_json, '$.surface') = 'decision'").bind(id, ownerEmail).first<{ status: string }>();
  if (!row) return "not_found";
  if (row.status !== "open") return "already_closed";
  if (!await applyRunEvent(env.DB, { id, ownerEmail }, "owner_aborted")) return "already_closed";
  await env.DB.prepare("INSERT INTO run_events(run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json) VALUES (?, ?, ?, ?, ?, 'decision.dismissed', '{}', NULL)")
    .bind(id, crypto.randomUUID(), ownerEmail, new Date().toISOString(), JSON.stringify({ id: ownerEmail, kind: "human", mode: "live" })).run();
  return "dismissed";
}

export const DECISION_PAGE_SCRIPT = `(()=>{
  const data=JSON.parse(document.getElementById('decision-data').textContent);
  const id=data.id;const opts=data.options;
  const submit=document.getElementById('submit');const status=document.getElementById('status');let selected=-1;
  const inputs=()=>document.querySelectorAll('input[name=choice]');
  inputs().forEach(input=>input.addEventListener('change',()=>{selected=+input.value;submit.disabled=false;}));
  submit.addEventListener('click',async()=>{
    if(selected<0)return;submit.disabled=true;inputs().forEach(x=>x.disabled=true);
    status.textContent='Sending…';
    try{const r=await fetch('/api/decisions/'+encodeURIComponent(id)+'/respond',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({choice:opts[selected]})});
    const j=await r.json();if(!r.ok)throw new Error(j&&j.error&&j.error.message||'failed');
    document.getElementById('opts').replaceChildren();submit.remove();
    const strong=document.createElement('strong');strong.textContent=opts[selected];
    status.replaceChildren('Thanks — answered ',strong,'. The agent is continuing.');}
    catch(e){status.textContent='Error: '+e.message;submit.disabled=false;inputs().forEach(x=>x.disabled=false);}
  });
})();`;

export function decisionPageCsp(nonce: string): string {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}

export function decisionPage(id: string, question: string, options: string[], answered: string | null, sessionHref: string, nonce: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
  const choices = options.map((option, index) => `<label class="choice"><input type="radio" name="choice" value="${index}"><span>${esc(option)}</span></label>`).join("");
  const closeBar = `<a class="close" href="${esc(sessionHref)}" aria-label="Close" title="Open My AX">×</a>`;
  const returnLink = `<a class="return" href="${esc(sessionHref)}">View conversation →</a>`;
  const body = answered
    ? `${closeBar}<h1>${esc(question)}</h1><p class="done">You answered: <strong>${esc(answered)}</strong></p>${returnLink}`
    : `${closeBar}<h1>${esc(question)}</h1><div id="opts">${choices}</div><button id="submit" disabled>Submit choice</button><p id="status"></p>${returnLink}`;
  const script = answered ? "" : `<script type="application/json" id="decision-data">${jsonForHtml({ id, options })}</script><script nonce="${nonce}">${DECISION_PAGE_SCRIPT}</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>My AX decision</title><style>:root{color-scheme:dark}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#0b1118;color:#f7f9fb;font-family:Inter,system-ui,sans-serif}main{position:relative;width:100%;max-width:32rem}h1{font-size:1.25rem;line-height:1.35;padding-right:2rem}#opts{display:grid;gap:.6rem;margin-top:1.25rem}.choice{display:flex;align-items:flex-start;gap:.7rem;padding:.85rem 1rem;border:1px solid rgba(181,198,211,.18);border-radius:.7rem;background:#111a24;cursor:pointer}.choice:has(input:checked){border-color:#f6821f;background:rgba(246,130,31,.08)}.choice input{margin-top:.18rem;accent-color:#f6821f}.choice span{line-height:1.35}#submit{width:100%;margin-top:1rem;padding:.85rem 1rem;border:0;border-radius:.7rem;background:#f6821f;color:#1b0900;font:700 1rem/1.2 inherit;cursor:pointer}#submit:disabled{opacity:.4;cursor:default}.done strong,#status strong{color:#f6821f}p{color:#9baaba;margin-top:1rem}.close{position:absolute;top:-.25rem;right:0;width:2rem;height:2rem;display:grid;place-items:center;border:1px solid rgba(181,198,211,.18);border-radius:.5rem;color:#9baaba;text-decoration:none;font-size:1.2rem;line-height:1}.close:hover{color:#f7f9fb;border-color:#f6821f}.return{display:inline-block;margin-top:1.25rem;color:#f6821f;text-decoration:none;font-weight:600}.return:hover{text-decoration:underline}</style></head><body><main>${body}${script}</main></body></html>`;
}

export async function settleDecisionNotifications(env: AppEnv["Bindings"], email: string, decisionId: string): Promise<void> {
  const tag = decisionNotificationTag(decisionId);
  try {
    const unseen = await env.DB.prepare("SELECT id FROM attention_items WHERE owner_email = ? AND notification_tag = ? AND seen_at IS NULL").bind(email, tag).all<{ id: string }>();
    await markAttentionItemsSeen(env.DB as unknown as AttentionStoreDb, email, { ids: (unseen.results ?? []).map((row) => row.id) });
    await closeOwnerNotifications(env, email, [tag]);
  } catch (error) {
    console.warn("decision_notification_close_failed", { decisionId, err: error instanceof Error ? error.message : String(error) });
  }
}

export function registerDecisionRoutes(app: Hono<AppEnv>) {
  // Conversation UI uses this to offer a durable way back to an unanswered
  // widget after the user follows "View conversation" or dismisses the push.
  app.get("/api/decisions/pending", async (c) => {
    const sessionId = c.req.query("sessionId")?.trim() ?? "";
    if (!sessionId) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_SESSION", message: "sessionId is required" }, next_actions: [] }, 400);
    const email = c.get("identity").email.toLowerCase();
    const row = await c.env.DB.prepare("SELECT id, task_summary, created_at FROM runs WHERE owner_email = ? AND session_id = ? AND status = 'open' AND json_extract(bounds_json, '$.surface') = 'decision' ORDER BY created_at DESC LIMIT 1")
      .bind(email, sessionId).first<{ id: string; task_summary: string; created_at: string }>();
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { decision: row ? { id: row.id, question: row.task_summary, href: decisionThreadHref(sessionId, row.id), createdAt: row.created_at } : null }, next_actions: [] });
  });

  app.get("/api/decisions/:id/state", async (c) => {
    const id = c.req.param("id");
    if (!ID_RE.test(id)) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_ID", message: "invalid decision id" }, next_actions: [] }, 400);
    const decision = await readDecisionState(c.env, id, c.get("identity").email.toLowerCase());
    if (!decision) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "decision not found" }, next_actions: [] }, 404);
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: decision, next_actions: [] });
  });

  app.get("/api/decisions/:id", async (c) => {
    const id = c.req.param("id");
    if (!ID_RE.test(id)) return c.text("not found", 404);
    const email = c.get("identity").email.toLowerCase();
    if (c.req.query("page") !== "1") {
      const decision = await readDecisionState(c.env, id, email);
      if (!decision) return c.text("not found", 404);
      return c.redirect(decisionThreadHref(decision.sessionId, decision.replacedBy ?? id), 302);
    }
    const row = await c.env.DB.prepare("SELECT bounds_json, status FROM runs WHERE id = ? AND owner_email = ?").bind(id, email).first<{ bounds_json: string; status: string }>();
    if (!row) return c.text("not found", 404);
    const bounds = JSON.parse(row.bounds_json) as DecisionBounds;
    const sessionHref = `/?session=${encodeURIComponent(bounds.sessionId)}`;
    let answered: string | null = null;
    if (row.status === "aborted") {
      const event = await c.env.DB.prepare("SELECT data_json FROM run_events WHERE run_id = ? AND owner_email = ? AND type = 'decision.superseded' ORDER BY ts DESC LIMIT 1").bind(id, email).first<{ data_json: string }>();
      const replacedBy = event ? (JSON.parse(event.data_json) as { replacedBy?: string }).replacedBy : undefined;
      if (replacedBy && ID_RE.test(replacedBy)) return c.redirect(`/api/decisions/${replacedBy}`, 302);
      const dismissed = await c.env.DB.prepare("SELECT 1 AS hit FROM run_events WHERE run_id = ? AND owner_email = ? AND type = 'decision.dismissed' LIMIT 1").bind(id, email).first<{ hit: number }>();
      answered = dismissed ? "(dismissed)" : "(replaced by a newer question)";
    } else if (row.status !== "open") {
      const event = await c.env.DB.prepare("SELECT data_json FROM run_events WHERE run_id = ? AND owner_email = ? AND type = 'decision.answered' ORDER BY ts DESC LIMIT 1").bind(id, email).first<{ data_json: string }>();
      answered = event ? ((JSON.parse(event.data_json) as { choice?: string }).choice ?? null) : "(already answered)";
    }
    const nonce = crypto.randomUUID().replace(/-/g, "");
    return c.html(decisionPage(id, bounds.question, bounds.options, answered, sessionHref, nonce), 200, {
      "Content-Security-Policy": decisionPageCsp(nonce),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.post("/api/decisions/:id/dismiss", async (c) => {
    const id = c.req.param("id");
    if (!ID_RE.test(id)) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_ID", message: "invalid decision id" }, next_actions: [] }, 400);
    const email = c.get("identity").email.toLowerCase();
    const outcome = await dismissDecision(c.env, email, id);
    if (outcome === "not_found") return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "decision not found" }, next_actions: [] }, 404);
    const settling = settleDecisionNotifications(c.env, email, id);
    try {
      c.executionCtx.waitUntil(settling);
    } catch {
      await settling;
    }
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { id, outcome }, next_actions: [] });
  });

  app.post("/api/decisions/:id/respond", async (c) => {
    const id = c.req.param("id");
    if (!ID_RE.test(id)) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_ID", message: "invalid decision id" }, next_actions: [] }, 400);
    const email = c.get("identity").email.toLowerCase();
    const body = await c.req.json<{ choice?: string }>().catch(() => ({} as { choice?: string }));
    const choice = typeof body.choice === "string" ? body.choice : "";
    const row = await c.env.DB.prepare("SELECT bounds_json, status FROM runs WHERE id = ? AND owner_email = ?").bind(id, email).first<{ bounds_json: string; status: string }>();
    if (!row) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "decision not found" }, next_actions: [] }, 404);
    const bounds = JSON.parse(row.bounds_json) as DecisionBounds;
    if (!bounds.options.includes(choice)) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_CHOICE", message: "choice is not an allowed option" }, next_actions: [] }, 400);
    if (row.status === "aborted") {
      const dismissed = await c.env.DB.prepare("SELECT 1 AS hit FROM run_events WHERE run_id = ? AND owner_email = ? AND type = 'decision.dismissed' LIMIT 1").bind(id, email).first<{ hit: number }>();
      if (dismissed) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "DECISION_DISMISSED", message: "this question was dismissed" }, next_actions: [] }, 409);
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "DECISION_SUPERSEDED", message: "this question was replaced by a newer one with different options" }, next_actions: [] }, 409);
    }
    if (row.status !== "open") return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "ALREADY_ANSWERED", message: "decision already answered" }, next_actions: [] }, 409);

    const store: DecisionResponseStore = {
      insertEvent: async ({ id, eventId, email, question, choice, now }) => {
        await c.env.DB.prepare("INSERT INTO run_events(run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json) VALUES (?, ?, ?, ?, ?, 'decision.answered', ?, NULL)")
          .bind(id, eventId, email, now, JSON.stringify({ id: email, kind: "human", mode: "live" }), JSON.stringify({ question, choice })).run();
      },
      completeRun: async ({ id, email }) => {
        return applyRunEvent(c.env.DB, { id, ownerEmail: email }, "decision_answered");
      },
      reopenRun: async ({ id, email }) => {
        return applyRunEvent(c.env.DB, { id, ownerEmail: email }, "decision_reopened");
      },
      deleteEvent: async ({ id, eventId, email }) => {
        await c.env.DB.prepare("DELETE FROM run_events WHERE run_id = ? AND event_id = ? AND owner_email = ? AND type = 'decision.answered'").bind(id, eventId, email).run();
      },
    };
    try {
      const resume = async () => {
        if (bounds.rigInstanceId) {
          await resumeRigWorkflow(c.env, bounds.rigInstanceId, choice);
          return;
        }
        await (await sessionControl(c.env, c.get("identity"), bounds.sessionId)).inject(`[decision] In response to "${bounds.question}", I chose: ${choice}`, `decision:${id}`);
        await sessionWrite(c.env.DB as unknown as SessionStoreDb, SESSION_SQL.S09_TOUCH, [bounds.sessionId, email]);
      };
      const recorded = await Effect.runPromise(
        recordDecisionResponse({ id, email, question: bounds.question, choice }).pipe(
          Effect.provide(decisionResponseLiveLayer(store, resume)),
        ),
      );
      if (!recorded) {
        return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "ALREADY_ANSWERED", message: "decision already answered" }, next_actions: [] }, 409);
      }
    } catch (error) {
      console.error("decision_inject_failed", { id, err: error instanceof Error ? error.message : String(error) });
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "DECISION_RESUME_FAILED", message: "The decision could not reach the conversation. Try again." }, next_actions: [] }, 503);
    }
    const settling = settleDecisionNotifications(c.env, email, id);
    try {
      c.executionCtx.waitUntil(settling);
    } catch {
      await settling;
    }
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { id, choice, resumed: true }, next_actions: [] });
  });
}
