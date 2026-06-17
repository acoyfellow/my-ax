// routes/mcps.ts — Bring-Your-Own MCP server CRUD + probe.
//
//   POST   /api/mcps/probe   probe a URL, return discovered metadata
//   GET    /api/mcps         list this user's BYO MCPs
//   POST   /api/mcps         add an MCP (server re-probes the URL)
//   DELETE /api/mcps/:id     remove an MCP + clear its tokens

import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { oauthStoreFor } from "../oauth-store-facade";
import { probeMcp } from "../mcp-probe";
import type { ApiResponse } from "../types";

export function registerMcpsCrudRoutes(app: Hono<AppEnv>) {
  // POST /api/mcps/probe — read-only probe. Figures out OAuth metadata
  // and verifies the URL speaks MCP. Returns a fully-formed Connector
  // record OR an error explaining what's missing. Does NOT add the MCP
  // to the user's registry — the caller does that via POST /api/mcps.
  app.post("/api/mcps/probe", async (c) => {
    let body: { url?: string };
    try {
      body = await c.req.json<{ url?: string }>();
    } catch {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: { message: "Body must be JSON: {url: string}", code: "BAD_REQUEST" },
          next_actions: [],
        },
        400,
      );
    }
    if (!body.url || typeof body.url !== "string") {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: { message: "Field `url` is required", code: "BAD_REQUEST" },
          next_actions: [],
        },
        400,
      );
    }
    const result = await probeMcp(body.url);
    if (!result.ok) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: { message: result.detail, code: result.error.toUpperCase() },
          next_actions: [],
        },
        400,
      );
    }
    return c.json<ApiResponse>({
      ok: true,
      command: c.req.path,
      result: {
        connector: result.connector,
        dcrAvailable: result.dcrAvailable,
        mcpConfirmed: result.mcpConfirmed,
        serverName: result.serverName ?? null,
      },
      next_actions: [
        {
          command: `POST /api/mcps`,
          description: "Persist this MCP for the current user",
        },
      ],
    });
  });

  // GET /api/mcps — list this user's BYO MCPs.
  app.get("/api/mcps", async (c) => {
    try {
      const store = oauthStoreFor(c);
      const mcps = await store.listUserMcps(c.get("identity").email);
      return c.json<ApiResponse>({
        ok: true,
        command: c.req.path,
        result: { mcps },
        next_actions: [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json<ApiResponse>({
        ok: false,
        command: c.req.path,
        error: { code: "USER_MCPS_UNAVAILABLE", message: `Custom MCP list unavailable: ${message}` },
        next_actions: [{ command: "GET /api/mcps", description: "Retry custom MCP loading" }],
      }, 503);
    }
  });

  // POST /api/mcps — add an MCP. Body must include a `url`; the server
  // re-probes (rather than trusting a Connector record from the client)
  // to keep auth metadata fresh + tamper-proof.
  app.post("/api/mcps", async (c) => {
    let body: { url?: string };
    try {
      body = await c.req.json<{ url?: string }>();
    } catch {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: { message: "Body must be JSON: {url: string}", code: "BAD_REQUEST" },
          next_actions: [],
        },
        400,
      );
    }
    if (!body.url) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: { message: "Field `url` is required", code: "BAD_REQUEST" },
          next_actions: [],
        },
        400,
      );
    }
    const probe = await probeMcp(body.url);
    if (!probe.ok) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: { message: probe.detail, code: probe.error.toUpperCase() },
          next_actions: [],
        },
        400,
      );
    }
    const store = oauthStoreFor(c);
    try {
      const persisted = await store.addUserMcp(
        c.get("identity").email,
        probe.connector,
      );
      return c.json<ApiResponse>({
        ok: true,
        command: c.req.path,
        result: { connector: persisted },
        next_actions: [
          {
            command: `GET /api/connectors/${persisted.id}/authorize`,
            description: "Authorize the new MCP via OAuth",
          },
        ],
      });
    } catch (err) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: { message: String((err as Error).message), code: "CONFLICT" },
          next_actions: [],
        },
        409,
      );
    }
  });

  // DELETE /api/mcps/:id — remove a BYO MCP + any tokens.
  app.delete("/api/mcps/:id", async (c) => {
    const id = c.req.param("id");
    const store = oauthStoreFor(c);
    try {
      await store.removeUserMcp(c.get("identity").email, id);
      return c.json<ApiResponse>({
        ok: true,
        command: c.req.path,
        result: { id, removed: true },
        next_actions: [],
      });
    } catch (err) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: { message: String((err as Error).message), code: "NOT_FOUND" },
          next_actions: [],
        },
        404,
      );
    }
  });
}
