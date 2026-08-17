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
      if (!await verifyGithubSignature(env.GITHUB_WEBHOOK_SECRET || "", raw, sig)) {
        return new Response("unauthorized", { status: 401 });
      }
      const event = request.headers.get("x-github-event") || "";
      const payload = JSON.parse(raw) as Record<string, unknown>;
      const action = String(payload.action || "");
      if (event === "issues" && action === "opened") {
        const issue = payload.issue as { number: number; title?: string; body?: string; user?: { login?: string } };
        const created = await env.TRIAGE.create({
          id: `issue:${issue.number}`,
          params: {
            number: issue.number,
            title: String(issue.title || ""),
            body: String(issue.body || ""),
            author: String(issue.user?.login || "unknown"),
          },
        });
        return Response.json({ queued: "triage", issue: issue.number, instance: created.id });
      }
      if (event === "pull_request" && (action === "opened" || action === "synchronize")) {
        const pr = payload.pull_request as {
          number: number; title?: string; body?: string; draft?: boolean; user?: { login?: string };
          head?: { sha?: string };
        };
        const created = await env.AUDIT.create({
          id: `pr:${pr.number}`,
          params: {
            number: pr.number,
            title: String(pr.title || ""),
            body: String(pr.body || ""),
            author: String(pr.user?.login || "unknown"),
            draft: Boolean(pr.draft),
            headSha: String(pr.head?.sha || ""),
            files: [],
            behindMain: 0,
          },
        });
        return Response.json({ queued: "audit", pr: pr.number, instance: created.id });
      }
      return Response.json({ queued: "ignored", event, action });
    }
    return new Response("not found", { status: 404 });
  },
};
