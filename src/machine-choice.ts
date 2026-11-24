import type { MachineTarget } from "./machine-target";

export type MachineChoice =
  | { ok: true; machine: string; online: string[] }
  | { ok: false; reason: "none_online" | "unknown" | "ambiguous"; message: string; online: string[] };

export function machineChoiceSummary(target: MachineTarget): MachineChoice {
  const online = target.online.map((machine) => machine.name);
  return target.ok ? { ok: true, machine: target.machine.name, online } : { ok: false, reason: target.reason, message: target.message, online };
}

export function codeUsesMachine(code: string): boolean {
  return /\bmachine\s*(\.|\[|\?\.)|\bmachine_[A-Za-z]/.test(code);
}

export function requestedMachine(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
