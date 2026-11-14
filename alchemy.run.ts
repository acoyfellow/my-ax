import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

const DURABLE_OBJECTS = {
  USER_AGENT: "UserAgent",
  OAUTH_CLIENT: "OAuthClientDO",
  MACHINE_HOST: "MachineHost",
  COMPUTER: "ComputerWorkspace",
  PI_CHAT: "PiChatAgent",
  WORKSPACE_HUB: "WorkspaceHub",
  CONNECTOR_AGENT: "ConnectorAgent",
  VoiceThinkAgent: "VoiceThinkAgent",
} as const;

function durableObjects() {
  return Object.fromEntries(
    Object.entries(DURABLE_OBJECTS).map(([binding, className]) => [binding, Cloudflare.DurableObject(binding, { className })]),
  );
}

export default Alchemy.Stack(
  "my-ax",
  { providers: Cloudflare.providers(), state: Cloudflare.state({ workerName: "my-ax-alchemy-state" }) },
  Effect.gen(function* () {
    const accessIssuer = yield* Config.String("MYAX_ACCESS_ISS");
    const accessAudience = yield* Config.String("MYAX_ACCESS_AUD");
    const accountId = yield* Config.String("CLOUDFLARE_ACCOUNT_ID");
    const previewHost = yield* Config.String("MYAX_PREVIEW_HOST");

    const db = yield* Cloudflare.D1.Database("DB", { migrations: "./migrations" });
    const auditKv = yield* Cloudflare.KV.Namespace("AUDIT_KV");
    const homes = yield* Cloudflare.R2.Bucket("BACKUP_BUCKET");
    const uploads = yield* Cloudflare.R2.Bucket("USER_UPLOADS");
    const masterKey = yield* Alchemy.makeRandom("MasterKey");
    const bridgeSecret = yield* Alchemy.makeRandom("BridgeJwtSecret");

    const worker = yield* Cloudflare.Worker("Worker", {
      main: "./src/index.tsx",
      compatibility: { date: "2026-04-21", flags: ["nodejs_compat"] },
      assets: { directory: "./public", notFoundHandling: "none", runWorkerFirst: true },
      workersDev: false,
      domain: previewHost,
      env: {
        ENVIRONMENT: "preview",
        CF_ACCESS_AUD: accessAudience,
        CF_ACCESS_ISS: accessIssuer,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        BRIDGE_BASE_URL: `https://${previewHost}`,
        CLOUDFLARE_AI_GATEWAY_ID: "",
        BUILTIN_CONNECTORS_JSON: "[]",
        MCP_CODE_MODE_POLICY_JSON: "{}",
        BACKUP_BUCKET_NAME: homes.bucketName,
        MASTER_KEY: masterKey,
        BRIDGE_JWT_SECRET: bridgeSecret,
        DB: db,
        AUDIT_KV: auditKv,
        BACKUP_BUCKET: homes,
        USER_UPLOADS: uploads,
        AI: Cloudflare.Workers.AI(),
        BROWSER: Cloudflare.Browser(),
        LOADER: Cloudflare.WorkerLoader(),
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
        RIG_PIPELINE: Cloudflare.Workflow("RigPipeline", { className: "RigPipeline" }),
        ...durableObjects(),
      },
    });

    return { workerName: worker.workerName, host: previewHost };
  }),
);
