const OP_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function callOpId(header: string | null, params: unknown): string {
  const meta = (params as { _meta?: { opId?: unknown } } | undefined)?._meta;
  const candidate = header ?? (typeof meta?.opId === "string" ? meta.opId : null);
  return candidate && OP_ID_PATTERN.test(candidate) ? candidate : crypto.randomUUID();
}
