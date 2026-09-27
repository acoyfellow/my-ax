export interface ConnectorStatusPayload {
  authorized?: boolean;
  connection?: string;
  tool_count?: number | null;
  error?: string | null;
  authorize_url?: string | null;
}

export type ConnectorRowDisplay =
  | { kind: "authorize"; href: string }
  | { kind: "connected"; toolCount: string; title: string }
  | { kind: "degraded"; href: string; title: string }
  | { kind: "pending"; title: string };

export function connectorRowDisplay(id: string, status: ConnectorStatusPayload | undefined): ConnectorRowDisplay {
  const authorizeHref = status?.authorize_url || `/api/connectors/${encodeURIComponent(id)}/authorize`;
  if (!status?.authorized) return { kind: "authorize", href: authorizeHref };
  if (status.connection === "degraded") {
    return { kind: "degraded", href: authorizeHref, title: `Degraded: ${status.error || "the server did not respond"}. Reconnect to retry.` };
  }
  if (status.connection === "connected") {
    const count = typeof status.tool_count === "number" ? String(status.tool_count) : "—";
    return { kind: "connected", toolCount: count, title: `Connected · ${count} tools` };
  }
  return { kind: "pending", title: "Signed in. Tools load when a chat starts." };
}
