import { createHash, randomUUID } from "node:crypto";

export interface ParsedResource {
  system: string;
  kind: string;
  id: string;
  url: string;
  project?: string;
  iid?: string;
}

export interface CapabilityGrant {
  id: string;
  kind: string;
  resource: ParsedResource;
  constraints: { allowSearch: false; allowAdjacent: false; allowWrite: false };
}

export interface CapabilityBundle {
  schema: "capability.bundle.v1";
  principal: { type: "cloudflare-user"; id: string };
  source: { kind: "user-pasted-url"; urls: string[] };
  task: string;
  capabilities: CapabilityGrant[];
  nonce: string;
  hash: string;
}

export interface CapabilityReviewProof {
  schema: "capability.review.proof.v1";
  principal: string;
  bundleHash: string;
  childSurface: { tools: string[] };
  forbiddenTools: string[];
  allowed: Array<{ operation: string; resource: string; url: string; status: "success"; contentHash: string; contentLength: number }>;
  denied: Array<{ operation: string; resource: string; result: "denied_before_resolver" | "tool_not_available"; beforeResolver: boolean }>;
  asks: Array<{ schema: "capability.ask.v1"; requestedCapability: string; requestedUrl: string; reason: string; status: "ask" }>;
  rawInternalContentPersisted: false;
  decision: "pass" | "fail";
  createdAt: string;
}

const constraints = { allowSearch: false, allowAdjacent: false, allowWrite: false } as const;
export const childTools = ["capability_list", "capability_read", "capability_request_more"] as const;
export const forbiddenTools = ["cfi", "cf-portal", "shell", "browser", "fetch_url", "wiki.search", "jira.search", "gitlab.search", "list-all"] as const;

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function parseResourceUrl(raw: string): ParsedResource {
  const url = new URL(raw.trim());
  if (url.hostname === "wiki.cfdata.org") {
    const match = url.pathname.match(/\/pages\/(\d+)(?:\/|$)/);
    if (!match) throw new Error("unsupported wiki URL: missing page id");
    return { system: "wiki", kind: "wiki.page.read", id: match[1], url: raw.trim() };
  }
  if (url.hostname === "jira.cfdata.org") {
    const match = url.pathname.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)(?:\/|$)/);
    if (!match) throw new Error("unsupported Jira URL: missing issue key");
    return { system: "jira", kind: "jira.issue.read", id: match[1], url: raw.trim() };
  }
  if (url.hostname === "gitlab.cfdata.org") {
    const match = url.pathname.match(/^\/(.+?)\/-\/merge_requests\/(\d+)(?:\/|$)/);
    if (!match) throw new Error("unsupported GitLab URL: missing MR iid");
    return { system: "gitlab", kind: "gitlab.mr.read", id: `${match[1]}!${match[2]}`, project: match[1], iid: match[2], url: raw.trim() };
  }
  if (url.hostname === "docs.google.com") {
    const match = url.pathname.match(/^\/document\/d\/([^/]+)/);
    if (!match) throw new Error("unsupported Google Docs URL: missing document id");
    return { system: "google-docs", kind: "google.doc.read", id: match[1], url: raw.trim() };
  }
  if (url.hostname === "chat.google.com") {
    const space = url.pathname.match(/\/space\/([^/]+)/);
    const thread = url.pathname.match(/\/thread\/([^/]+)/);
    const msg = url.pathname.match(/\/message\/([^/]+)/);
    if (msg) return { system: "google-chat", kind: "google.chat.message.read", id: msg[1], url: raw.trim() };
    if (thread) return { system: "google-chat", kind: "google.chat.thread.read", id: thread[1], url: raw.trim() };
    if (space) return { system: "google-chat", kind: "google.chat.space.read", id: space[1], url: raw.trim() };
    throw new Error("unsupported Google Chat URL: missing space/thread/message id");
  }
  if (url.hostname === "portal.mcp.cfdata.org") {
    if (url.pathname !== "/mcp") throw new Error("unsupported cf-portal URL: expected /mcp");
    return { system: "cf-portal", kind: "cf-portal.server.tools.list", id: "portal.mcp.cfdata.org/mcp", url: raw.trim() };
  }
  throw new Error(`unsupported host: ${url.hostname}`);
}

export function createCapabilityBundle({ principal, urls, task = "Scoped resource review" }: { principal: string; urls: string[]; task?: string }): CapabilityBundle {
  const parsed = urls.filter((url) => url.trim()).map(parseResourceUrl);
  const capabilities = parsed.map((resource) => ({ id: `cap_${randomUUID()}`, kind: resource.kind, resource, constraints }));
  const base = { schema: "capability.bundle.v1" as const, principal: { type: "cloudflare-user" as const, id: principal }, source: { kind: "user-pasted-url" as const, urls }, task, capabilities, nonce: randomUUID() };
  return { ...base, hash: stableHash(base) };
}

function fakeContentFor(resource: ParsedResource): string {
  return JSON.stringify({ resource: resource.id, kind: resource.kind, demo: true });
}

export function runCapabilityReviewDemo(bundle: CapabilityBundle): CapabilityReviewProof {
  const allowed = bundle.capabilities.slice(0, 3).map((cap) => {
    const content = fakeContentFor(cap.resource);
    return { operation: cap.kind, resource: cap.resource.id, url: cap.resource.url, status: "success" as const, contentHash: stableHash(content), contentLength: content.length };
  });
  const denied = [
    { operation: bundle.capabilities[0]?.kind ?? "resource.read", resource: `${bundle.capabilities[0]?.resource.id ?? "resource"}:adjacent`, result: "denied_before_resolver" as const, beforeResolver: true },
    { operation: "cfi", resource: "*", result: "tool_not_available" as const, beforeResolver: true },
    { operation: "wiki.search", resource: "*", result: "tool_not_available" as const, beforeResolver: true },
  ];
  const asks = [{ schema: "capability.ask.v1" as const, requestedCapability: "wiki.page.read:123457", requestedUrl: "https://wiki.cfdata.org/spaces/TEAM/pages/123457/Adjacent", reason: "Need adjacent page for comparison; not present in the original bundle.", status: "ask" as const }];
  return { schema: "capability.review.proof.v1", principal: bundle.principal.id, bundleHash: bundle.hash, childSurface: { tools: [...childTools] }, forbiddenTools: [...forbiddenTools], allowed, denied, asks, rawInternalContentPersisted: false, decision: "pass", createdAt: new Date().toISOString() };
}
