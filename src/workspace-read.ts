type WorkspaceCommandRunner = {
  exec: (command: string, options: { cwd: string; timeout: number }) => Promise<{ exitCode?: number; stdout?: string }>;
};

const WORKSPACE_ROOT = "/home/user";
const BOUNDED_READ_SCRIPT = `set -eu
exec 3< "$1"
resolved=$(realpath -e -- /proc/self/fd/3)
case "$resolved" in
  ${WORKSPACE_ROOT}/*) ;;
  *) exit 1 ;;
esac
dd if=/proc/self/fd/3 bs=1 count="$2" status=none`;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export async function readBoundedWorkspaceFile(sandbox: WorkspaceCommandRunner, path: string, maxBytes: number): Promise<string | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be a positive safe integer");
  const result = await sandbox.exec(`sh -c ${shellQuote(BOUNDED_READ_SCRIPT)} workspace-read ${shellQuote(path)} ${maxBytes}`, {
    cwd: WORKSPACE_ROOT,
    timeout: 30_000,
  });
  return result.exitCode === 0 ? result.stdout ?? "" : null;
}
