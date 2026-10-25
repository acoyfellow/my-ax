import { DurableObject } from "cloudflare:workers";
import { eventsSince, matches, type Subscription, type WorkspaceChange, type WorkspaceEvent } from "./workspace-hub-client";

const RECENT_LIMIT = 200;
const SEQ_KEY = "hub-seq";
const RECENT_KEY = "hub-recent";
const SUBSCRIPTION_TAG_PREFIX = "sub:";

function encodeSubscription(subscription: Subscription): string {
  return `${SUBSCRIPTION_TAG_PREFIX}${btoa(JSON.stringify(subscription))}`;
}

function decodeSubscription(tags: readonly string[]): Subscription {
  const tag = tags.find((value) => value.startsWith(SUBSCRIPTION_TAG_PREFIX));
  if (!tag) return {};
  try {
    return JSON.parse(atob(tag.slice(SUBSCRIPTION_TAG_PREFIX.length))) as Subscription;
  } catch {
    return {};
  }
}

export class WorkspaceHub extends DurableObject {
  private recent(): WorkspaceEvent[] {
    return this.ctx.storage.kv.get<WorkspaceEvent[]>(RECENT_KEY) ?? [];
  }

  async publish(change: WorkspaceChange): Promise<WorkspaceEvent> {
    const seq = (this.ctx.storage.kv.get<number>(SEQ_KEY) ?? 0) + 1;
    const event: WorkspaceEvent = { ...change, seq, at: Date.now() };
    this.ctx.storage.kv.put(SEQ_KEY, seq);
    this.ctx.storage.kv.put(RECENT_KEY, [...this.recent(), event].slice(-RECENT_LIMIT));
    const frame = JSON.stringify({ type: "workspace_event", event });
    for (const socket of this.ctx.getWebSockets()) {
      if (!matches(decodeSubscription(this.ctx.getTags(socket)), event)) continue;
      try {
        socket.send(frame);
      } catch {
        socket.close(1011, "send failed");
      }
    }
    return event;
  }

  async since(since: number, subscription: Subscription = {}): Promise<WorkspaceEvent[]> {
    return eventsSince(this.recent(), since, subscription);
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket upgrade required", { status: 426 });
    const url = new URL(request.url);
    const subscription: Subscription = {
      workspaces: url.searchParams.getAll("workspace"),
      kinds: url.searchParams.getAll("kind"),
    };
    const since = Number(url.searchParams.get("since") ?? "0") || 0;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [encodeSubscription(subscription)]);
    const missed = eventsSince(this.recent(), since, subscription);
    server.send(JSON.stringify({ type: "workspace_hello", seq: this.ctx.storage.kv.get<number>(SEQ_KEY) ?? 0, missed }));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") socket.send("pong");
  }

  override async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    socket.close(code === 1005 ? 1000 : code, "closed");
  }
}

