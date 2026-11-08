import { withTimeout } from "./timeout";

export type MachineStatus = { connected: boolean; machineName?: string | null; tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> };

export const MACHINE_STATUS_TIMEOUT_MS = 5_000;
export const MACHINE_INVOKE_TIMEOUT_MS = 65_000;

type HostNamespace = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };

export function machineHostStub(namespace: HostNamespace, ownerEmail: string) {
  return namespace.get(namespace.idFromName(ownerEmail.toLowerCase()));
}

export const DISCONNECTED_STATUS: MachineStatus = { connected: false, tools: [] };

export async function readMachineStatus(namespace: HostNamespace, ownerEmail: string, timeoutMs = MACHINE_STATUS_TIMEOUT_MS): Promise<MachineStatus> {
  const host = machineHostStub(namespace, ownerEmail);
  const timed = await withTimeout({
    promise: host.fetch("http://internal/status").then((response) => response.json<MachineStatus>()),
    timeoutMs,
    op: "MachineHost.status",
  });
  return timed.ok ? timed.value : DISCONNECTED_STATUS;
}

export async function invokeMachineTool<T>(namespace: HostNamespace, ownerEmail: string, tool: string, args: Record<string, unknown>, timeoutMs = MACHINE_INVOKE_TIMEOUT_MS, opId: string = crypto.randomUUID()): Promise<T | { ok: false; error: string }> {
  const host = machineHostStub(namespace, ownerEmail);
  const headers = new Headers({ "Content-Type": "application/json", "X-Machinectl-User": ownerEmail.toLowerCase(), "X-Machinectl-Op-Id": opId });
  const timed = await withTimeout({
    promise: host.fetch("http://internal/invoke", { method: "POST", headers, body: JSON.stringify({ tool, args }) }).then((response) => response.json<T>()),
    timeoutMs,
    op: "MachineHost.invoke",
  });
  if (timed.ok) return timed.value;
  if (timed.reason === "timeout") return { ok: false, error: `My Machine did not answer within ${timeoutMs}ms for ${tool}. It may still finish on the laptop. Retry with opId ${opId} to get its result instead of running it again.` };
  return { ok: false, error: `My Machine call failed for ${tool}: ${timed.error instanceof Error ? timed.error.message : String(timed.error)}` };
}
