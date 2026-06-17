// my-ax — Core Type Definitions
// Research/analysis agent running as a Cloudflare Durable Object
// with shell access, tool use, and WebSocket streaming.
//
// Shared app-level types retained where they are load-bearing for
// migration compatibility (DO class names, etc).
//
// Per seal/AGENTS.md: the global `Env` interface from `worker-configuration.d.ts`
// is used directly — no re-declaration here. Wrangler regenerates it from
// `wrangler.jsonc` bindings, so the contract stays in one place.

import type { AccessIdentity } from "./auth";

// ---------------------------------------------------------------------------
// Module augmentation: extend the wrangler-generated Cloudflare.Env with the
// secrets that don't appear in wrangler.jsonc (set via `wrangler secret put`).
// ---------------------------------------------------------------------------
declare global {
  namespace Cloudflare {
    interface Env {
      // Bridge ticket signing
      BRIDGE_JWT_SECRET: string;

      // OAuth token encryption-at-rest in OAuthClientDO (AES-GCM-256, HKDF
      // per-user key derivation). 32+ bytes base64. Generate with:
      //   openssl rand -base64 32
      // Set with:
      //   wrangler secret put MASTER_KEY
      // Rotation: ROADMAP — currently rotating MASTER_KEY would invalidate
      // every stored token, requiring all users to re-authorize. Future
      // work: dual-key window or KMS-backed envelope encryption.
      MASTER_KEY: string;
      /** Web Push VAPID identity. mailto: or https: subject. */
      VAPID_SUBJECT: string;
      VAPID_PUBLIC_KEY: string;
      VAPID_PRIVATE_KEY: string;

      /**
       * Optional. Required only if the my-ax AI Gateway is configured with
       * authentication enabled (Authenticated Gateway toggle in the dashboard).
       * Currently disabled, so no Workers AI traffic through the gateway needs
       * this. Set it if you re-enable authenticated gateway later, or if you
       * add a model with route="gateway-compat" to the catalog.
       */
      /**
       * Optional. Required only if any browser tool actually fetches native
       * Browser Run recordings server-side. The browser tool calls fail loudly
       * at the call site if this is missing; no silent UI degradation.
       */
      BROWSER_API_TOKEN?: string;

      // Note: CLOUDFLARE_AI_GATEWAY_ID is declared in wrangler.jsonc vars
      // so it's already in the wrangler-generated worker-configuration.d.ts.
      // Don't re-declare it here.

      // R2 S3 credentials used by Cloudflare Sandbox backup uploads through
      // presigned URLs. Generated in dash:
      //   Account → R2 → API tokens → Object Read & Write, bucket=my-ax-homes
      //
      // REQUIRED: src/index.tsx's fail-loud middleware refuses to serve
      // any request when either is missing. Workspace persistence (the
      // snapshot-backed durable computer story) breaks silently without
      // them; we promoted them from optional after losing /home/user data
      // for weeks because nobody had set them.
      R2_ACCESS_KEY_ID: string;
      R2_SECRET_ACCESS_KEY: string;

      // Local-dev bypass (only fires when ENVIRONMENT=dev AND ISS+AUD empty)
      DEV_USER_GROUPS?: string;

      // Optional deploy-owned static MCP registry. Public default is empty;
      // private deployments inject JSON without committing connector names.
      BUILTIN_CONNECTORS_JSON?: string;

      /**
       * Optional, deploy-owned exact allowlist for official MCP Code Mode.
       * Shape: {"version":1,"enabled":true,"connectors":{"id":{"expose":["tool"]}}}
       * Public/self-host default is disabled when absent or invalid.
       */
      MCP_CODE_MODE_POLICY_JSON?: string;

      /** Optional Cloudbox durable-computer delegation. Both must be set. */
      CLOUDBOX_URL?: string;
      CLOUDBOX_INTERNAL_TOKEN?: string;

    }
  }
}

// Re-export the wrangler-generated Env as the canonical app-level type.
export type Env = Cloudflare.Env;

// ---------------------------------------------------------------------------
// Message attachments. Lives here because both the upload handler and the
// agent's UI-message conversion code touch it.
// ---------------------------------------------------------------------------
export interface Attachment {
  id: string;
  kind: 'image';
  mime: string;
  key: string;
  name?: string;
  bytes: number;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export interface ToolContext {
  workingDirectory: string;
  /** Deliver a same-owner attention notification to subscribed installed apps. */
  notifyOwner: (input: { kind: "session.update" | "job.complete" | "job.needs_input" | "watch.fired" | "deploy.gate"; title: string; body: string; href?: string }) => Promise<{ delivered: number; expired: number; failed: number; devices: number; failures?: { host: string; status?: number; reason: string }[] }>;
  shellExec: (cmd: string, opts?: ShellExecOpts) => Promise<ShellResult>;
  processStart: (cmd: string, opts?: ProcessStartOpts) => Promise<BackgroundProcessInfo>;
  processStatus: (id: string) => Promise<BackgroundProcessInfo | null>;
  processLogs: (id: string) => Promise<BackgroundProcessLogs | null>;
  processCancel: (id: string, signal?: string) => Promise<boolean>;
  runCode: (code: string, options?: { language?: "python" | "javascript" | "typescript"; timeout?: number }) => Promise<unknown>;
  tunnelGet: (port: number) => Promise<{ id: string; port: number; url: string; hostname: string; createdAt: string }>;
  tunnelList: () => Promise<Array<{ id: string; port: number; url: string; hostname: string; createdAt: string }>>;
  tunnelDestroy: (port: number) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  listFiles: (path: string, opts?: { recursive?: boolean; includeHidden?: boolean }) => Promise<Array<{ path: string; name?: string; type?: string; size?: number }>>;
  searchConversations: (query: string, limit?: number) => Promise<Array<{ sessionId: string; ts: string; role: string; snippet: string }>>;
  /** Compile and persist one owner-scoped Svelte artifact attached to this conversation. */
  createSvelteArtifact: (input: { title: string; source: string }) => Promise<{ kind: "svelte-artifact"; artifactId: string; title: string; src: string; sourceHash: string }>;
  broadcast: (msg: string) => void;

  // Legacy in-process connector bridge surfaces retained for Settings
  // catalog/reauth helper calls. Populated by agent.ts buildToolContext().
  identity: AccessIdentity;
  sessionId: string;
  bridgeBaseUrl: string;
  bridgeJwtSecret: string;

  // The connector tool calls handleBridgeRequest in-process
  // (no fetch to the public URL — Cloudflare Access at the edge would 302
  // since the Worker can't satisfy its own Access app from inside).
  // env carries the audit-KV + OAUTH_CLIENT DO binding handleBridgeRequest
  // needs; workerOrigin is used to build the OAuthClientStore facade.
  env: Env;
  workerOrigin: string;
}

export interface ShellExecOpts {
  cwd?: string;
  /** True when the caller explicitly supplied cwd, vs shell_exec defaulting. */
  cwdExplicit?: boolean;
  timeout?: number;
  env?: Record<string, string>;
}

export interface ProcessStartOpts extends ShellExecOpts {
  processId?: string;
}

export interface BackgroundProcessInfo {
  id: string;
  pid?: number;
  command: string;
  status: string;
  startTime: string;
  endTime?: string;
  exitCode?: number;
  sessionId?: string;
}

export interface BackgroundProcessLogs {
  processId: string;
  stdout: string;
  stderr: string;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// API response envelope
// ---------------------------------------------------------------------------
export interface ApiResponse<T = unknown> {
  ok: boolean;
  command: string;
  result?: T;
  error?: { message: string; code: string };
  fix?: string;
  next_actions: Array<{ command: string; description: string }>;
}
