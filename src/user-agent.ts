import { Agent } from "agents";
import { deskAppFrame, deskBoardFrame, filterLiveDeskTargets, LIVE_CHAT_KEY_PREFIX, LIVE_CHAT_TTL_MS } from "./desk-live";
import { SESSION_TILE_FRAME, type TileStateObject } from "./tile-panel";
import type { DeskBoard } from "./desk-board";
import type { DeskApp } from "./desk-app";
import type { Env } from "./types";

export const MACHINES_CHANGED_FRAME = "machines.changed";

export type JobAlarmPayload = { jobId: string; ownerEmail: string };

export class UserAgent extends Agent<Env> {
  shouldSendProtocolMessages(): boolean {
    return false;
  }

  onMessage(): void {}

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

  async announceMachinesChanged(): Promise<void> {
    this.broadcast(JSON.stringify({ type: MACHINES_CHANGED_FRAME }));
  }

  async announceSessionTile(sessionId: string, tileArtifactId: string | null, tileState: TileStateObject): Promise<void> {
    this.broadcast(JSON.stringify({ type: SESSION_TILE_FRAME, sessionId, tileArtifactId, tileState }));
  }

  async registerChatSocket(chatId: string, connected: boolean): Promise<void> {
    if (!chatId) return;
    const key = `${LIVE_CHAT_KEY_PREFIX}${chatId}`;
    if (connected) this.ctx.storage.kv.put(key, Date.now());
    else this.ctx.storage.kv.delete(key);
  }

  private liveChats(now: number): Map<string, number> {
    const live = new Map<string, number>();
    for (const [key, value] of this.ctx.storage.kv.list<number>({ prefix: LIVE_CHAT_KEY_PREFIX })) {
      const chatId = key.slice(LIVE_CHAT_KEY_PREFIX.length);
      if (typeof value === "number" && now - value <= LIVE_CHAT_TTL_MS) live.set(chatId, value);
      else this.ctx.storage.kv.delete(key);
    }
    return live;
  }

  async broadcastDeskBoard(sessionIds: string[], board: DeskBoard): Promise<void> {
    const frame = deskBoardFrame(board);
    this.broadcast(frame);
    await this.sendToSessionSockets(sessionIds, frame);
  }

  async broadcastDeskApp(sessionIds: string[], app: DeskApp): Promise<void> {
    const frame = deskAppFrame(app);
    this.broadcast(frame);
    await this.sendToSessionSockets(sessionIds, frame);
  }

  private async sendToSessionSockets(sessionIds: string[], frame: string): Promise<void> {
    const targets = filterLiveDeskTargets(sessionIds, this.liveChats(Date.now()), Date.now());
    if (!targets.length) return;
    const { openPiChat } = await import("./pi-engine/routes");
    const owner = this.name;
    await Promise.allSettled(targets.map(async (sessionId) => (await openPiChat(this.env, owner, sessionId)).broadcastFrame(frame)));
  }
}

export class DeskHub extends Agent<Env> {}
