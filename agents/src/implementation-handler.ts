import { validateImplementationFiles, verifyImplementationGrant } from "./implementation-submission";
import { productFilesOnBranch } from "./orchestrate";
import { liveGithubPort } from "./ports";
import type { AgentsEnv } from "./workflows";

export async function acceptImplementationSubmission(request: Request, env: AgentsEnv): Promise<Response> {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    const grant = await verifyImplementationGrant(env.GITHUB_WEBHOOK_SECRET || "", token);
    const body = await request.json() as { files?: unknown };
    const files = validateImplementationFiles(body.files);
    const github = liveGithubPort(env);
    if (!github.listBranchFiles || !github.commitFiles) throw new Error("implementation transport is unavailable");
    const existing = productFilesOnBranch(await github.listBranchFiles(grant.submissionHead));
    if (existing.length) return Response.json({ accepted: false, error: "submission branch already has product files" }, { status: 409 });
    const commit = await github.commitFiles(grant.submissionHead, {
      message: `fix: implement issue #${grant.issueNumber}`,
      files,
    });
    console.log("implementation_submission_accepted", { issue: grant.issueNumber, head: grant.submissionHead, commit: commit.sha, files: files.map((file) => file.path) });
    return Response.json({ accepted: true, issue: grant.issueNumber, head: grant.submissionHead, commit: commit.sha, files: files.map((file) => file.path) });
  } catch (error) {
    console.warn("implementation_submission_rejected", { error: error instanceof Error ? error.message : String(error) });
    return Response.json({ accepted: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
