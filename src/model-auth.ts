export type GatewayAuthenticationFailure = {
  failed: boolean;
  message: string;
};

function valuesFromError(error: unknown): unknown[] {
  if (!error || typeof error !== "object") return [error];
  const record = error as Record<string, unknown>;
  return [error, record.message, record.statusCode, record.status, record.responseBody, record.cause];
}

export function gatewayAuthenticationFailure(error: unknown): GatewayAuthenticationFailure {
  const values = valuesFromError(error);
  const text = values
    .filter((value) => value !== undefined && value !== null)
    .map((value) => value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value))
    .join(" ")
    .trim();
  const normalized = text.toLowerCase();
  const failed = values.includes(401)
    || /(^|[\s"':])401([\s,"'}]|$)/.test(normalized)
    || /(^|[\s"':])(unauthorized|unauthenticated)([\s,."'}]|$)/.test(normalized);
  return {
    failed,
    message: failed ? "Model access expired. This conversation switched to the fallback model. Retry your message while the deployment owner refreshes gateway access." : text,
  };
}
