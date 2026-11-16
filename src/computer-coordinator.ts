import { COMPUTER_EXEC_TOOL, COMPUTER_INPUT_TOOL, COMPUTER_SCREENSHOT_TOOL, COMPUTER_WAIT_TOOL } from "./computer-screen-tools";
import { CREATE_COMPUTER_TOOL } from "./tools";
import type { AccessIdentity } from "./auth";
import type { Env, ToolContext, ToolDef } from "./types";
import { normalizeComputerId } from "./computer-id";
import { acquireLease, leaseSeconds, leaseView, loadLease, releaseLease, requireLeaseFree, type LeaseDb } from "./domain/ComputerLease/ComputerLease.store";

const COMPUTER_TOOLS: Record<string, ToolDef> = {
  computer_create: CREATE_COMPUTER_TOOL,
  computer_exec: COMPUTER_EXEC_TOOL,
  computer_input: COMPUTER_INPUT_TOOL,
  computer_screenshot: COMPUTER_SCREENSHOT_TOOL,
  computer_wait: COMPUTER_WAIT_TOOL,
};

const LEASE_METHODS = new Set(["computer_lease", "computer_release", "computer_lease_status"]);

export function isComputerMethod(method: string): boolean {
  return Object.hasOwn(COMPUTER_TOOLS, method) || LEASE_METHODS.has(method);
}

function holderOf(args: Record<string, unknown>): string | undefined {
  const holder = typeof args.holder === "string" ? args.holder.trim().slice(0, 200) : "";
  return holder || undefined;
}

export async function runComputerMethod(env: Env, identity: AccessIdentity, method: string, args: Record<string, unknown>): Promise<unknown> {
  const db = env.DB as unknown as LeaseDb;
  const key = { owner: identity.email.toLowerCase(), computerId: normalizeComputerId(typeof args.id === "string" ? args.id : "") };
  const holder = holderOf(args);
  if (method === "computer_lease_status") return leaseView(key.computerId, await loadLease(db, key), Date.now());
  if (method === "computer_lease") {
    if (!holder) throw new Error("holder is required");
    return acquireLease(db, key, holder, leaseSeconds(args.seconds));
  }
  if (method === "computer_release") {
    if (!holder) throw new Error("holder is required");
    return { computerId: key.computerId, released: await releaseLease(db, key, holder) };
  }
  const tool = COMPUTER_TOOLS[method];
  if (!tool) throw new Error(`unknown computer method ${method}`);
  await requireLeaseFree(db, key, holder);
  if (method === "computer_create" && holder && args.leaseSeconds !== undefined) await acquireLease(db, key, holder, leaseSeconds(args.leaseSeconds));
  const context = { env, identity } as unknown as ToolContext;
  return JSON.parse(await tool.execute(args, context) as string);
}
