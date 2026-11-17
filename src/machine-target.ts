import { listMachines, normalizeMachineName } from "./machine-pairing";
import { DISCONNECTED_STATUS, readMachineStatus, type MachineStatus } from "./rpc/machine-host-client";

export const DEFAULT_MACHINE_NAME = "default";

export function machineSlot(name: string): string | undefined {
  return name === DEFAULT_MACHINE_NAME ? undefined : name;
}

type HostNamespace = Parameters<typeof readMachineStatus>[0];
export type OnlineMachine = { name: string; title: string; slot: string | undefined; status: MachineStatus };
export type MachineTarget =
  | { ok: true; machine: OnlineMachine; online: OnlineMachine[] }
  | { ok: false; reason: "none_online" | "unknown" | "ambiguous"; online: OnlineMachine[]; message: string };

export async function onlineMachines(db: D1Database, hosts: HostNamespace, ownerEmail: string): Promise<OnlineMachine[]> {
  const approved = (await listMachines(db, ownerEmail)).filter((machine) => machine.state === "approved");
  const statuses = await Promise.all(approved.map((machine) => readMachineStatus(hosts, ownerEmail, undefined, machineSlot(machine.name)).catch(() => DISCONNECTED_STATUS)));
  return approved
    .map((machine, index) => ({ name: machine.name, title: machine.title, slot: machineSlot(machine.name), status: statuses[index] }))
    .filter((machine) => machine.status.connected);
}

export function chooseMachine(online: OnlineMachine[], requested: string | undefined): MachineTarget {
  const names = online.map((machine) => `${machine.name} (${machine.title})`).join(", ");
  if (requested?.trim()) {
    const wanted = normalizeMachineName(requested) ?? requested.trim().toLowerCase();
    const match = online.find((machine) => machine.name === wanted || machine.title.toLowerCase() === requested.trim().toLowerCase());
    if (match) return { ok: true, machine: match, online };
    return { ok: false, reason: "unknown", online, message: online.length ? `No online machine named "${requested}". Online: ${names}.` : `No machine is online. Approve one in Settings > Connections.` };
  }
  if (online.length === 1) return { ok: true, machine: online[0], online };
  if (online.length === 0) return { ok: false, reason: "none_online", online, message: "No machine is online. Add or approve one in Settings > Connections." };
  return { ok: false, reason: "ambiguous", online, message: `More than one machine is online. Pass machine with one of: ${names}.` };
}

export async function resolveMachine(db: D1Database, hosts: HostNamespace, ownerEmail: string, requested: string | undefined): Promise<MachineTarget> {
  return chooseMachine(await onlineMachines(db, hosts, ownerEmail), requested);
}
