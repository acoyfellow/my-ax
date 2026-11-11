import type { AgentStatus, ConnState } from "./store.svelte";

export type ActivitySignal = "offline" | "connecting" | "running" | "idle";

export function activitySignalOf(conn: ConnState, status: AgentStatus): ActivitySignal {
  if (conn === "offline") return "offline";
  if (conn === "reconnecting") return "connecting";
  if (status === "thinking" || status === "running") return "running";
  return "idle";
}

export function activitySignalLabel(signal: ActivitySignal): string {
  if (signal === "offline") return "Offline";
  if (signal === "connecting") return "Connecting";
  if (signal === "running") return "Working";
  return "Connected, idle";
}
