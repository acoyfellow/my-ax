import type { DeskBoard } from "./desk-board";

export class DeskHub {
  constructor(readonly ctx: DurableObjectState, readonly env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const board = (await request.json()) as DeskBoard;
      const frame = JSON.stringify({ type: "desk.board", board });
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(frame); } catch { socket.close(); }
      }
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  }
}
