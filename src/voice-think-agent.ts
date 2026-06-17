import { Agent, getAgentByName, getSubAgentByName } from "agents";
import { withVoice, WorkersAIFluxSTT, WorkersAITTS, type VoiceTurnContext } from "@cloudflare/voice";
import { MyAgent } from "./agent";
import type { Env } from "./types";
import type { AccessIdentity } from "./auth";

const VoiceAgent = withVoice(Agent);

type VoiceThinkConfig = { identity?: AccessIdentity; sessionId?: string };

/**
 * Direct-routed voice agent. It exists ONLY to host the stock
 * `@cloudflare/voice` call lifecycle, which is proven to work over a direct
 * `routeAgentRequest` socket (see `/voice-proof`) but does NOT survive the
 * agents sub-agent WebSocket bridge that backs `MyAgent` facets. We verified
 * this empirically: a facet socket receives `start_call` but never emits
 * `audio_config`/`listening`, while the direct route does. (the agents sub-agent WS bridge drops start_call; a direct route does not).
 *
 * Each spoken turn is delegated by RPC to the canonical `MyAgent` facet
 * (`runVoiceTurn`), so the real Think transcript/tools/memory stay the single
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

  async onTurn(transcript: string, _context: VoiceTurnContext): Promise<string> {
    const cfg = (this.state ?? {}) as VoiceThinkConfig;
    if (!cfg.identity || !cfg.sessionId) return "Voice session is not linked to a conversation yet.";
    try {
      const parent = await getAgentByName(this.env.USER_AGENT, cfg.identity.email.toLowerCase());
      const facet = await getSubAgentByName(parent, MyAgent, cfg.sessionId);
      await facet.seedIdentity(cfg.identity);
      const reply = await facet.runVoiceTurn(transcript);
      return reply || "Sorry, I didn't catch a response.";
    } catch (e) {
      console.error("voice_turn_failed", { err: e instanceof Error ? e.message : String(e) });
      return `Voice turn error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}
