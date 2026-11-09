export type UsageEvent = {
  name: "session_created" | "message_injected";
  owner: string;
  sessionId: string;
  value?: number;
};

type UsageBinding = {
  writeDataPoint: (point: { blobs: string[]; doubles?: number[]; indexes?: string[] }) => void;
};

export function meterEnabled(env: { USAGE_METER_ENABLED?: string }): boolean {
  return env.USAGE_METER_ENABLED === "1";
}

export function writeUsage(env: { USAGE?: UsageBinding; USAGE_METER_ENABLED?: string }, event: UsageEvent): boolean {
  if (!meterEnabled(env) || !env.USAGE) return false;
  env.USAGE.writeDataPoint({
    blobs: [event.name, event.owner, event.sessionId],
    doubles: [event.value ?? 1],
    indexes: [crypto.randomUUID()],
  });
  return true;
}
