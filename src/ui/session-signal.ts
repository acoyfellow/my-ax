export type SessionSignal = "idle" | "running" | "error";

export function sessionSignalOf(status: string | null | undefined): SessionSignal {
  const normalized = (status || "active").toLowerCase();
  if (normalized === "running" || normalized === "thinking") return "running";
  if (normalized === "error" || normalized === "failed") return "error";
  return "idle";
}

export function sessionSignalLabel(signal: SessionSignal): string {
  if (signal === "running") return "Response in progress";
  if (signal === "error") return "Last turn failed";
  return "Idle";
}
