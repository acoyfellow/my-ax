import { forwardedFromHook, workflowBindings, type AgentsEnv } from "./workflows";
import { verifyGithubSignature } from "./github-hmac";
import { liveGithubPort } from "./ports";
import { formatDuplicateClose, planSweep, type SweepIssue } from "./sweep";

export { AuditWorkflow, DigWorkflow, ReviewWorkflow, TriageWorkflow } from "./workflow-entry";

interface WorkflowBinding {
  create(opts: { id: string; params: Record<string, unknown> }): Promise<{ id: string }>;
}

export interface WorkerEnv extends AgentsEnv {
  TRIAGE: WorkflowBinding;
  AUDIT: WorkflowBinding;
  DIG: WorkflowBinding;
  REVIEW: WorkflowBinding;
}

async function queueTriage(env: WorkerEnv, deliveryId: string, issue: { number: number; title?: string; body?: string; user?: { login?: string }; comments?: number }) {
  try {
    const created = await env.TRIAGE.create({
      id: deliveryId,
      params: {
        number: issue.number,
        title: String(issue.title || ""),
        body: String(issue.body || ""),
        author: String(issue.user?.login || "unknown"),
        commentsCount: Number(issue.comments ?? 0),
      },
    });
    return Response.json({ queued: "triage", issue: issue.number, instance: created.id, deliveryId });
  } catch (error) {
    return Response.json({ queued: "triage", issue: issue.number, deliveryId, error: String(error) }, { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      if (!forwardedFromHook(request, env)) return new Response("not found", { status: 404 });
      return Response.json({
        ok: true,
        workflows: workflowBindings(),
        model: env.AGENTS_MODEL || "grok-4.6",
      });
    }
    if (request.method === "POST" && url.pathname === "/webhooks/github") {
      if (!forwardedFromHook(request, env)) return new Response("unauthorized", { status: 401 });
      const raw = await request.text();
      const sig = request.headers.get("x-hub-signature-256") || "";
      if (!await verifyGithubSignature(env.GITHUB_WEBHOOK_SECRET || "", raw, sig)) {
        return new Response("unauthorized", { status: 401 });
      }
      const event = request.headers.get("x-github-event") || "";
      const payload = JSON.parse(raw) as Record<string, unknown>;
      const action = String(payload.action || "");
      const deliveryId = request.headers.get("x-github-delivery") || crypto.randomUUID();
      if (event === "issues" && action === "opened") {
        const issue = payload.issue as { number: number; title?: string; body?: string; user?: { login?: string } };
        return queueTriage(env, deliveryId, issue);
      }
      if (event === "issue_comment" && action === "created") {
        const comment = payload.comment as { body?: string; user?: { login?: string } };
        const issue = payload.issue as { number: number; title?: string; body?: string; user?: { login?: string }; pull_request?: unknown };
        if (issue.pull_request) return Response.json({ queued: "ignored", event, action });
        const commentBody = String(comment.body || "");
        if (/^## loop board\b/m.test(commentBody)) return Response.json({ queued: "ignored", event, action, reason: "loop-board" });
        if (!/\btriage:draft\b/i.test(commentBody)) return Response.json({ queued: "ignored", event, action });
        return queueTriage(env, deliveryId, {
          number: issue.number,
          title: String(issue.title || ""),
          body: `${issue.body || ""}\n${commentBody}`,
          user: comment.user || issue.user,
        });
      }
      if (event === "pull_request" && (action === "opened" || action === "synchronize")) {
        const pr = payload.pull_request as {
          number: number; title?: string; body?: string; draft?: boolean; user?: { login?: string };
          head?: { sha?: string; ref?: string };
        };
        await env.REVIEW.create({
          id: `${deliveryId}-review`,
          params: {
            number: pr.number,
            title: String(pr.title || ""),
            body: String(pr.body || ""),
            author: String(pr.user?.login || "unknown"),
            draft: Boolean(pr.draft),
            headSha: String(pr.head?.sha || ""),
            head: String(pr.head?.ref || ""),
          },
        }).catch(() => undefined);
        const created = await env.AUDIT.create({
          id: deliveryId,
          params: {
            number: pr.number,
            title: String(pr.title || ""),
            body: String(pr.body || ""),
            author: String(pr.user?.login || "unknown"),
            draft: Boolean(pr.draft),
            headSha: String(pr.head?.sha || ""),
          },
        });
        return Response.json({ queued: "audit", pr: pr.number, instance: created.id });
      }
      return Response.json({ queued: "ignored", event, action });
    }
    return new Response("not found", { status: 404 });
  },
  async scheduled(_event: unknown, env: WorkerEnv): Promise<void> {
    await runIssueSweep(env);
  },
};

export async function runIssueSweep(env: WorkerEnv): Promise<{ closed: number; queued: number }> {
  const github = liveGithubPort(env);
  if (!github.listOpenIssues || !github.listComments) return { closed: 0, queued: 0 };
  const open = await github.listOpenIssues();
  const issues: SweepIssue[] = [];
  for (const issue of open) {
    const comments = await github.listComments(issue.number);
    const hasHead = github.hasBranch ? await github.hasBranch(`bot/issue-${issue.number}`) : false;
    issues.push({ ...issue, state: "open", comments, hasHead });
  }
  const actions = planSweep(issues);
  let closed = 0;
  let queued = 0;
  for (const action of actions) {
    if (action.action === "close-duplicate" && github.closeIssue) {
      await github.closeIssue(action.number, formatDuplicateClose(action.keep, action.fingerprint));
      closed += 1;
    }
    if (action.action === "queue") {
      const issue = issues.find((row) => row.number === action.number);
      if (!issue) continue;
      await queueTriage(env, `sweep-${action.number}`, {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        user: { login: issue.author },
      });
      queued += 1;
    }
  }
  return { closed, queued };
}
