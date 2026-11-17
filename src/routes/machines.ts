import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { createPairCode, listMachines, machineForCredential, normalizeMachineName, redeemPairCode, revokeMachine } from "../machine-pairing";
import { invokeMachineTool, machineHostStub, readMachineStatus } from "../rpc/machine-host-client";

export const MACHINE_PUBLIC_PATHS = ["/machines/pair", "/machines/connect"] as const;

function bearer(header: string | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match ? match[1].trim() : "";
}

export function registerMachinePublicRoutes(app: Hono<AppEnv>) {
  app.post("/machines/pair", async (c) => {
    const body = await c.req.json<{ code?: string; name?: string }>().catch(() => null);
    if (!body?.code || !body?.name) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "code and name are required" } }, 400);
    const outcome = await redeemPairCode(c.env.DB, body.code, body.name);
    if (!outcome.ok) return c.json({ ok: false, error: outcome }, outcome.code === "NAME_TAKEN" ? 409 : 400);
    return c.json({ ok: true, name: outcome.name, credential: outcome.credential }, 201);
  });

  app.get("/machines/connect", async (c) => {
    const machine = await machineForCredential(c.env.DB, bearer(c.req.header("Authorization")));
    if (!machine) return c.json({ ok: false, error: { code: "BAD_CREDENTIAL", message: "Unknown or revoked machine credential. Pair the machine again." } }, 401);
    const headers = new Headers(c.req.raw.headers);
    headers.delete("Authorization");
    headers.set("X-Machinectl-User", machine.ownerEmail);
    return machineHostStub(c.env.MACHINE_HOST, machine.ownerEmail, machine.name).fetch(new Request("http://internal/connect", { method: "GET", headers }));
  });
}

export function registerMachineOwnerRoutes(app: Hono<AppEnv>) {
  app.post("/api/machines/pair-codes", async (c) => {
    const { code, expiresAt } = await createPairCode(c.env.DB, c.get("identity").email);
    const origin = new URL(c.req.url).origin;
    return c.json({ ok: true, code, expiresAt, command: `npx machinectl pair ${code} --url ${origin}` }, 201);
  });

  app.get("/api/machines", async (c) => {
    const email = c.get("identity").email;
    const machines = await listMachines(c.env.DB, email);
    const statuses = await Promise.all(machines.map((machine) => readMachineStatus(c.env.MACHINE_HOST, email, undefined, machine.name)));
    return c.json({
      ok: true,
      machines: machines.map((machine, index) => ({
        name: machine.name,
        createdAt: machine.createdAt,
        connected: statuses[index].connected,
        tools: (statuses[index].tools ?? []).map((tool) => tool.name),
      })),
    });
  });

  app.post("/api/machines/:name/call", async (c) => {
    const name = normalizeMachineName(c.req.param("name"));
    const email = c.get("identity").email;
    if (!name || !(await listMachines(c.env.DB, email)).some((machine) => machine.name === name)) {
      return c.json({ ok: false, error: { code: "UNKNOWN_MACHINE", message: "No paired machine with that name." } }, 404);
    }
    const body = await c.req.json<{ tool?: string; arguments?: Record<string, unknown> }>().catch(() => null);
    if (!body?.tool) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "tool is required" } }, 400);
    return c.json(await invokeMachineTool(c.env.MACHINE_HOST, email, body.tool, body.arguments ?? {}, undefined, undefined, name));
  });

  app.delete("/api/machines/:name", async (c) => {
    const name = normalizeMachineName(c.req.param("name"));
    const email = c.get("identity").email;
    if (!name || !(await revokeMachine(c.env.DB, email, name))) {
      return c.json({ ok: false, error: { code: "UNKNOWN_MACHINE", message: "No paired machine with that name." } }, 404);
    }
    await machineHostStub(c.env.MACHINE_HOST, email, name).fetch("http://internal/disconnect", { method: "POST" });
    return c.json({ ok: true, revoked: name });
  });
}
