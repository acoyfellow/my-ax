import { Agent, getAgentByName, getSubAgentByName } from "agents";
import { withVoice, WorkersAIFluxSTT, WorkersAITTS, type VoiceTurnContext } from "@cloudflare/voice";
import { MyAgent } from "./agent";
import type { Env } from "./types";
import type { AccessIdentity } from "./auth";
import { resolveVoiceThinkConfig, type VoiceThinkConfig } from "./voice-think-config";
import { StillWorkingTimer, WORK_ACK } from "./voice-narration";
import { VoiceTurnReplyBuffer, consumeVoiceTurnStream } from "./voice-turn-stream";
import { MarkdownSpeechSanitizer } from "./markdown-speech";

// If the turn resolves within this window, stay terse (just the reply). Only
// past it do we speak the up-front ack and periodic "still working" check-ins,
// so a quick "hi" is not prefaced with "I'll talk you through it."
const VOICE_ACK_THRESHOLD_MS = 3500;
// How often we poll for the reply while emitting check-ins.
const VOICE_CHECKIN_POLL_MS = 1000;
// Idle gap between spoken "still working" check-ins during a long turn.
const VOICE_CHECKIN_IDLE_MS = 20000;

const VoiceAgent = withVoice(Agent);

/**
 * Direct-routed voice agent. It exists ONLY to host the stock
 * @cloudflare/voice call lifecycle, which is proven to work over a direct
 * routeAgentRequest socket (see /voice-proof) but does NOT survive the
 * agents sub-agent WebSocket bridge that backs MyAgent facets. We verified
 * this empirically: a facet socket receives start_call but never emits
 * audio_config/listening, while the direct route does. (the agents sub-agent WS bridge drops start_call; a direct route does not).
 *
 * Each spoken turn is delegated by RPC to the canonical MyAgent facet
 * (runVoiceTurn), so the real Think transcript/tools/memory stay the single
 * source of truth and the reply broadcasts cf_agent_* frames to the open chat
 * socket (chat log updates live). We return incremental assistant deltas so
 * the streaming TTS path can begin at the first complete sentence.
 */
export class VoiceThinkAgent extends VoiceAgent<Env> {
  transcriber = new WorkersAIFluxSTT(this.env.AI);
  tts = new WorkersAITTS(this.env.AI, { speaker: "asteria" });

  /** Seeded by the route before the socket opens: which owner + Think session
   *  this voice call delegates into. */
  async seedSession(identity: AccessIdentity, sessionId: string) {
    this.setState({ ...(this.state as VoiceThinkConfig), identity, sessionId } as VoiceThinkConfig);
  }

  // Async generator: @cloudflare/voice's iterateText consumes an
  // AsyncIterable<string>, speaking each yielded segment as its own TTS
  // utterance. We use that to keep the owner informed during long, tool-heavy
  // turns: fast turns stay terse (just the reply); slow turns get an up-front
  // acknowledgement plus periodic "still working" check-ins so there is no
  // dead air. All yielded audio plays while the client half-duplex gate has
  // the mic suppressed, so it cannot feed back. Per-tool narration (C3b) is
  // deferred: it needs the facet->voice RPC to stream tool events, which is a
  // heavier change (see designs/1c-server-narration-checkins.md).
  // Returns an AsyncIterable<string> (a TextSource); @cloudflare/voice speaks
  // each yielded segment as its own utterance.
  async onTurn(transcript: string, context: VoiceTurnContext): Promise<AsyncGenerator<string>> {
    const speechSanitizer = new MarkdownSpeechSanitizer();
    const cfg = resolveVoiceThinkConfig((this.state ?? {}) as VoiceThinkConfig, this.name);
    if (!(this.state as VoiceThinkConfig | undefined)?.identity || !(this.state as VoiceThinkConfig | undefined)?.sessionId) {
      if (cfg.identity && cfg.sessionId) this.setState({ ...(this.state as VoiceThinkConfig | undefined), ...cfg } as VoiceThinkConfig);
    }
    const env = this.env;
    async function* stream(): AsyncGenerator<string> {
      if (!cfg.identity || !cfg.sessionId) { yield "Voice session is not linked to a conversation yet."; return; }

      type VoiceTurnOutcome = { receivedText: boolean } | { error: string } | null;
      const state: { outcome: VoiceTurnOutcome } = { outcome: null };
      const replyBuffer = new VoiceTurnReplyBuffer();
      const runReply = (async () => {
        try {
          const parent = await getAgentByName(env.USER_AGENT, cfg.identity!.email.toLowerCase());
          const facet = await getSubAgentByName(parent, MyAgent, cfg.sessionId!);
          await facet.seedIdentity(cfg.identity!);
          const response = await facet.runVoiceTurnStream(transcript);
          const result = await consumeVoiceTurnStream(response, context.signal, (chunk) => replyBuffer.push(chunk));
          if (result === null) {
            replyBuffer.interrupt();
            return;
          }
          state.outcome = result;
        } catch (e) {
          console.error("voice_turn_failed", { err: e instanceof Error ? e.message : String(e) });
          state.outcome = { error: "Voice turn error: " + (e instanceof Error ? e.message : String(e)) };
        } finally {
          replyBuffer.complete();
        }
      })();

      const checkins = new StillWorkingTimer(VOICE_CHECKIN_IDLE_MS, Date.now());
      const firstChunkReady = await replyBuffer.waitForChunk(VOICE_ACK_THRESHOLD_MS, context.signal);
      if (context.signal.aborted) {
        replyBuffer.interrupt();
        return;
      }
      if (!firstChunkReady && !state.outcome) {
        checkins.markSpoken(Date.now());
        yield WORK_ACK;
      }
      const firstChunks = replyBuffer.drain();
      for (const chunk of firstChunks) {
        const spoken = speechSanitizer.push(chunk);
        if (spoken) yield spoken;
      }
      if (firstChunks.length > 0) checkins.markSpoken(Date.now());

      while (!state.outcome && !context.signal.aborted) {
        const chunkReady = await replyBuffer.waitForChunk(VOICE_CHECKIN_POLL_MS, context.signal);
        const chunks = replyBuffer.drain();
        for (const chunk of chunks) {
          const spoken = speechSanitizer.push(chunk);
          if (spoken) yield spoken;
        }
        if (chunks.length > 0) checkins.markSpoken(Date.now());
        if (!chunkReady && !state.outcome) {
          const line = checkins.tick(Date.now());
          if (line) yield line;
        }
      }

      await runReply;
      for (const chunk of replyBuffer.drain()) {
        const spoken = speechSanitizer.push(chunk);
        if (spoken) yield spoken;
      }
      if (context.signal.aborted) {
        replyBuffer.interrupt();
        return;
      }
      const outcome = state.outcome;
      if (!outcome) return;
      if ("receivedText" in outcome) {
        for (const chunk of replyBuffer.finish(outcome.receivedText)) {
          const spoken = speechSanitizer.push(chunk);
          if (spoken) yield spoken;
        }
      }
      const terminal = speechSanitizer.finish();
      if (terminal) yield terminal;
      if ("error" in outcome) yield outcome.error;
    }
    return stream();
  }
}
