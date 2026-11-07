import { initialSocketConnection, nextSocketConnection, retryDelayMs, type SocketConnectionEvent } from "../fsm/socket-connection";
export type ReconnectingSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "close", listener: (event: CloseEvent) => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent<string>) => void): void;
};

type TimerHandle = unknown;

export type ReconnectingSocketDependencies = {
  createSocket(url: string): ReconnectingSocketLike;
  schedule(callback: () => void, delayMs: number): TimerHandle;
  cancel(handle: TimerHandle): void;
  random(): number;
};

export type ReconnectingSocketCallbacks = {
  onOpen(): void;
  onClose(event: CloseEvent): void;
  onError(): void;
  onMessage(data: string): void;
  // Fired once when the transport gives up after maxAttempts consecutive
  // failed connects. The transport stops scheduling retries; the UI can show a
  // truthful terminal offline state and call resume() to try again.
  onExhausted?(info: { attempts: number }): void;
};

export type ReconnectingSocketOptions = {
  // Cap on consecutive failed connects before onExhausted fires. Omit for the
  // default unbounded retry behavior (preserves the pre-existing contract).
  maxAttempts?: number;
};

export type ReconnectingSocket = {
  send(data: string): void;
  forceReconnect(): void;
  // Resume reconnection after terminal exhaustion (from a Retry affordance).
  resume(): void;
  close(): void;
  readonly readyState: number;
};

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

const browserDependencies: ReconnectingSocketDependencies = {
  createSocket: (url) => new WebSocket(url),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (handle) => window.clearTimeout(handle as number),
  random: Math.random,
};

/**
 * Owns one logical reconnecting transport. Every browser WebSocket created by
 * this transport is generation-bound: callbacks from a replaced or manually
 * retired socket are ignored, so they cannot mutate a newer conversation.
 */
export function createReconnectingSocket(
  url: string,
  callbacks: ReconnectingSocketCallbacks,
  dependencies: ReconnectingSocketDependencies = browserDependencies,
  options: ReconnectingSocketOptions = {},
): ReconnectingSocket {
  const maxAttempts = options.maxAttempts;
  let connection = initialSocketConnection();
  let socket: ReconnectingSocketLike | null = null;
  let retryTimer: TimerHandle | null = null;
  const queue: string[] = [];
  // Dedup set of stable keys for currently-queued payloads. Guards against
  // double-enqueue when the composer no longer blocks sends during a
  // reconnect (see eed59d5 + Chat.svelte:onSubmit): a user retrying the same
  // message while the socket is still reconnecting must NOT land twice on the
  // server when the queue eventually flushes on open.
  const queuedKeys = new Set<string>();

  function payloadKey(data: string): string {
    // Prefer a client-provided id when the payload is JSON with a top-level
    // `id`; this matches how chat messages are constructed (agents SDK's
    // `cf_agent_use_chat_request` carries the message id). Fall back to the
    // raw payload string so non-JSON control frames still dedup.
    try {
      const parsed = JSON.parse(data) as { id?: unknown };
      if (parsed && typeof parsed.id === "string" && parsed.id) return `id:${parsed.id}`;
    } catch {}
    return `raw:${data}`;
  }

  function isCurrent(candidate: ReconnectingSocketLike): boolean {
    return connection.kind !== "closed" && socket === candidate;
  }

  function clearRetry() {
    if (retryTimer !== null) dependencies.cancel(retryTimer);
    retryTimer = null;
  }

  function dispatch(event: SocketConnectionEvent) {
    const step = nextSocketConnection(connection, event);
    connection = step.state;
    if (step.effect === "connect") { clearRetry(); connect(); }
    else if (step.effect === "schedule_retry" && connection.kind === "waiting") {
      const due = connection.attempt;
      retryTimer = dependencies.schedule(() => { retryTimer = null; if (connection.kind === "waiting" && connection.attempt === due) dispatch({ type: "retry_due" }); }, retryDelayMs(due, dependencies.random()));
    }
    else if (step.effect === "signal_exhausted" && connection.kind === "exhausted") callbacks.onExhausted?.({ attempts: connection.attempt });
    else if (step.effect === "close_socket") socket?.close(4000, "stale connection");
    else if (step.effect === "shutdown") {
      queue.length = 0;
      queuedKeys.clear();
      clearRetry();
      socket?.close();
    }
  }

  function connect() {
    if (connection.kind !== "connecting") return;
    const candidate = dependencies.createSocket(url);
    socket = candidate;

    candidate.addEventListener("open", () => {
      if (!isCurrent(candidate)) return;
      dispatch({ type: "opened" });
      // Flush the queue, releasing dedup keys as each payload leaves so a
      // future legitimate retry of the same id (rare, e.g. edit-and-resend)
      // is still accepted.
      while (queue.length) {
        const next = queue.shift()!;
        queuedKeys.delete(payloadKey(next));
        candidate.send(next);
      }
      callbacks.onOpen();
    });
    candidate.addEventListener("close", (event) => {
      if (!isCurrent(candidate)) return;
      callbacks.onClose(event);
      dispatch({ type: "dropped", maxAttempts });
    });
    candidate.addEventListener("error", () => {
      if (!isCurrent(candidate)) return;
      callbacks.onError();
    });
    candidate.addEventListener("message", (event) => {
      if (!isCurrent(candidate)) return;
      callbacks.onMessage(event.data);
    });
  }

  connect();

  return {
    send(data: string) {
      if (connection.kind === "closed") return;
      if (socket?.readyState === SOCKET_OPEN) {
        socket.send(data);
        return;
      }
      const key = payloadKey(data);
      if (queuedKeys.has(key)) return; // idempotent: same payload already queued
      queuedKeys.add(key);
      queue.push(data);
    },
    forceReconnect() {
      dispatch({ type: "force_reconnect" });
    },
    resume() {
      dispatch({ type: "resume" });
    },
    close() {
      dispatch({ type: "close" });
    },
    get readyState() {
      return socket?.readyState ?? SOCKET_CONNECTING;
    },
  };
}
