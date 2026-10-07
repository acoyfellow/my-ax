export type TimedMessage = {
  role: string;
  timestamp?: number;
  endedAt?: number;
  streaming?: boolean;
  durationMs?: number;
};

export function formatTurnDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export function annotateTurnDurations<T extends TimedMessage>(messages: T[]): T[] {
  let turnStart: number | undefined;
  let lastAgentIndex = -1;
  let turnEnd: number | undefined;
  const settle = () => {
    if (lastAgentIndex < 0 || turnStart === undefined || turnEnd === undefined) return;
    const agent = messages[lastAgentIndex]!;
    if (agent.streaming) return;
    if (turnEnd >= turnStart) agent.durationMs = turnEnd - turnStart;
  };
  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      settle();
      turnStart = message.timestamp;
      lastAgentIndex = -1;
      turnEnd = undefined;
      continue;
    }
    if (message.role === "assistant") {
      delete message.durationMs;
      lastAgentIndex = index;
      const end = message.endedAt ?? message.timestamp;
      if (end !== undefined) turnEnd = Math.max(turnEnd ?? end, end);
    }
  }
  settle();
  return messages;
}
