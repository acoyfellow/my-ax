import type { AppEnv } from "./app-env";

type RunReceiptContext = { env: AppEnv["Bindings"]; get: (key: "identity") => AppEnv["Variables"]["identity"] };

export type RunActor = {
  id: string;
  kind: "human" | "coordinator" | "machinectl" | "harness" | "cloudflare-room" | "verifier" | "recorder" | string;
  mode: "live" | "simulated" | string;
};

export type AppendRunEventInput = {
  event_id?: string;
  ts?: string;
  actor: RunActor;
  type: string;
  data?: Record<string, unknown>;
  evidence?: Record<string, unknown> | null;
};

export type AppendRunEventResult = { runId: string; eventId: string; type: string };

export class RunReceiptNotFoundError extends Error {
  constructor() {
    super("run not found or not owned");
    this.name = "RunReceiptNotFoundError";
  }
}

export function runEventId(type: string): string {
  const safeType = type.replace(/[^a-z0-9_.-]/gi, "-").slice(0, 64) || "event";
  return `evt-${safeType}-${crypto.randomUUID()}`;
}

export async function appendOwnedRunEvent(c: RunReceiptContext, runId: string, input: AppendRunEventInput): Promise<AppendRunEventResult> {
  const email = c.get("identity").email;
  const run = await c.env.DB.prepare(
    "SELECT id FROM runs WHERE id = ? AND owner_email = ?",
  ).bind(runId, email).first<{ id: string }>();
  if (!run) throw new RunReceiptNotFoundError();

  const type = input.type.trim();
  const id = input.event_id?.trim() || runEventId(type);
  const ts = input.ts?.trim() || new Date().toISOString();
  const data = input.data && typeof input.data === "object" ? input.data : {};
  const evidence = input.evidence && typeof input.evidence === "object" ? input.evidence : null;

  await c.env.DB.prepare(
    "INSERT INTO run_events (run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(runId, id, email, ts, JSON.stringify(input.actor), type, JSON.stringify(data), evidence ? JSON.stringify(evidence) : null).run();
  await c.env.DB.prepare(
    "UPDATE runs SET status = CASE WHEN status = 'open' THEN 'running' ELSE status END, updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
  ).bind(runId, email).run();

  return { runId, eventId: id, type };
}
