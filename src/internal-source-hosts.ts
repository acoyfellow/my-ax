export interface InternalSourceHosts {
  wiki: string;
  jira: string;
  gitlab: string;
  mcpPortal: string;
}

export const EXAMPLE_INTERNAL_SOURCE_HOSTS: InternalSourceHosts = {
  wiki: "wiki.example.com",
  jira: "jira.example.com",
  gitlab: "gitlab.example.com",
  mcpPortal: "mcp-portal.example.com",
};

const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function readHost(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const host = value.trim().toLowerCase();
  return HOSTNAME.test(host) ? host : fallback;
}

export function parseInternalSourceHosts(raw: string | undefined | null): InternalSourceHosts {
  if (!raw) return EXAMPLE_INTERNAL_SOURCE_HOSTS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EXAMPLE_INTERNAL_SOURCE_HOSTS;
  }
  if (!value || typeof value !== "object") return EXAMPLE_INTERNAL_SOURCE_HOSTS;
  const record = value as Record<string, unknown>;
  return {
    wiki: readHost(record.wiki, EXAMPLE_INTERNAL_SOURCE_HOSTS.wiki),
    jira: readHost(record.jira, EXAMPLE_INTERNAL_SOURCE_HOSTS.jira),
    gitlab: readHost(record.gitlab, EXAMPLE_INTERNAL_SOURCE_HOSTS.gitlab),
    mcpPortal: readHost(record.mcpPortal, EXAMPLE_INTERNAL_SOURCE_HOSTS.mcpPortal),
  };
}

export function externalSourceHosts(hosts: InternalSourceHosts): ReadonlySet<string> {
  return new Set([hosts.gitlab, "github.com", "www.github.com"]);
}
