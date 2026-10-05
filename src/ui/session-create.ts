export type CreatedSession = { sessionId: string; name?: string };

export class SessionCreateHttpError extends Error {
  constructor(readonly status: number) {
    super("session create HTTP " + status);
  }
}

export class SessionCreateNetworkError extends Error {
  constructor() {
    super("network unavailable");
  }
}

type RetryOptions = { attempts?: number; wait?: (ms: number) => Promise<void> };

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

export async function postSessionWithRetry(fetchImpl: typeof fetch, options: RetryOptions = {}): Promise<CreatedSession> {
  const attempts = options.attempts ?? 3;
  const wait = options.wait ?? defaultWait;
  let lastError: Error = new SessionCreateNetworkError();
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await wait(500 * 2 ** (attempt - 1));
    let response: Response;
    try {
      response = await fetchImpl("/api/sessions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {
      lastError = new SessionCreateNetworkError();
      continue;
    }
    if (response.ok) return ((await response.json()) as { result: CreatedSession }).result;
    lastError = new SessionCreateHttpError(response.status);
    if (!isRetryableStatus(response.status)) throw lastError;
  }
  throw lastError;
}

export function sessionCreateErrorMessage(err: unknown): string {
  if (err instanceof SessionCreateNetworkError) {
    return "Could not create session: the network connection dropped. Your draft is still in the composer — try sending again.";
  }
  if (err instanceof SessionCreateHttpError) {
    return `Could not create session (server returned ${err.status}). Your draft is still in the composer — try sending again.`;
  }
  return "Could not create session. Your draft is still in the composer — try sending again.";
}
