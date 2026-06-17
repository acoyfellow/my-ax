// sandbox.ts — shared constants for per-user Sandbox handling.
//
// Product file/process work goes through workspace.ts (which owns the
// restore/snapshot dance). This module only exports the per-user home
// path constant; everything else is in workspace.ts.

export const USER_HOME = "/home/user";
