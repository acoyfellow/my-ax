export const DESK_APP_PREFERENCE_KEY = "desk.app";
export const DESK_STATE_MAX_BYTES = 128 * 1024;

const ARTIFACT_ID_RE = /^[a-zA-Z0-9._:-]{1,120}$/;

export interface DeskApp {
  artifactId: string | null;
  state: unknown;
  updatedAt: string;
  updatedBy: string | null;
}

export function emptyDeskApp(now = new Date().toISOString()): DeskApp {
  return { artifactId: null, state: null, updatedAt: now, updatedBy: null };
}

export function stateByteLength(state: unknown): number {
  if (state === null || state === undefined) return 0;
  return new TextEncoder().encode(JSON.stringify(state)).length;
}

export function parseDeskApp(raw: unknown): DeskApp {
  if (!raw || typeof raw !== "object") return emptyDeskApp();
  const row = raw as Record<string, unknown>;
  const artifactId = typeof row.artifactId === "string" && ARTIFACT_ID_RE.test(row.artifactId) ? row.artifactId : null;
  const updatedBy = typeof row.updatedBy === "string" ? row.updatedBy.slice(0, 120) : null;
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString();
  const state = row.state === undefined ? null : row.state;
  return { artifactId, state, updatedAt, updatedBy };
}

export function applyDeskAppWrite(
  current: DeskApp,
  incoming: unknown,
  options: { now?: string; author?: string | null } = {},
): DeskApp {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("desk write must be an object");
  const row = incoming as Record<string, unknown>;
  const touchesArtifact = Object.hasOwn(row, "artifactId");
  const touchesState = Object.hasOwn(row, "state");
  if (!touchesArtifact && !touchesState) throw new Error("desk write requires state or artifactId");
  const now = options.now ?? new Date().toISOString();
  let artifactId = current.artifactId;
  if (touchesArtifact) {
    const value = row.artifactId;
    if (value === null) artifactId = null;
    else if (typeof value === "string" && ARTIFACT_ID_RE.test(value)) artifactId = value;
    else throw new Error("artifactId must be a valid id or null");
  }
  let state = current.state;
  if (touchesState) {
    const size = stateByteLength(row.state);
    if (size > DESK_STATE_MAX_BYTES) throw new Error(`desk state is ${size} bytes; the limit is ${DESK_STATE_MAX_BYTES}`);
    state = row.state === undefined ? null : row.state;
  }
  return {
    artifactId,
    state,
    updatedAt: now,
    updatedBy: options.author ? options.author.slice(0, 120) : current.updatedBy,
  };
}
