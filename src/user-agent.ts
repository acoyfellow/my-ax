// user-agent.ts — one durable root per authenticated owner.
//
// Conversation Think agents run as MyAgent facets keyed by session id inside
// this root DO. The outer per-user root is the durable convergence point for
// future shared MCP connections, cross-session memory, and schedule ownership.

import { Agent, type AgentPathStep } from "agents";
import { deskAppFrame, deskBoardFrame } from "./desk-live";
import type { DeskBoard } from "./desk-board";
import type { DeskApp } from "./desk-app";
import type { Env } from "./types";

export type JobAlarmPayload = { jobId: string; ownerEmail: string };

export const SESSION_AGENT_CLASS = "MyAgent";

export function sessionSocketPath(rootPath: ReadonlyArray<AgentPathStep>, sessionId: string): AgentPathStep[] {
  return [...rootPath, { className: SESSION_AGENT_CLASS, name: sessionId }];
}

export class UserAgent extends Agent<Env> {
  async scheduleJobAlarm(payload: JobAlarmPayload & { cadenceSecs: number }): Promise<{ id: string }> {
    const schedule = await this.scheduleEvery(payload.cadenceSecs, "runJobAlarm", { jobId: payload.jobId, ownerEmail: payload.ownerEmail });
    return { id: schedule.id };
  }

  async cancelJobAlarm(scheduleId: string): Promise<boolean> {
    return this.cancelSchedule(scheduleId);
  }

  async runJobAlarm(payload: JobAlarmPayload): Promise<void> {
    const { loadActiveJob, runJobNow } = await import("./jobs");
    const row = await loadActiveJob(this.env, payload.jobId, payload.ownerEmail);
    if (!row) return;
    const result = await runJobNow(this.env, row);
    if (!result.ok && result.error !== "job is not active or has exhausted its run limit") throw new Error(result.error ?? "recurring job failed");
  }

  async broadcastDeskBoard(sessionIds: string[], board: DeskBoard): Promise<void> {
    await this.sendToSessionSockets(sessionIds, deskBoardFrame(board));
  }

  async broadcastDeskApp(sessionIds: string[], app: DeskApp): Promise<void> {
    const frame = deskAppFrame(app);
    this.broadcast(frame);
    await this.sendToSessionSockets(sessionIds, frame);
  }

  private async sendToSessionSockets(sessionIds: string[], frame: string): Promise<void> {
    for (const sessionId of sessionIds) {
      if (!sessionId) continue;
      await this._cf_broadcastToSubAgent(sessionSocketPath(this.selfPath, sessionId), frame);
    }
  }
}

export class DeskHub extends Agent<Env> {}
