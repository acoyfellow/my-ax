export function shouldResumeVoiceCall(input: {
  enabled: boolean;
  status: string;
  connected: boolean;
}): boolean {
  return input.enabled && input.connected && input.status === "idle";
}
