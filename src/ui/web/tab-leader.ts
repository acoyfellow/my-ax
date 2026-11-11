export type TabRole = "unknown" | "leader" | "mirror" | "solo";

export type LeaderEvent =
  | { type: "locks-unsupported" }
  | { type: "lock-granted" }
  | { type: "lock-waiting" }
  | { type: "lock-released" }
  | { type: "leader-heartbeat"; at: number }
  | { type: "tick"; now: number };

export type LeaderSnapshot = { role: TabRole; lastHeartbeat: number | null };

export const HEARTBEAT_STALE_MS = 5000;

export function initialLeader(): LeaderSnapshot {
  return { role: "unknown", lastHeartbeat: null };
}

export function stepLeader(snapshot: LeaderSnapshot, event: LeaderEvent): LeaderSnapshot {
  if (event.type === "locks-unsupported") {
    return { role: "solo", lastHeartbeat: snapshot.lastHeartbeat };
  }
  if (event.type === "lock-granted") {
    return { role: "leader", lastHeartbeat: null };
  }
  if (event.type === "lock-waiting") {
    return { role: "mirror", lastHeartbeat: snapshot.lastHeartbeat };
  }
  if (event.type === "lock-released") {
    return { role: "unknown", lastHeartbeat: null };
  }
  if (event.type === "leader-heartbeat") {
    if (snapshot.role === "mirror" && (snapshot.lastHeartbeat === null || event.at > snapshot.lastHeartbeat)) {
      return { role: "mirror", lastHeartbeat: event.at };
    }
    return snapshot;
  }
  if (event.type === "tick") {
    return snapshot;
  }
  return snapshot;
}

export function runsSharedStream(role: TabRole): boolean {
  return role === "leader" || role === "solo";
}

export function mirrorIsStale(snapshot: LeaderSnapshot, now: number): boolean {
  if (snapshot.role !== "mirror") {
    return false;
  }
  if (snapshot.lastHeartbeat === null) {
    return true;
  }
  return now - snapshot.lastHeartbeat > HEARTBEAT_STALE_MS;
}
