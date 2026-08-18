// user-agent.ts — one durable root per authenticated owner.
//
// Conversation Think agents run as MyAgent facets keyed by session id inside
// this root DO. The outer per-user root is the durable convergence point for
// future shared MCP connections, cross-session memory, and schedule ownership.

import { Agent, getSubAgentByName } from "agents";
import { MyAgent } from "./agent";
import { deskBoardFrame } from "./desk-live";
import type { DeskBoard } from "./desk-board";
import type { Env } from "./types";

export class UserAgent extends Agent<Env> {
  async broadcastDeskBoard(sessionIds: string[], board: DeskBoard): Promise<void> {
    const frame = deskBoardFrame(board);
    for (const sessionId of sessionIds) {
      if (!sessionId) continue;
      const facet = await getSubAgentByName(this, MyAgent, sessionId);
      facet.broadcast(frame);
    }
  }
}

export class DeskHub extends Agent<Env> {}
