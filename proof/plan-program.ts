import { Cause, Clock, Context, Data, Effect, Exit, Layer } from "effect";

export interface SmokeProofConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface GateResult {
  id: string;
  title: string;
  status: "pass" | "fail";
  durationMs: number;
  details: Record<string, unknown>;
  failures: string[];
}

export interface SmokeProofReceipt {
  name: "my-ax-smoke";
  startedAt: string;
  finishedAt: string;
  baseUrl: string;
  status: "pass" | "fail";
  results: GateResult[];
}

export class ProofHttpError extends Data.TaggedError("ProofHttpError")<{
  cause: unknown;
}> {}

export class ProofHttp extends Context.Service<ProofHttp, {
  request(input: string | URL | Request, init?: RequestInit): Effect.Effect<Response, ProofHttpError | Cause.TimeoutError>;
}>()("my-ax/proof/ProofHttp") {}

export function proofHttpLayer(fetchImpl: typeof fetch = fetch): Layer.Layer<ProofHttp> {
  return Layer.succeed(ProofHttp, ProofHttp.of({
    request: (input, init) => Effect.tryPromise({
      try: () => fetchImpl(input, init),
      catch: (cause) => new ProofHttpError({ cause }),
    }).pipe(Effect.timeout("15 seconds")),
  }));
}

function expect(failures: string[], condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function gate(
  id: string,
  title: string,
  program: Effect.Effect<{ details: Record<string, unknown>; failures: string[] }, unknown, ProofHttp>,
): Effect.Effect<GateResult, never, ProofHttp> {
  return Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    const result = yield* Effect.exit(program);
    const durationMs = (yield* Clock.currentTimeMillis) - started;
    if (Exit.isSuccess(result)) {
      return {
        id,
        title,
        status: result.value.failures.length === 0 ? "pass" : "fail",
        durationMs,
        details: result.value.details,
        failures: result.value.failures,
      };
    }
    return {
      id,
      title,
      status: "fail",
      durationMs,
      details: {},
      failures: [`exception: ${Cause.pretty(result.cause)}`],
    };
  });
}

function redirectsToExternalAccess(baseUrl: string, location: string): boolean {
  const baseHost = new URL(baseUrl).host;
  return /^https:\/\//.test(location) && !location.startsWith(baseUrl) && !location.includes(baseHost);
}

function edgeAlive(config: SmokeProofConfig): Effect.Effect<GateResult, never, ProofHttp> {
  return gate("edge-alive", "Edge routes the configured host to a worker (anonymous → 302 to Access)", Effect.gen(function* () {
    const http = yield* ProofHttp;
    const response = yield* http.request(`${config.baseUrl}/`, { redirect: "manual" });
    const failures: string[] = [];
    expect(failures, response.status === 302, `expected 302, got ${response.status}`);
    const location = response.headers.get("location") ?? "";
    const redirects = redirectsToExternalAccess(config.baseUrl, location);
    expect(failures, redirects, `expected 302 to an external SSO host, got ${location.slice(0, 80)}`);
    return { details: { status: response.status, redirectsToAccess: redirects }, failures };
  }));
}

function serviceTokenAdmitted(config: SmokeProofConfig): Effect.Effect<GateResult, never, ProofHttp> {
  return gate("service-token-admitted", "Access admits the my-ax-smoke-prober service token at /api/health", Effect.gen(function* () {
    const http = yield* ProofHttp;
    const response = yield* http.request(`${config.baseUrl}/api/health`, {
      headers: {
        "CF-Access-Client-Id": config.clientId,
        "CF-Access-Client-Secret": config.clientSecret,
      },
      redirect: "manual",
    });
    const failures: string[] = [];
    expect(failures, response.status === 200, `expected 200, got ${response.status}`);
    return { details: { status: response.status }, failures };
  }));
}

function healthBodyOk(config: SmokeProofConfig): Effect.Effect<GateResult, never, ProofHttp> {
  return gate("health-body-ok", "/api/health reports ok with all bindings present and no missing secrets", Effect.gen(function* () {
    const http = yield* ProofHttp;
    const response = yield* http.request(`${config.baseUrl}/api/health`, {
      headers: {
        "CF-Access-Client-Id": config.clientId,
        "CF-Access-Client-Secret": config.clientSecret,
      },
    });
    const failures: string[] = [];
    if (response.status !== 200) {
      failures.push(`expected 200, got ${response.status}`);
      return { details: { status: response.status }, failures };
    }
    const body = yield* Effect.tryPromise({
      try: () => response.json() as Promise<{
        ok: boolean;
        name: string;
        version: string | null;
        region: string | null;
        bindings: Record<string, boolean>;
        requiredSecretsMissing: string[];
      }>,
      catch: (cause) => new ProofHttpError({ cause }),
    });
    expect(failures, body.ok === true, `expected ok=true, got ${body.ok}`);
    expect(failures, body.name === "my-ax", `expected name="my-ax", got ${body.name}`);
    expect(failures, body.requiredSecretsMissing.length === 0, `missing required secrets: ${body.requiredSecretsMissing.join(", ") || "(none)"}`);
    for (const binding of ["USER_AGENT", "OAUTH_CLIENT", "SANDBOX", "DB", "AUDIT_KV", "BACKUP_BUCKET", "USER_UPLOADS", "AI", "BROWSER", "LOADER"]) {
      expect(failures, body.bindings[binding] === true, `binding ${binding} missing`);
    }
    return {
      details: {
        version: body.version,
        region: body.region,
        bindings: body.bindings,
        requiredSecretsMissing: body.requiredSecretsMissing,
      },
      failures,
    };
  }));
}

function policyEnforced(config: SmokeProofConfig): Effect.Effect<GateResult, never, ProofHttp> {
  return gate("policy-enforced", "Without the service token, /api/health is still gated by Access (302)", Effect.gen(function* () {
    const http = yield* ProofHttp;
    const response = yield* http.request(`${config.baseUrl}/api/health`, { redirect: "manual" });
    const failures: string[] = [];
    expect(failures, response.status === 302, `expected 302, got ${response.status}`);
    const location = response.headers.get("location") ?? "";
    const redirects = redirectsToExternalAccess(config.baseUrl, location);
    expect(failures, redirects, `expected 302 to an external SSO host, got ${location.slice(0, 80)}`);
    return { details: { status: response.status, redirectsToAccess: redirects }, failures };
  }));
}

export function runSmokeProof(config: SmokeProofConfig): Effect.Effect<SmokeProofReceipt, never, ProofHttp> {
  return Effect.gen(function* () {
    const startedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const results = yield* Effect.forEach(
      [edgeAlive(config), serviceTokenAdmitted(config), healthBodyOk(config), policyEnforced(config)],
      (program) => program,
      { concurrency: 1 },
    );
    const finishedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    return {
      name: "my-ax-smoke",
      startedAt,
      finishedAt,
      baseUrl: config.baseUrl,
      status: results.every((result) => result.status === "pass") ? "pass" : "fail",
      results,
    };
  });
}
