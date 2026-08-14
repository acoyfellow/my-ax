import assert from "node:assert/strict";
import test from "node:test";
import { withVoice } from "@cloudflare/voice";

class VoiceTestBase {
  sql(_strings: TemplateStringsArray): void {}

  getConnections(): [] {
    return [];
  }

  async keepAlive(): Promise<() => void> {
    return () => undefined;
  }

  onConnect(_connection: TestConnection): void {}

  onMessage(_connection: TestConnection, _message: unknown): void {}

  onClose(_connection: TestConnection): void {}
}

type TestConnection = {
  id: string;
  sent: unknown[];
  send(message: unknown): void;
};

const VoiceTestAgent = withVoice(VoiceTestBase as never) as unknown as typeof VoiceTestBase;

class VoiceLifecycleProbe extends VoiceTestAgent {
  transcriber = {
    createSession: () => ({
      close: () => undefined,
      sendAudio: () => undefined,
    }),
  };

  tts = {
    synthesize: async () => null,
  };

  async onTurn(): Promise<string> {
    return "unused";
  }
}

function connection(): TestConnection {
  const sent: unknown[] = [];
  return {
    id: "voice-facet-connection",
    sent,
    send(message: unknown) {
      sent.push(typeof message === "string" ? JSON.parse(message) : message);
    },
  };
}

async function waitForMessage(messages: unknown[], type: string, status?: string): Promise<void> {
  const deadline = Date.now() + 250;
  while (Date.now() < deadline) {
    if (messages.some((message) => {
      if (!message || typeof message !== "object") return false;
      const value = message as { type?: string; status?: string };
      return value.type === type && (status === undefined || value.status === status);
    })) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`did not receive ${status ? `${type}/${status}` : type}`);
}

test("voice lifecycle handles start_call and reaches audio_config/listening", async () => {
  const voice = new VoiceLifecycleProbe();
  const client = connection();

  voice.onConnect(client);
  voice.onMessage(client, JSON.stringify({ type: "start_call" }));

  await waitForMessage(client.sent, "audio_config");
  await waitForMessage(client.sent, "status", "listening");
});
