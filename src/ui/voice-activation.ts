export interface VoiceActivationClient {
  readonly connected: boolean;
  connect(): void;
  startCall(): Promise<void>;
  endCall(): void;
  disconnect(): void;
}

export type VoicePreparationReason = "missing-client" | "wrong-session" | "disconnected-client";

export type VoiceActivationAttempt<Client extends VoiceActivationClient> =
  | { kind: "needs-session" }
  | { kind: "started"; client: Client; completion: Promise<void>; reason?: VoicePreparationReason };

type PreparedVoiceClient<Client extends VoiceActivationClient> = {
  sessionId: string;
  client: Client;
};

export const VOICE_CONNECT_WAIT_MS = 8_000;

export async function startCallWhenConnected(
  client: VoiceActivationClient,
  waitMs = VOICE_CONNECT_WAIT_MS,
  now: () => number = Date.now,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  if (!client.connected) client.connect();
  const deadline = now() + waitMs;
  while (!client.connected && now() < deadline) {
    await pause(20);
  }
  if (!client.connected) throw new Error("Voice socket did not connect");
  return client.startCall();
}

export async function createAndPrepareVoiceSession(
  createSession: () => Promise<string>,
  sessionIsCurrent: (sessionId: string) => boolean,
  connectChat: (sessionId: string) => void,
  prepareVoice: (sessionId: string) => void,
): Promise<string | null> {
  const sessionId = await createSession();
  if (!sessionIsCurrent(sessionId)) return null;
  connectChat(sessionId);
  prepareVoice(sessionId);
  return sessionId;
}

export class VoiceActivationLifecycle<Client extends VoiceActivationClient> {
  private prepared: PreparedVoiceClient<Client> | null = null;

  prepare(sessionId: string, createClient: (sessionId: string) => Client): Client {
    if (this.prepared?.sessionId === sessionId) return this.prepared.client;
    this.clear();
    const client = createClient(sessionId);
    this.prepared = { sessionId, client };
    client.connect();
    return client;
  }

  activate(sessionId: string | null, createClient: (sessionId: string) => Client): VoiceActivationAttempt<Client> {
    if (!sessionId) {
      this.clear();
      return { kind: "needs-session" };
    }

    const prepared = this.prepared;
    if (prepared?.sessionId === sessionId) {
      return { kind: "started", client: prepared.client, completion: startCallWhenConnected(prepared.client) };
    }

    const reason: VoicePreparationReason = !prepared
      ? "missing-client"
      : prepared.sessionId !== sessionId
        ? "wrong-session"
        : "disconnected-client";
    this.clear();
    const client = this.prepare(sessionId, createClient);
    return { kind: "started", client, completion: startCallWhenConnected(client), reason };
  }

  acceptsEvent(sessionId: string, client: Client, currentSessionId: string | null): boolean {
    return currentSessionId === sessionId && this.prepared?.sessionId === sessionId && this.prepared.client === client;
  }

  clear(): void {
    const prepared = this.prepared;
    this.prepared = null;
    if (!prepared) return;
    prepared.client.endCall();
    prepared.client.disconnect();
  }
}
