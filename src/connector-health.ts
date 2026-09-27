export type ConnectorHealth =
  | { outcome: "ready"; toolCount: number; checkedAt: string }
  | { outcome: "failed"; error: string; checkedAt: string };

export type ConnectorConnectionState = "not_authorized" | "connected" | "degraded" | "unchecked";

export interface ConnectorStatusView {
  authorized: boolean;
  connection: ConnectorConnectionState;
  toolCount: number | null;
  error: string | null;
  checkedAt: string | null;
}

const MAX_ERROR_LENGTH = 300;

export function summarizeConnectorError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? "unknown error");
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > MAX_ERROR_LENGTH ? `${singleLine.slice(0, MAX_ERROR_LENGTH - 1)}…` : singleLine || "unknown error";
}

export function healthFromDiscovery(toolCount: number, checkedAt: string): ConnectorHealth {
  if (toolCount > 0) return { outcome: "ready", toolCount, checkedAt };
  return { outcome: "failed", error: "connected but the server listed no tools", checkedAt };
}

export function connectorStatusView(authorized: boolean, health: ConnectorHealth | null | undefined): ConnectorStatusView {
  if (!authorized) return { authorized, connection: "not_authorized", toolCount: null, error: null, checkedAt: null };
  if (!health) return { authorized, connection: "unchecked", toolCount: null, error: null, checkedAt: null };
  if (health.outcome === "ready") {
    return { authorized, connection: "connected", toolCount: health.toolCount, error: null, checkedAt: health.checkedAt };
  }
  return { authorized, connection: "degraded", toolCount: 0, error: health.error, checkedAt: health.checkedAt };
}

export function isConnectorHealth(value: unknown): value is ConnectorHealth {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.checkedAt !== "string") return false;
  if (record.outcome === "ready") return typeof record.toolCount === "number";
  if (record.outcome === "failed") return typeof record.error === "string";
  return false;
}
