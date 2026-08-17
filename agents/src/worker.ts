import { workflowBindings, type AgentsEnv } from "./workflows";
import { verifyGithubSignature } from "./github-hmac";

export { AuditWorkflow, DigWorkflow, TriageWorkflow } from "./workflow-entry";

interface WorkflowBinding {
  create(opts: { id: string; params: Record<string, unknown> }): Promise<{ id: string }>;
}

export interface WorkerEnv extends AgentsEnv {
  TRIAGE: WorkflowBinding;
  AUDIT: WorkflowBinding;
  DIG: WorkflowBinding;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        workflows: workflowBindings(),
        model: env.AGENTS_MODEL || "grok-4.6",
      });
    }
    if (request.method === "POST" && url.pathname === "/webhooks/github") {
      const raw = await request.text();
      const sig = request.headers.get("x-hub-signature-256") || "";
      if (!verifyGithubSignature(env.GITHUB_WEBHOOK_SECRET || "", raw, sig)) {
        return new Response("unauthorized", { status: 401 });
      }
      const event = request.headers.get("x-github-event") || "";
      const payload = JSON.parse(raw) as Record<string, unknown>;
      const action = String(payload.action || "");
      if (event === "issues" && action === "opened") {
        const issue = payload.issue as { number: number };
        await env.TRIAGE.create({ id: `issue:${issue.number}`, params: payload });
        return Response.json({ queued: "triage", issue: issue.number });
      }
      if (event === "pull_request" && (action === "opened" || action === "synchronize")) {
        const pr = payload.pull_request as { number: number };
        await env.AUDIT.create({ id: `pr:${pr.number}`, params: payload });
        return Response.json({ queued: "audit", pr: pr.number });
      }
      return Response.json({ queued: "ignored", event, action });
    }
    return new Response("not found", { status: 404 });
  },
};
