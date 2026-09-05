import { forwardedFromHook, workflowBindings, type AgentsEnv } from "./workflows";
import { verifyGithubSignature } from "./github-hmac";
import { liveGithubPort } from "./ports";
import { acceptImplementationSubmission } from "./implementation-handler";
import { formatDuplicateClose, formatHumanBoundaryClose, formatIssueTransferredToPr, formatPlaceholderPrClose, formatRetryExhausted, planSweep, sweepLeaseId, type SweepIssue } from "./sweep";

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

async function queueTriage(env: WorkerEnv, deliveryId: string, issue: { number: number; title?: string; body?: string; user?: { login?: string }; comments?: number; labels?: Array<{ name?: string }> | string[] }) {
  try {
    const created = await env.TRIAGE.create({
      id: deliveryId,
      params: {
        number: issue.number,
        title: String(issue.title || ""),
        body: String(issue.body || ""),
        author: String(issue.user?.login || "unknown"),
        commentsCount: Number(issue.comments ?? 0),
        labels: (issue.labels ?? []).map((label) => typeof label === "string" ? label : String(label.name || "")).filter(Boolean),
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
    if (request.method === "POST" && url.pathname === "/factory/submissions") {
      if (!forwardedFromHook(request, env)) return new Response("unauthorized", { status: 401 });
      return acceptImplementationSubmission(request, env);
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
        const issue = payload.issue as { number: number; title?: string; body?: string; user?: { login?: string }; labels?: Array<{ name?: string }> };
        return queueTriage(env, deliveryId, issue);
      }
      if (event === "issue_comment" && action === "created") {
        const comment = payload.comment as { body?: string; user?: { login?: string } };
        const issue = payload.issue as { number: number; title?: string; body?: string; user?: { login?: string }; pull_request?: unknown };
        if (issue.pull_request) return Response.json({ queued: "ignored", event, action });
        const commentBody = String(comment.body || "");
        if (/^## (?:loop board|Factory status)\b/m.test(commentBody)) return Response.json({ queued: "ignored", event, action, reason: "factory-status" });
        if (!/\btriage:draft\b/i.test(commentBody)) return Response.json({ queued: "ignored", event, action });
        return queueTriage(env, deliveryId, {
          number: issue.number,
          title: String(issue.title || ""),
          body: `${issue.body || ""}\n${commentBody}`,
          user: comment.user || issue.user,
        });
      }
      if (event === "pull_request" && action === "closed") {
        const pr = payload.pull_request as { merged?: boolean; head?: { ref?: string } };
        const head = String(pr.head?.ref || "");
        const issueNumber = Number(head.match(/^bot\/issue-(\d+)$/)?.[1]);
        if (pr.merged || !Number.isInteger(issueNumber) || issueNumber <= 0) return Response.json({ queued: "ignored", event, action });
        const github = liveGithubPort(env);
        await github.deleteBranch?.(head).catch(() => undefined);
        await github.reopenIssue?.(issueNumber);
        return Response.json({ queued: "carrier-reset", issue: issueNumber, head });
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
  async scheduled(event: { scheduledTime?: number }, env: WorkerEnv): Promise<void> {
    await runIssueSweep(env, Number(event.scheduledTime) || Date.now());
  },
};

export async function runIssueSweep(env: WorkerEnv, scheduledTime = Date.now()): Promise<{ closed: number; queued: number; needsHuman: number }> {
  const github = liveGithubPort(env);
  if (!github.listOpenIssues || !github.listComments) return { closed: 0, queued: 0, needsHuman: 0 };
  const open = await github.listOpenIssues();
  const issues: SweepIssue[] = [];
  for (const issue of open) {
    const comments = await github.listComments(issue.number);
    const head = `bot/issue-${issue.number}`;
    const hasHead = github.hasBranch ? await github.hasBranch(head) : false;
    const [openPr, linkedPr] = await Promise.all([
      github.findOpenPrForHead ? github.findOpenPrForHead(head) : Promise.resolve(null),
      github.findOpenPrForIssue ? github.findOpenPrForIssue(issue.number) : Promise.resolve(null),
    ]);
    const hasOpenPr = openPr ? true : github.hasOpenPrForHead ? await github.hasOpenPrForHead(head) : false;
    issues.push({ ...issue, state: "open", comments, hasHead, hasOpenPr, openPr, linkedPr });
  }
  const actions = planSweep(issues, scheduledTime);
  let closed = 0;
  let queued = 0;
  let needsHuman = 0;
  for (const action of actions) {
    if (action.action === "close-duplicate" && github.closeIssue) {
      await github.closeIssue(action.number, formatDuplicateClose(action.keep, action.fingerprint));
      closed += 1;
    }
    if (action.action === "close-issue-to-pr" && github.closeIssue) {
      await github.closeIssue(action.number, formatIssueTransferredToPr(action.prNumber));
      closed += 1;
    }
    if (action.action === "close-human-boundary" && github.closeIssue) {
      await github.closeIssue(action.number, formatHumanBoundaryClose());
      closed += 1;
      needsHuman += 1;
    }
    if (action.action === "close-placeholder-pr" && github.closePr && github.closeIssue) {
      await github.comment(action.prNumber, formatPlaceholderPrClose(action.number));
      await github.closePr(action.prNumber);
      await github.labelIssue(action.number, ["triage:needs-human"]);
      await github.closeIssue(action.number, formatPlaceholderPrClose(action.number));
      closed += 2;
      needsHuman += 1;
    }
    if (action.action === "needs-human") {
      await github.labelIssue(action.number, ["triage:needs-human"]);
      await github.comment(action.number, formatRetryExhausted(action.attempts));
      needsHuman += 1;
    }
    if (action.action === "queue") {
      const issue = issues.find((row) => row.number === action.number);
      if (!issue) continue;
      const response = await queueTriage(env, sweepLeaseId(issue.number, scheduledTime), {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        user: { login: issue.author },
        labels: issue.labels,
      });
      if (response.ok) queued += 1;
    }
  }
  return { closed, queued, needsHuman };
}
