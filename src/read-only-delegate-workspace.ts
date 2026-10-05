import type { WorkspaceLike } from "@cloudflare/think/tools/workspace";
import type { FileInfo } from "@cloudflare/shell";
import type { AccessIdentity } from "./auth";

export class DelegateCapabilityError extends Error {
  readonly code: "delegate_identity_missing" | "delegate_read_only";
  constructor(code: DelegateCapabilityError["code"], message: string) {
    super(message);
    this.name = "DelegateCapabilityError";
    this.code = code;
  }
}

export function requireDelegateIdentity(identity: AccessIdentity | undefined): AccessIdentity {
  if (!identity?.email) {
    throw new DelegateCapabilityError("delegate_identity_missing", "Delegate has no owner identity, so it cannot read the owner workspace.");
  }
  return identity;
}

function readOnlyRefusal(operation: string): never {
  throw new DelegateCapabilityError("delegate_read_only", `Delegate workspace is read-only; ${operation} is not permitted.`);
}

export class ReadOnlyDelegateWorkspace implements WorkspaceLike {
  constructor(
    private readonly identity: () => AccessIdentity | undefined,
    private readonly openOwnerWorkspace: (identity: AccessIdentity) => WorkspaceLike,
  ) {}

  private owner(): WorkspaceLike {
    return this.openOwnerWorkspace(requireDelegateIdentity(this.identity()));
  }

  async readFile(path: string): Promise<string | null> {
    return await this.owner().readFile(path);
  }

  async readFileBytes(path: string): Promise<Uint8Array | null> {
    return await this.owner().readFileBytes(path);
  }

  async readDir(dir: string, opts?: { limit?: number; offset?: number }): Promise<FileInfo[]> {
    return await this.owner().readDir(dir, opts);
  }

  async glob(pattern: string): Promise<FileInfo[]> {
    return await this.owner().glob(pattern);
  }

  async stat(path: string): Promise<FileInfo | null> {
    return await this.owner().stat(path);
  }

  async writeFile(_path: string, _content: string): Promise<void> {
    readOnlyRefusal("writeFile");
  }

  async mkdir(_path: string, _opts?: { recursive?: boolean }): Promise<void> {
    readOnlyRefusal("mkdir");
  }

  async rm(_path: string, _opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    readOnlyRefusal("rm");
  }
}

export interface DelegateRunInput {
  task: string;
  identity?: AccessIdentity;
}

export function splitDelegateRunInput(input: unknown): { task: string; identity: AccessIdentity } {
  const candidate = (input ?? {}) as Partial<DelegateRunInput>;
  const identity = requireDelegateIdentity(candidate.identity);
  return { task: typeof candidate.task === "string" ? candidate.task : "", identity };
}
