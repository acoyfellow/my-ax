import { HEARTBEAT_STALE_MS, initialLeader, mirrorIsStale, runsSharedStream, stepLeader, type LeaderEvent, type TabRole } from "./web/tab-leader";
import { recordWebReceipt, webFeatures } from "./web-platform.svelte";

export const tabLeader = $state<{ role: TabRole }>({ role: "unknown" });

let started = false;

export function startTabLeader() {
  if (started || !webFeatures.tabLeader || typeof navigator === "undefined") return;
  started = true;
  let snap = initialLeader();
  const apply = (event: LeaderEvent) => {
    snap = stepLeader(snap, event);
    if (snap.role !== tabLeader.role) {
      tabLeader.role = snap.role;
      recordWebReceipt("tabLeader", `Role: ${snap.role}${runsSharedStream(snap.role) ? " (runs shared stream)" : ""}`);
    }
  };
  if (!("locks" in navigator) || typeof BroadcastChannel === "undefined") {
    apply({ type: "locks-unsupported" });
    return;
  }
  const channel = new BroadcastChannel("my-ax-leader");
  channel.onmessage = (message) => {
    const data = message.data as { type?: string; at?: number } | null;
    if (data?.type === "leader-heartbeat" && typeof data.at === "number") apply({ type: "leader-heartbeat", at: data.at });
  };
  setInterval(() => {
    if (mirrorIsStale(snap, Date.now()) && HEARTBEAT_STALE_MS > 0) apply({ type: "tick", now: Date.now() });
  }, HEARTBEAT_STALE_MS);
  apply({ type: "lock-waiting" });
  navigator.locks
    .request("my-ax-leader", { mode: "exclusive" }, () => {
      apply({ type: "lock-granted" });
      const beat = setInterval(() => channel.postMessage({ type: "leader-heartbeat", at: Date.now() }), 2000);
      return new Promise<void>(() => {
        void beat;
      });
    })
    .catch(() => apply({ type: "lock-released" }));
}
