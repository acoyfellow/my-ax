import { verifyGithubSignature } from "./github-hmac";

export interface HookEnv {
  GITHUB_WEBHOOK_SECRET?: string;
  HOOK_FORWARD_SECRET?: string;
  AGENTS: Fetcher;
}

export default {
  async fetch(request: Request, env: HookEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST") return new Response("not found", { status: 404 });
    const raw = await request.text();
    if (url.pathname === "/webhooks/github") {
      const sig = request.headers.get("x-hub-signature-256") || "";
      if (!await verifyGithubSignature(env.GITHUB_WEBHOOK_SECRET || "", raw, sig)) {
        return new Response("unauthorized", { status: 401 });
      }
    } else if (url.pathname !== "/factory/submissions") {
      return new Response("not found", { status: 404 });
    }
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.set("x-ax-hook-forward", env.HOOK_FORWARD_SECRET || "");
    return env.AGENTS.fetch(new Request(`https://agents.internal${url.pathname}`, {
      method: "POST",
      headers,
      body: raw,
    }));
  },
};
