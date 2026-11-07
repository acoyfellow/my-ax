export type DeadlineSignal = { signal: AbortSignal; clear: () => void };

export function deadlineSignal(timeoutMs: number, parent?: AbortSignal): DeadlineSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`timed out after ${timeoutMs}ms`, "TimeoutError")), timeoutMs);
  const forward = () => controller.abort(parent?.reason);
  if (parent?.aborted) forward();
  else parent?.addEventListener("abort", forward, { once: true });
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", forward);
    },
  };
}

export async function settledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  try {
    return await Promise.race([work.then(() => true, () => true), elapsed]);
  } finally {
    clearTimeout(timer);
  }
}
