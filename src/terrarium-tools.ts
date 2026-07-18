// terrarium-tools.ts — the `terrarium.*` work_code connector.
//
// Lets the my.ax server-side agent spawn REAL bounded cloud agent runs with
// verified receipts on a Terrarium cloud instance (the same runtime the owner
// runs locally all day). Replaces the retired `cloudbox` connector in the
// trifecta: machine.* (laptop) + page.* (live browser tab) + terrarium.* (cloud).
//
// Contract (verified against terrarium/src/cloud-client.js + api-runs.js):
//   POST /api/runs        { task, spec? }  + Bearer + Idempotency-Key
//     -> 202 { runId, contract:{runId,taskFingerprint,nonce}, executionRef? }
//   GET  /api/runs/:id/status
//     -> { status:{ status, terminal:{ ok, exitCode, taskContractStatus,
//                                       taskResultSummary, reason } } }
// Auth: Authorization: Bearer <TERRARIUM_CONTROL_TOKEN>; the server binds the
// principal id, never the client. Owner never forges identity.

import type { ToolDef } from "./types";

type Ctx = Parameters<ToolDef["execute"]>[1];

const TERMINAL = new Set(["done", "failed", "cancelled", "inconclusive", "error"]);
const POLL_MS = 4000;
const MAX_POLLS = 60; // ~4 min ceiling; work_code itself is bounded upstream.

function configuration(ctx: Ctx) {
  const baseUrl = ctx.env.TERRARIUM_URL?.replace(/\/+$/, "");
  const token = ctx.env.TERRARIUM_CONTROL_TOKEN;
  if (!baseUrl || !token) throw new Error("Terrarium delegation is not configured (TERRARIUM_URL + TERRARIUM_CONTROL_TOKEN required)");
  return { baseUrl, token };
}

async function terrarium(ctx: Ctx, path: string, init?: RequestInit): Promise<{ code: number; json: Record<string, unknown> }> {
  const { baseUrl, token } = configuration(ctx);
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, ...(init?.headers as Record<string, string> ?? {}) };
  if (init?.body !== undefined) {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = crypto.randomUUID();
  }
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await res.text();
  let json: Record<string, unknown>;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { code: res.status, json };
}

/** Poll a run to a terminal state, returning a compact verified-receipt shape. */
async function pollToTerminal(ctx: Ctx, runId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < MAX_POLLS; i++) {
    const s = await terrarium(ctx, `/api/runs/${encodeURIComponent(runId)}/status`);
    const st = (s.json?.status ?? s.json) as Record<string, unknown>;
    const status = String(st?.status ?? "");
    if (TERMINAL.has(status)) {
      const terminal = (st.terminal ?? {}) as Record<string, unknown>;
      return {
        ok: status === "done" && terminal.ok !== false,
        runId,
        status,
        exitCode: terminal.exitCode ?? null,
        taskContractStatus: terminal.taskContractStatus ?? null,
        taskResultSummary: terminal.taskResultSummary ?? null,
        reason: terminal.reason ?? null,
      };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { ok: false, runId, status: "poll-timeout", error: "run did not reach terminal within the poll window (still running; check with terrarium.status)" };
}

export const TERRARIUM_WORK_METHODS = [
  { name: "spawn", description: "Spawn one bounded cloud agent run on Terrarium and wait for its verified receipt. Input: {task, timeoutMs?, model?}. Returns {ok, runId, status, taskContractStatus, taskResultSummary}." },
  { name: "status", description: "Get the current status/receipt of a Terrarium run by id. Input: {runId}." },
  { name: "spawn_background", description: "Spawn a bounded cloud agent run and return its runId immediately WITHOUT waiting. Input: {task, timeoutMs?, model?}. Poll with terrarium.status." },
] as const;

export function createTerrariumWorkProvider(ctx: Ctx) {
  const submit = async (input: any) => {
    const task = String(input?.task ?? "").trim();
    if (!task) throw new Error("terrarium.spawn requires a non-empty {task}");
    const spec: Record<string, unknown> = {};
    if (Number.isFinite(Number(input?.timeoutMs))) spec.deadlineMs = Number(input.timeoutMs);
    if (input?.model) spec.model = String(input.model);
    const body = JSON.stringify({ task, ...(Object.keys(spec).length ? { spec } : {}) });
    const r = await terrarium(ctx, "/api/runs", { method: "POST", body });
    if (r.code !== 202 || !r.json?.runId) {
      throw new Error(String(r.json?.error ?? r.json?.raw ?? `Terrarium admission failed (HTTP ${r.code})`));
    }
    return { runId: String(r.json.runId), contract: r.json.contract ?? null };
  };
  return {
    catalog: TERRARIUM_WORK_METHODS,
    fns: {
      spawn: async (input: any) => {
        const { runId } = await submit(input);
        return pollToTerminal(ctx, runId);
      },
      spawn_background: async (input: any) => {
        const { runId, contract } = await submit(input);
        return { ok: true, runId, status: "running", background: true, contract };
      },
      status: async (input: any) => {
        const runId = String(input?.runId ?? "").trim();
        if (!runId) throw new Error("terrarium.status requires {runId}");
        const s = await terrarium(ctx, `/api/runs/${encodeURIComponent(runId)}/status`);
        const st = (s.json?.status ?? s.json) as Record<string, unknown>;
        const terminal = (st?.terminal ?? {}) as Record<string, unknown>;
        return {
          runId,
          status: st?.status ?? "unknown",
          ok: st?.status === "done" && terminal.ok !== false,
          taskContractStatus: terminal.taskContractStatus ?? null,
          taskResultSummary: terminal.taskResultSummary ?? null,
          reason: terminal.reason ?? null,
        };
      },
    },
  };
}
