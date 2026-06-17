export type McpCodeModePolicy = {
  version: 1;
  enabled: true;
  connectors: Record<string, { expose: string[] }>;
};

export type McpCatalogTool = {
  name: string;
  serverId: string;
  description?: string;
  inputSchema?: unknown;
};

export type SelectedMcpProvider = {
  connector: string;
  providerName: string;
  tools: Array<McpCatalogTool & { methodName: string }>;
};

const MAX_CONNECTORS = 8;
const MAX_TOOLS = 64;

export function parseMcpCodeModePolicy(raw: string | undefined): McpCodeModePolicy | null {
  if (!raw?.trim()) return null;
  try {
    const value = JSON.parse(raw) as Partial<McpCodeModePolicy>;
    if (value.version !== 1 || value.enabled !== true || !value.connectors || typeof value.connectors !== "object" || Array.isArray(value.connectors)) {
      return null;
    }
    const entries = Object.entries(value.connectors);
    if (entries.length === 0 || entries.length > MAX_CONNECTORS) return null;
    let count = 0;
    const connectors: McpCodeModePolicy["connectors"] = {};
    for (const [connector, config] of entries) {
      if (!connector.trim() || !config || !Array.isArray(config.expose)) return null;
      const expose = [...new Set(config.expose.filter((name): name is string => typeof name === "string" && name.trim().length > 0))];
      if (expose.length === 0) return null;
      count += expose.length;
      if (count > MAX_TOOLS) return null;
      connectors[connector] = { expose };
    }
    return { version: 1, enabled: true, connectors };
  } catch {
    return null;
  }
}

export function selectMcpCodeModeProviders(input: {
  policy: McpCodeModePolicy;
  catalog: McpCatalogTool[];
  servers: Record<string, { name: string }>;
  sanitize: (name: string) => string;
}): SelectedMcpProvider[] | null {
  const byConnector = new Map<string, McpCatalogTool[]>();
  for (const catalogTool of input.catalog) {
    const connector = input.servers[catalogTool.serverId]?.name;
    if (!connector) continue;
    const allowed = input.policy.connectors[connector]?.expose;
    if (!allowed?.includes(catalogTool.name)) continue;
    const group = byConnector.get(connector) ?? [];
    group.push(catalogTool);
    byConnector.set(connector, group);
  }

  const providerNames = new Set<string>();
  const providers: SelectedMcpProvider[] = [];
  for (const [connector, catalog] of byConnector) {
    const providerName = input.sanitize(connector);
    if (providerNames.has(providerName)) return null;
    providerNames.add(providerName);

    const methodNames = new Map<string, string>();
    const selected: SelectedMcpProvider["tools"] = [];
    for (const catalogTool of catalog) {
      const methodName = input.sanitize(catalogTool.name);
      const existing = methodNames.get(methodName);
      if (existing && existing !== catalogTool.name) return null;
      methodNames.set(methodName, catalogTool.name);
      selected.push({ ...catalogTool, methodName });
    }
    providers.push({ connector, providerName, tools: selected });
  }
  return providers;
}
