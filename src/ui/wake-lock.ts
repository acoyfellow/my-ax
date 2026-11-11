export type WakeInput = { supported: boolean; enabled: boolean; visible: boolean; busy: boolean; manual: boolean };

export function wantsWakeLock(input: WakeInput): boolean {
  return input.supported && input.enabled && input.visible && (input.busy || input.manual);
}
