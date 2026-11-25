import { withTimeout } from "./timeout";

export type MachineStatus = { connected: boolean; machineName?: string | null; tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> };

export const MACHINE_STATUS_TIMEOUT_MS = 5_000;
export const MACHINE_INVOKE_TIMEOUT_MS = 65_000;

type HostNamespace = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };

export function machineHostStub(namespace: HostNamespace, ownerEmail: string, machineName?: string) {
  const owner = ownerEmail.toLowerCase();
  return namespace.get(namespace.idFromName(machineName ? `${owner}#${machineName}` : owner));
}

export const DISCONNECTED_STATUS: MachineStatus = { connected: false, tools: [] };

export async function readMachineStatus(namespace: HostNamespace, ownerEmail: string, timeoutMs = MACHINE_STATUS_TIMEOUT_MS, machineName?: string): Promise<MachineStatus> {
  const host = machineHostStub(namespace, ownerEmail, machineName);
  const timed = await withTimeout({
    promise: host.fetch("http://internal/status").then((response) => response.json<MachineStatus>()),
    timeoutMs,
    op: "MachineHost.status",
  });
  return timed.ok ? timed.value : DISCONNECTED_STATUS;
}

export async function cancelMachineTool(namespace: HostNamespace, ownerEmail: string, opId: string, machineName?: string): Promise<boolean> {
  const host = machineHostStub(namespace, ownerEmail, machineName);
  const res = await host.fetch("http://internal/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opId }),
  }).catch(() => null);
  if (!res?.ok) return false;
  const body = (await res.json<{ cancelled?: boolean }>().catch(() => ({}))) as { cancelled?: boolean };
  return body.cancelled === true;
}

export async function invokeMachineTool<T>(namespace: HostNamespace, ownerEmail: string, tool: string, args: Record<string, unknown>, timeoutMs = MACHINE_INVOKE_TIMEOUT_MS, opId: string = crypto.randomUUID(), machineName?: string, signal?: AbortSignal): Promise<T | { ok: false; error: string }> {
  if (signal?.aborted) return { ok: false, error: `Killed by owner (${tool}). Do not automatically retry unless the owner asks.` };
  const host = machineHostStub(namespace, ownerEmail, machineName);
  const headers = new Headers({ "Content-Type": "application/json", "X-Machinectl-User": ownerEmail.toLowerCase(), "X-Machinectl-Op-Id": opId });
  const onAbort = () => { void cancelMachineTool(namespace, ownerEmail, opId, machineName); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const timed = await withTimeout({
      promise: host.fetch("http://internal/invoke", { method: "POST", headers, body: JSON.stringify({ tool, args }) }).then((response) => response.json<T>()),
      timeoutMs,
      op: "MachineHost.invoke",
    });
    if (signal?.aborted) return { ok: false, error: `Killed by owner (${tool}). Cancel sent to laptop; verify side effects before retrying.` };
    if (timed.ok) return timed.value;
    if (timed.reason === "timeout") return { ok: false, error: `My Machine did not answer within ${timeoutMs}ms for ${tool}. It may still finish on the laptop. Retry with opId ${opId} to get its result instead of running it again.` };
    return { ok: false, error: `My Machine call failed for ${tool}: ${timed.error instanceof Error ? timed.error.message : String(timed.error)}` };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
