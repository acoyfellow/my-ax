export type Timed<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "error"; error: unknown };

export async function withTimeout<T>(o: {
  promise: Promise<T>;
  timeoutMs: number;
  op: string;
}): Promise<Timed<T>> {
  const { promise, timeoutMs, op } = o;
  const startedAt = Date.now();
  const TIMED_OUT = Symbol();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: Timed<T>;

  try {
    const winner = await Promise.race([
      promise,
      new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); }),
    ]);
    result = winner === TIMED_OUT ? { ok: false, reason: "timeout" } : { ok: true, value: winner as T };
  } catch (error) {
    result = { ok: false, reason: "error", error };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  console.log(JSON.stringify({ ev: "rpc.call", op, outcome: result.ok ? "ok" : result.reason, waitedMs: Date.now() - startedAt, timeoutMs }));
  return result;
}
