export const VOICE_CHANNEL_PREFIX = "VOICE_CHANNEL=audio. Reply in short spoken sentences. No markdown, bullets, or URLs. User said: ";

export function voiceChannelPrompt(transcript: string): string {
  return `${VOICE_CHANNEL_PREFIX}${transcript}`;
}

export function isVoiceChannelPrompt(text: string): boolean {
  return text.startsWith("VOICE_CHANNEL=audio.");
}
