type WorkspaceCommandRunner = {
  exec: (command: string, options: { cwd: string; timeout: number }) => Promise<{ exitCode?: number; stdout?: string }>;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export async function readBoundedWorkspaceFile(sandbox: WorkspaceCommandRunner, path: string, maxBytes: number): Promise<string | null> {
  const result = await sandbox.exec(`dd if=${shellQuote(path)} bs=1 count=${maxBytes} status=none`, {
    cwd: "/home/user",
    timeout: 30_000,
  });
  return result.exitCode === 0 ? result.stdout ?? "" : null;
}
