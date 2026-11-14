import { Agent } from "agents";
import { deskAppFrame, deskBoardFrame } from "./desk-live";
import type { DeskBoard } from "./desk-board";
import type { DeskApp } from "./desk-app";
import type { Env } from "./types";

export type JobAlarmPayload = { jobId: string; ownerEmail: string };

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
    const { openPiChat } = await import("./pi-engine/routes");
    const owner = this.name;
    await Promise.allSettled(sessionIds.filter(Boolean).map(async (sessionId) => (await openPiChat(this.env, owner, sessionId)).broadcastFrame(frame)));
  }
}

export class DeskHub extends Agent<Env> {}
