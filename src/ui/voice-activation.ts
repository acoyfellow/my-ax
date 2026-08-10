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
  | { kind: "preparing"; reason: VoicePreparationReason; client: Client }
  | { kind: "started"; client: Client; completion: Promise<void> };

type PreparedVoiceClient<Client extends VoiceActivationClient> = {
  sessionId: string;
  client: Client;
};

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
    if (prepared?.sessionId === sessionId && prepared.client.connected) {
      let completion: Promise<void>;
      try {
        completion = prepared.client.startCall();
      } catch (error) {
        completion = Promise.reject(error);
      }
      return { kind: "started", client: prepared.client, completion };
    }

    const reason: VoicePreparationReason = !prepared
      ? "missing-client"
      : prepared.sessionId !== sessionId
        ? "wrong-session"
        : "disconnected-client";
    this.clear();
    const client = this.prepare(sessionId, createClient);
    return { kind: "preparing", reason, client };
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
