export const WORKSPACE_HOME = "/home/user";

export function assertSeedablePath(path: string): asserts path is string {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("path must be a non-empty string");
  }
  if (path !== WORKSPACE_HOME && !path.startsWith(`${WORKSPACE_HOME}/`)) {
    throw new Error(`path must be inside ${WORKSPACE_HOME} (ephemeral paths such as /bugs are not durable)`);
  }
  if (path.includes("/../") || path.endsWith("/..") || path.includes("\0")) {
    throw new Error("path must not contain traversal segments");
  }
}
