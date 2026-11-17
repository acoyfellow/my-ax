import type { Context, Hono } from "hono";
import type { AppEnv } from "../app-env";
import { admitMachine, approveMachine, forgetMachine, listMachines, logOutAllMachines, logOutMachine, normalizeMachineName, renameMachine } from "../machine-pairing";
import { invokeMachineTool, machineHostStub, readMachineStatus } from "../rpc/machine-host-client";
import { DEFAULT_MACHINE_NAME, machineSlot } from "../machine-target";
import { announceMachinesChanged } from "../machines-live";

export const MACHINE_STATE_HEADER = "X-Machine-State";

function ownerEmail(c: Context<AppEnv>): string {
  return c.get("identity").email.toLowerCase();
}

function unknownMachine(c: Context<AppEnv>) {
  return c.json({ ok: false, error: { code: "UNKNOWN_MACHINE", message: "No machine with that name." } }, 404);
}

async function disconnect(c: Context<AppEnv>, email: string, name: string) {
  await machineHostStub(c.env.MACHINE_HOST, email, machineSlot(name)).fetch("http://internal/disconnect", { method: "POST" });
}

export async function connectMachine(c: Context<AppEnv>): Promise<Response> {
  const name = normalizeMachineName(c.req.query("machine") ?? DEFAULT_MACHINE_NAME);
  if (!name) return c.json({ ok: false, error: { code: "BAD_NAME", message: "Machine name must be 1-63 lowercase letters, digits or dashes." } }, 400);
  const email = ownerEmail(c);
  const admission = await admitMachine(c.env.DB, email, name);
  if (admission.state === "pending") c.executionCtx.waitUntil(announceMachinesChanged(c.env, email));
  if (!admission.admitted) {
    const message = admission.state === "pending"
      ? `Machine ${name} is waiting for approval. Approve it in my-ax under Settings > Connections.`
      : `Machine ${name} was logged out. Allow it again in my-ax under Settings > Connections.`;
    return c.json({ ok: false, error: { code: admission.state === "pending" ? "MACHINE_PENDING" : "MACHINE_LOGGED_OUT", message } }, 403, { [MACHINE_STATE_HEADER]: admission.state });
  }
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Machinectl-User", email);
  return machineHostStub(c.env.MACHINE_HOST, email, machineSlot(name)).fetch(new Request("http://internal/connect", { method: "GET", headers }));
}

export function registerMachineOwnerRoutes(app: Hono<AppEnv>) {
  app.get("/api/machines", async (c) => {
    const email = ownerEmail(c);
    const machines = await listMachines(c.env.DB, email);
    const statuses = await Promise.all(machines.map((machine) => readMachineStatus(c.env.MACHINE_HOST, email, undefined, machineSlot(machine.name))));
    return c.json({
      ok: true,
      machines: machines.map((machine, index) => {
        const live = machine.state === "approved" && statuses[index].connected;
        return {
          name: machine.name,
          title: machine.title,
          state: machine.state,
          hostName: live ? statuses[index].machineName ?? null : null,
          createdAt: machine.createdAt,
          lastSeenAt: machine.lastSeenAt,
          connected: live,
          tools: live ? (statuses[index].tools ?? []).map((tool) => tool.name) : [],
        };
      }),
    });
  });

  app.post("/api/machines/logout-all", async (c) => {
    const email = ownerEmail(c);
    const names = await logOutAllMachines(c.env.DB, email);
    await Promise.all(names.map((name) => disconnect(c, email, name)));
    return c.json({ ok: true, loggedOut: names });
  });

  app.post("/api/machines/:name/approve", async (c) => {
    const name = normalizeMachineName(c.req.param("name"));
    if (!name || !(await approveMachine(c.env.DB, ownerEmail(c), name))) return unknownMachine(c);
    c.executionCtx.waitUntil(announceMachinesChanged(c.env, ownerEmail(c)));
    return c.json({ ok: true, approved: name });
  });

  app.post("/api/machines/:name/logout", async (c) => {
    const name = normalizeMachineName(c.req.param("name"));
    const email = ownerEmail(c);
    if (!name || !(await listMachines(c.env.DB, email)).some((machine) => machine.name === name)) return unknownMachine(c);
    await logOutMachine(c.env.DB, email, name);
    await disconnect(c, email, name);
    return c.json({ ok: true, loggedOut: name });
  });

  app.post("/api/machines/:name/call", async (c) => {
    const name = normalizeMachineName(c.req.param("name"));
    const email = ownerEmail(c);
    const machine = name ? (await listMachines(c.env.DB, email)).find((item) => item.name === name) : undefined;
    if (!machine) return unknownMachine(c);
    if (machine.state !== "approved") return c.json({ ok: false, error: { code: "MACHINE_NOT_APPROVED", message: `Machine ${machine.name} is ${machine.state.replace("_", " ")}.` } }, 403);
    const body = await c.req.json<{ tool?: string; arguments?: Record<string, unknown> }>().catch(() => null);
    if (!body?.tool) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "tool is required" } }, 400);
    return c.json(await invokeMachineTool(c.env.MACHINE_HOST, email, body.tool, body.arguments ?? {}, undefined, undefined, machineSlot(machine.name)));
  });

  app.patch("/api/machines/:name", async (c) => {
    const name = normalizeMachineName(c.req.param("name"));
    const body = await c.req.json<{ title?: unknown }>().catch(() => null);
    const title = name ? await renameMachine(c.env.DB, ownerEmail(c), name, body?.title) : null;
    if (!title) return c.json({ ok: false, error: { code: "BAD_RENAME", message: "Give a name of 1-80 characters for a known machine." } }, 400);
    return c.json({ ok: true, name, title });
  });

  app.delete("/api/machines/:name", async (c) => {
    const name = normalizeMachineName(c.req.param("name"));
    if (!name || !(await forgetMachine(c.env.DB, ownerEmail(c), name))) {
      return c.json({ ok: false, error: { code: "LOG_OUT_FIRST", message: "Log the machine out before removing it from the list." } }, 409);
    }
    return c.json({ ok: true, removed: name });
  });
}
