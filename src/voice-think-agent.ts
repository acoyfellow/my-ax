import { Agent, getAgentByName, getSubAgentByName } from "agents";
import { withVoice, WorkersAIFluxSTT, WorkersAITTS, type VoiceTurnContext } from "@cloudflare/voice";
import { MyAgent } from "./agent";
import type { Env } from "./types";
import type { AccessIdentity } from "./auth";
import { resolveVoiceThinkConfig, type VoiceThinkConfig } from "./voice-think-config";
import { StillWorkingTimer, WORK_ACK } from "./voice-narration";

// If the turn resolves within this window, stay terse (just the reply). Only
// past it do we speak the up-front ack and periodic "still working" check-ins,
// so a quick "hi" is not prefaced with "I'll talk you through it."
const VOICE_ACK_THRESHOLD_MS = 3500;
// How often we poll for the reply while emitting check-ins.
const VOICE_CHECKIN_POLL_MS = 1000;
// Idle gap between spoken "still working" check-ins during a long turn.
const VOICE_CHECKIN_IDLE_MS = 20000;

function delay(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

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
 * socket (chat log updates live). We return the full assistant string so the
 * stock string TTS path synthesizes and speaks it.
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
  async onTurn(transcript: string, _context: VoiceTurnContext): Promise<AsyncGenerator<string>> {
    const cfg = resolveVoiceThinkConfig((this.state ?? {}) as VoiceThinkConfig, this.name);
    if (!(this.state as VoiceThinkConfig | undefined)?.identity || !(this.state as VoiceThinkConfig | undefined)?.sessionId) {
      if (cfg.identity && cfg.sessionId) this.setState({ ...(this.state as VoiceThinkConfig | undefined), ...cfg } as VoiceThinkConfig);
    }
    const env = this.env;
    async function* stream(): AsyncGenerator<string> {
      if (!cfg.identity || !cfg.sessionId) { yield "Voice session is not linked to a conversation yet."; return; }

      let outcome: { reply: string } | { error: string } | null = null;
      const runReply = (async () => {
        try {
          const parent = await getAgentByName(env.USER_AGENT, cfg.identity!.email.toLowerCase());
          const facet = await getSubAgentByName(parent, MyAgent, cfg.sessionId!);
          await facet.seedIdentity(cfg.identity!);
          const reply = await facet.runVoiceTurn(transcript);
          outcome = { reply: reply || "Sorry, I didn't catch a response." };
        } catch (e) {
          console.error("voice_turn_failed", { err: e instanceof Error ? e.message : String(e) });
          outcome = { error: "Voice turn error: " + (e instanceof Error ? e.message : String(e)) };
        }
      })();

      // Fast path: if the turn resolves quickly, stay terse.
      await Promise.race([runReply, delay(VOICE_ACK_THRESHOLD_MS)]);
      if (!outcome) {
        // Slow turn: acknowledge, then emit bounded "still working" check-ins
        // until the reply lands.
        const now = Date.now();
        const checkins = new StillWorkingTimer(VOICE_CHECKIN_IDLE_MS, now);
        checkins.markSpoken(now);
        yield WORK_ACK;
        while (!outcome) {
          await Promise.race([runReply, delay(VOICE_CHECKIN_POLL_MS)]);
          if (outcome) break;
          const line = checkins.tick(Date.now());
          if (line) yield line;
        }
      }

      const settled = outcome as { reply: string } | { error: string };
      yield "error" in settled ? settled.error : settled.reply;
    }
    return stream();
  }
}
