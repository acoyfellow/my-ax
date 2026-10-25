export type HubStub = {
  publish(change: WorkspaceChange): Promise<unknown>;
  since(since: number, subscription?: Subscription): Promise<WorkspaceEvent[]>;
  fetch(request: Request): Promise<Response>;
};

export type WorkspaceChange =
  | { kind: "workspace.status"; workspaceId: string; status: string }
  | { kind: "workspace.message"; workspaceId: string; from: string }
  | { kind: "workspace.file"; workspaceId: string; path: string }
  | { kind: "workspace.lost"; workspaceId: string; reason: string }
  | { kind: "job.run"; jobId: string; ok: boolean }
  | { kind: "job.status"; jobId: string; status: string };

export type WorkspaceEvent = WorkspaceChange & { seq: number; at: number };

export type Subscription = { workspaces?: readonly string[]; kinds?: readonly string[] };

export function changeTarget(change: WorkspaceChange): string {
  return "workspaceId" in change ? change.workspaceId : `job:${change.jobId}`;
}

export function matches(subscription: Subscription, event: WorkspaceChange): boolean {
  if (subscription.kinds?.length && !subscription.kinds.includes(event.kind)) return false;
  if (subscription.workspaces?.length && !subscription.workspaces.includes(changeTarget(event))) return false;
  return true;
}

export function eventsSince(recent: readonly WorkspaceEvent[], since: number, subscription: Subscription): WorkspaceEvent[] {
  return recent.filter((event) => event.seq > since && matches(subscription, event));
}

type HubEnv = { WORKSPACE_HUB?: DurableObjectNamespace };

export function workspaceHub(env: unknown, ownerEmail: string): HubStub | null {
  const namespace = (env as HubEnv).WORKSPACE_HUB;
  if (!namespace) return null;
  return namespace.get(namespace.idFromName(ownerEmail.toLowerCase())) as unknown as HubStub;
}

export async function publishWorkspaceChange(env: unknown, ownerEmail: string, change: WorkspaceChange): Promise<void> {
  const hub = workspaceHub(env, ownerEmail);
  if (!hub) return;
  await hub.publish(change).catch((error: unknown) => console.error("workspace_hub_publish_failed", { kind: change.kind, err: String(error) }));
}
