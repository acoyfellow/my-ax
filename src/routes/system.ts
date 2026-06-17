// routes/system.ts — periodic durability check.
//
//   POST /api/system/workspace-restore-probe
//     writes a unique nonce to /home/user/.my-ax/restore-probe.txt,
//     forces snapshot+destroy+restore, reads it back, returns ok iff
//     the byte-compare matched. The proof/plan.ts smoke calls this on
//     every CI run so we catch silent R2/snapshot regressions before
//     a user does.
//
// Not in routes/files.ts because that's user-facing read-only API;
// this is an operator check that takes ~20s and recycles the sandbox.

import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { seedUserWorkspaceFile } from "../workspace";
import type { ApiResponse } from "../types";

export function registerSystemRoutes(app: Hono<AppEnv>) {
  app.post("/api/system/workspace-restore-probe", async (c) => {
    const identity = c.get("identity");
    const nonce = crypto.randomUUID();
    const started = Date.now();
    try {
      const result = await seedUserWorkspaceFile(c.env, identity, {
        path: "/home/user/.my-ax/restore-probe.txt",
        content: nonce,
      });
      return c.json<ApiResponse>({
        ok: result.restoreMatches,
        command: c.req.path,
        result: {
          path: result.path,
          bytesWritten: result.bytesWritten,
          snapshotId: result.snapshot.id,
          restoreMatches: result.restoreMatches,
          durationMs: Date.now() - started,
        },
        error: result.restoreMatches
          ? undefined
          : { code: "WORKSPACE_RESTORE_MISMATCH", message: "Restored probe content did not match written nonce" },
        next_actions: [],
      }, result.restoreMatches ? 200 : 500);
    } catch (err) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: {
            code: "WORKSPACE_RESTORE_PROBE_FAILED",
            message: err instanceof Error ? err.message : String(err),
          },
          result: { durationMs: Date.now() - started },
          next_actions: [],
        },
        500,
      );
    }
  });
}
