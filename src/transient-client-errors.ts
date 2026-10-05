const TRANSIENT_CLIENT_ERROR_PATTERNS: readonly RegExp[] = [
  /^Voice mode: Connection lost\. Reconnecting\.\.\.$/,
  /^Message not sent: reconnecting\./,
];

export function isTransientClientError(message: string): boolean {
  const trimmed = message.trim();
  return TRANSIENT_CLIENT_ERROR_PATTERNS.some((pattern) => pattern.test(trimmed));
}
