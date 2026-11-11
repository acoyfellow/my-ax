<script lang="ts">
  import { onMount } from "svelte";
  import NavIconButton from "./NavIconButton.svelte";
  import { isConfirm, parseVoice } from "./web/voice-grammar";
  import { CONFIRM_WINDOW_MS, confirmStillValid, voiceEffect, voiceSummary, type PendingConfirm } from "./web/voice-dispatch";
  import { recordWebReceipt, webFeatures } from "./web-platform.svelte";
  import { pushSystem } from "@my-ax/store";
  import type { VoiceCommand } from "./web/voice-grammar";

  type Recognition = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
    onend: (() => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    start(): void;
    stop(): void;
  };

  let supported = $state(false);
  let listening = $state(false);
  let pending = $state<PendingConfirm | null>(null);
  let recognition: Recognition | null = null;

  function recognitionCtor(): (new () => Recognition) | null {
    const host = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
  }

  async function runDesk(kind: "approve" | "dismiss", card: number, heard: string) {
    const response = await fetch("/api/voice/desk", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, card, confirmed: true, heard }) }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok || !body?.ok) {
      const message = body?.error?.message ?? "the desk did not accept it";
      recordWebReceipt("voice", `Heard "${heard}" · refused: ${message}`);
      pushSystem(`Voice: ${message}`);
      return;
    }
    window.dispatchEvent(new CustomEvent("my-ax:desk-board", { detail: body.result.board }));
    recordWebReceipt("voice", `Heard "${heard}" · ${voiceSummary({ kind, card })} · done`);
    pushSystem(`Voice: ${voiceSummary({ kind, card })}`);
  }

  function run(command: VoiceCommand, heard: string) {
    const effect = voiceEffect(command);
    if (effect.type === "desk") { void runDesk(effect.kind, effect.card, heard); return; }
    window.dispatchEvent(new CustomEvent(effect.name, { detail: effect.detail }));
    recordWebReceipt("voice", `Heard "${heard}" · ${voiceSummary(command)}`);
  }

  function handleTranscript(heard: string) {
    const now = Date.now();
    if (confirmStillValid(pending, now) && isConfirm(heard)) {
      const confirmed = pending;
      pending = null;
      run(confirmed.command, confirmed.heard);
      return;
    }
    const parsed = parseVoice(heard);
    if (!parsed.ok) {
      if (parsed.reason !== "no-wake") recordWebReceipt("voice", `Heard "${heard}" · not a command`);
      return;
    }
    if (parsed.needsConfirm) {
      pending = { command: parsed.command, heard, expiresAt: now + CONFIRM_WINDOW_MS };
      pushSystem(`Voice: ${voiceSummary(parsed.command)}? Say "confirm".`);
      recordWebReceipt("voice", `Heard "${heard}" · waiting for confirm`);
      return;
    }
    run(parsed.command, heard);
  }

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor || listening) return;
    recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) handleTranscript(result[0].transcript);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        recordWebReceipt("voice", "The browser blocked the microphone");
        stop();
      }
    };
    recognition.onend = () => {
      if (listening && document.visibilityState === "visible" && webFeatures.voice) recognition?.start();
      else listening = false;
    };
    listening = true;
    recognition.start();
    recordWebReceipt("voice", "Listening for AX");
  }

  function stop() {
    listening = false;
    pending = null;
    recognition?.stop();
    recognition = null;
  }

  function toggle() {
    if (listening) stop();
    else start();
  }

  $effect(() => {
    if (!webFeatures.voice && listening) stop();
  });

  onMount(() => {
    supported = recognitionCtor() !== null;
    const onHidden = () => { if (document.visibilityState !== "visible" && listening) stop(); };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      stop();
    };
  });
</script>

{#if supported && webFeatures.voice}
  <NavIconButton label={listening ? "Stop listening for AX" : "Listen for AX voice commands"} onclick={toggle} aria-pressed={listening} data-voice-listen={listening ? "on" : "off"} class="voice-listen">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8.5a6 6 0 0 1 12 0c0 3.5-3 4.5-3 7.5a3 3 0 0 1-6 0" /><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 1.5-1.5 2-1.5 3.5" /><path d="M20 6.5c.9 1.2 1.4 2.6 1.4 4M3.6 10.5c0-1.4.5-2.8 1.4-4" /></svg>
    {#if listening}<span class="voice-listen__ring" aria-hidden="true"></span>{/if}
  </NavIconButton>
{/if}

<style>
  :global(.voice-listen) { position: relative; }
  :global(.voice-listen[data-voice-listen="on"]) { color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, transparent); }
  .voice-listen__ring { position: absolute; inset: 4px; border-radius: 999px; border: 2px solid var(--brand); opacity: 0; animation: voice-listen-ring 1.6s ease-out infinite; pointer-events: none; }
  @keyframes voice-listen-ring { 0% { transform: scale(0.7); opacity: 0.7; } 100% { transform: scale(1.15); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .voice-listen__ring { animation: none; opacity: 0.6; transform: none; } }
</style>
