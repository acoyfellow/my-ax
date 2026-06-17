// user-agent.ts — one durable root per authenticated owner.
//
// Conversation Think agents run as MyAgent facets keyed by session id inside
// this root DO. The outer per-user root is the durable convergence point for
// future shared MCP connections, cross-session memory, and schedule ownership.

import { Agent } from "agents";
import type { Env } from "./types";

export class UserAgent extends Agent<Env> {}
