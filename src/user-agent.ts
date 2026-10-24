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

export const SESSION_AGENT_CLASS = "MyAgent";

export function sessionSocketPath(rootPath: ReadonlyArray<AgentPathStep>, sessionId: string): AgentPathStep[] {
  return [...rootPath, { className: SESSION_AGENT_CLASS, name: sessionId }];
}

export class UserAgent extends Agent<Env> {
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
