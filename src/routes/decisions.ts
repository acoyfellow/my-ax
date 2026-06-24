// routes/decisions.ts — interactive decision widgets delivered over push.
//
// The agent calls the ask_user tool, which creates an owner-scoped decision
// (stored as a Run Receipt), pushes a deep link, and pauses for input. Tapping
// the push opens a sandboxed decision page; answering validates the choice
// server-side, records a receipt event, and injects the decision back into the
// originating Think session so the agent resumes.

import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { getSessionAgent } from "../agent-stub";
import { recordDecisionResponse, type DecisionResponseStore } from "../decision-response";

const ID_RE = /^run-decision-[0-9a-f-]{36}$/i;

type DecisionBounds = { surface: "decision"; question: string; options: string[]; sessionId: string };

export async function createDecision(env: AppEnv["Bindings"], ownerEmail: string, sessionId: string, question: string, options: string[]) {
  // Automated jobs may retry the same turn. Reuse an identical unanswered
  // decision instead of creating duplicate widgets, pushes, and sessions.
  const existing = await env.DB.prepare("SELECT id FROM runs WHERE owner_email = ? AND session_id = ? AND status = 'open' AND task_summary = ? AND json_extract(bounds_json, '$.surface') = 'decision' ORDER BY created_at DESC LIMIT 1")
    .bind(ownerEmail, sessionId, question.slice(0, 200)).first<{ id: string }>();
  if (existing) return { id: existing.id, href: `/api/decisions/${existing.id}`, reused: true };
  const id = `run-decision-${crypto.randomUUID()}`;
  const bounds: DecisionBounds = { surface: "decision", question, options, sessionId };
  await env.DB.prepare("INSERT INTO runs(id, owner_email, session_id, status, title, task_summary, bounds_json, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?, datetime('now'), datetime('now'))")
    .bind(id, ownerEmail, sessionId, "Decision requested", question.slice(0, 200), JSON.stringify(bounds)).run();
  return { id, href: `/api/decisions/${id}` };
}

function page(id: string, question: string, options: string[], answered: string | null, sessionHref: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
  const choices = options.map((option, index) => `<label class="choice"><input type="radio" name="choice" value="${index}"><span>${esc(option)}</span></label>`).join("");
  const closeBar = `<a class="close" href="${esc(sessionHref)}" aria-label="Close" title="Open My AX">×</a>`;
  const returnLink = `<a class="return" href="${esc(sessionHref)}">View conversation →</a>`;
  const body = answered
    ? `${closeBar}<h1>${esc(question)}</h1><p class="done">You answered: <strong>${esc(answered)}</strong></p>${returnLink}`
    : `${closeBar}<h1>${esc(question)}</h1><div id="opts">${choices}</div><button id="submit" disabled>Submit choice</button><p id="status"></p>${returnLink}`;
  const script = answered ? "" : `<script>
    const id=${JSON.stringify(id)};const opts=${JSON.stringify(options)};
    const submit=document.getElementById('submit');let selected=-1;
    document.querySelectorAll('input[name=choice]').forEach(input=>input.onchange=()=>{selected=+input.value;submit.disabled=false;});
    submit.onclick=async()=>{
      if(selected<0)return;submit.disabled=true;document.querySelectorAll('input[name=choice]').forEach(x=>x.disabled=true);
      document.getElementById('status').textContent='Sending…';
      try{const r=await fetch('/api/decisions/'+id+'/respond',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({choice:opts[selected]})});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'failed');
      document.getElementById('opts').innerHTML='';submit.remove();document.getElementById('status').innerHTML='Thanks — answered <strong>'+opts[selected]+'</strong>. The agent is continuing.';}
      catch(e){document.getElementById('status').textContent='Error: '+e.message;submit.disabled=false;document.querySelectorAll('input[name=choice]').forEach(x=>x.disabled=false);}
    };
  </script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>My AX decision</title><style>:root{color-scheme:dark}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#0b1118;color:#f7f9fb;font-family:Inter,system-ui,sans-serif}main{position:relative;width:100%;max-width:32rem}h1{font-size:1.25rem;line-height:1.35;padding-right:2rem}#opts{display:grid;gap:.6rem;margin-top:1.25rem}.choice{display:flex;align-items:flex-start;gap:.7rem;padding:.85rem 1rem;border:1px solid rgba(181,198,211,.18);border-radius:.7rem;background:#111a24;cursor:pointer}.choice:has(input:checked){border-color:#f6821f;background:rgba(246,130,31,.08)}.choice input{margin-top:.18rem;accent-color:#f6821f}.choice span{line-height:1.35}#submit{width:100%;margin-top:1rem;padding:.85rem 1rem;border:0;border-radius:.7rem;background:#f6821f;color:#1b0900;font:700 1rem/1.2 inherit;cursor:pointer}#submit:disabled{opacity:.4;cursor:default}.done strong,#status strong{color:#f6821f}p{color:#9baaba;margin-top:1rem}.close{position:absolute;top:-.25rem;right:0;width:2rem;height:2rem;display:grid;place-items:center;border:1px solid rgba(181,198,211,.18);border-radius:.5rem;color:#9baaba;text-decoration:none;font-size:1.2rem;line-height:1}.close:hover{color:#f7f9fb;border-color:#f6821f}.return{display:inline-block;margin-top:1.25rem;color:#f6821f;text-decoration:none;font-weight:600}.return:hover{text-decoration:underline}</style></head><body><main>${body}${script}</main></body></html>`;
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
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { decision: row ? { id: row.id, question: row.task_summary, href: `/api/decisions/${row.id}`, createdAt: row.created_at } : null }, next_actions: [] });
  });

  app.get("/api/decisions/:id", async (c) => {
    const id = c.req.param("id");
    if (!ID_RE.test(id)) return c.text("not found", 404);
    const email = c.get("identity").email.toLowerCase();
    const row = await c.env.DB.prepare("SELECT bounds_json, status FROM runs WHERE id = ? AND owner_email = ?").bind(id, email).first<{ bounds_json: string; status: string }>();
    if (!row) return c.text("not found", 404);
    const bounds = JSON.parse(row.bounds_json) as DecisionBounds;
    const sessionHref = `/?session=${encodeURIComponent(bounds.sessionId)}`;
    let answered: string | null = null;
    if (row.status !== "open") {
      const event = await c.env.DB.prepare("SELECT data_json FROM run_events WHERE run_id = ? AND owner_email = ? AND type = 'decision.answered' ORDER BY ts DESC LIMIT 1").bind(id, email).first<{ data_json: string }>();
      answered = event ? ((JSON.parse(event.data_json) as { choice?: string }).choice ?? null) : "(already answered)";
    }
    return c.html(page(id, bounds.question, bounds.options, answered, sessionHref), 200, {
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
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
    if (row.status !== "open") return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "ALREADY_ANSWERED", message: "decision already answered" }, next_actions: [] }, 409);

    const store: DecisionResponseStore = {
      insertEvent: async ({ id, eventId, email, question, choice, now }) => {
        await c.env.DB.prepare("INSERT INTO run_events(run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json) VALUES (?, ?, ?, ?, ?, 'decision.answered', ?, NULL)")
          .bind(id, eventId, email, now, JSON.stringify({ id: email, kind: "human", mode: "live" }), JSON.stringify({ question, choice })).run();
      },
      completeRun: async ({ id, email }) => {
        const result = await c.env.DB.prepare("UPDATE runs SET status = 'completed', updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND status = 'open'").bind(id, email).run();
        return (result.meta?.changes ?? 0) === 1;
      },
      reopenRun: async ({ id, email }) => {
        const result = await c.env.DB.prepare("UPDATE runs SET status = 'open', updated_at = datetime('now') WHERE id = ? AND owner_email = ? AND status = 'completed'").bind(id, email).run();
        return (result.meta?.changes ?? 0) === 1;
      },
      deleteEvent: async ({ id, eventId, email }) => {
        await c.env.DB.prepare("DELETE FROM run_events WHERE run_id = ? AND event_id = ? AND owner_email = ? AND type = 'decision.answered'").bind(id, eventId, email).run();
      },
    };
    try {
      const recorded = await recordDecisionResponse(store, { id, email, question: bounds.question, choice }, async () => {
        const stub = await getSessionAgent(c.env, email, bounds.sessionId);
        await stub.seedIdentity(c.get("identity"));
        await stub.injectUserMessage({ content: `[decision] In response to "${bounds.question}", I chose: ${choice}`, clientMsgId: `decision:${id}` });
        await c.env.DB.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ? AND owner_email = ?").bind(bounds.sessionId, email).run();
      });
      if (!recorded) {
        return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "ALREADY_ANSWERED", message: "decision already answered" }, next_actions: [] }, 409);
      }
    } catch (error) {
      console.error("decision_inject_failed", { id, err: error instanceof Error ? error.message : String(error) });
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "DECISION_RESUME_FAILED", message: "The decision could not reach the conversation. Try again." }, next_actions: [] }, 503);
    }
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { id, choice, resumed: true }, next_actions: [] });
  });
}
