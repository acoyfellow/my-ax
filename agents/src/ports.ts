import { assertNoMergeAction, usableIssueLabels, type TerrariumReceipt } from "./policy";
import { assertPublicText } from "./public-text";
import type { GithubPort, TerrariumPort } from "./orchestrate";
import type { AgentsEnv } from "./workflows";

export function liveGithubPort(env: AgentsEnv & { GITHUB_TOKEN?: string; GITHUB_REPO?: string }): GithubPort {
  const token = env.GITHUB_TOKEN?.trim();
  const repo = env.GITHUB_REPO?.trim() || "acoyfellow/my-ax";
  async function gh(path: string, init?: RequestInit): Promise<unknown> {
    if (!token) throw new Error("GITHUB_TOKEN is required for live GitHub ports");
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "my-ax-agents",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`github ${path} ${res.status}`);
    return json;
  }
  return {
    async labelIssue(number, labels) {
      assertNoMergeAction("label");
      const usable = usableIssueLabels(labels);
      if (!usable.length) return;
      await gh(`/issues/${number}/labels`, { method: "POST", body: JSON.stringify({ labels: usable }) });
    },
    async comment(number, body) {
      assertNoMergeAction("comment");
      await gh(`/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body: assertPublicText(body) }) });
    },
    async listComments(number) {
      assertNoMergeAction("listComments");
      const json = await gh(`/issues/${number}/comments?per_page=100`);
      return (Array.isArray(json) ? json : []).map((row) => String((row as { body?: string }).body || ""));
    },
    async hasBranch(name) {
      assertNoMergeAction("hasBranch");
      try {
        await gh(`/git/ref/heads/${encodeURIComponent(name)}`);
        return true;
      } catch {
        return false;
      }
    },
    async createBranch(name, seed) {
      assertNoMergeAction("createBranch");
      const main = await gh("/git/ref/heads/main") as { object?: { sha?: string } };
      const sha = main.object?.sha;
      if (!sha) throw new Error("main ref has no sha");
      await gh("/git/refs", {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${name}`, sha }),
      });
      if (!seed) return;
      await gh(`/contents/${encodeURI(seed.path)}`, {
        method: "PUT",
        body: JSON.stringify({
          message: assertPublicText(seed.message),
          content: btoa(unescape(encodeURIComponent(assertPublicText(seed.content)))),
          branch: name,
        }),
      });
    },
    async hasOpenPrForHead(head) {
      assertNoMergeAction("hasOpenPrForHead");
      const owner = repo.split("/")[0];
      const json = await gh(`/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&per_page=1`);
      return Array.isArray(json) && json.length > 0;
    },
    async listPullFiles(number) {
      assertNoMergeAction("listPullFiles");
      const json = await gh(`/pulls/${number}/files?per_page=100`);
      return (Array.isArray(json) ? json : []).map((row) => String((row as { filename?: string }).filename || "")).filter(Boolean);
    },
    async listBranchFiles(head) {
      assertNoMergeAction("listBranchFiles");
      const json = await gh(`/compare/main...${encodeURIComponent(head)}`);
      const files = (json as { files?: Array<{ filename?: string }> }).files ?? [];
      return files.map((row) => String(row.filename || "")).filter(Boolean);
    },
    async commitsBehindMain(headSha) {
      assertNoMergeAction("commitsBehindMain");
      const json = await gh(`/compare/main...${encodeURIComponent(headSha)}`);
      const behind = Number((json as { behind_by?: number }).behind_by);
      return Number.isFinite(behind) && behind >= 0 ? behind : -1;
    },
    async openReadyPr(input) {
      assertNoMergeAction("openReadyPr");
      const json = await gh("/pulls", {
        method: "POST",
        body: JSON.stringify({ title: assertPublicText(input.title), body: assertPublicText(input.body), head: input.head, base: "main", draft: false }),
      });
      return { number: Number((json as { number?: number }).number) };
    },
    async mergePr() {
      assertNoMergeAction("merge");
    },
    async approvePr() {
      assertNoMergeAction("approve");
    },
    async closePr(number) {
      assertNoMergeAction("closePr");
      await gh(`/pulls/${number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
    },
    async requestChanges(number, body) {
      assertNoMergeAction("requestChanges");
      await gh(`/pulls/${number}/reviews`, {
        method: "POST",
        body: JSON.stringify({ body: assertPublicText(body), event: "REQUEST_CHANGES" }),
      });
    },
    async listOpenIssues() {
      assertNoMergeAction("listOpenIssues");
      const json = await gh("/issues?state=open&per_page=40");
      return (Array.isArray(json) ? json : [])
        .filter((row) => !(row as { pull_request?: unknown }).pull_request)
        .map((row) => ({
          number: Number((row as { number?: number }).number),
          title: String((row as { title?: string }).title || ""),
          body: String((row as { body?: string }).body || ""),
          author: String((row as { user?: { login?: string } }).user?.login || "unknown"),
        }));
    },
    async closeIssue(number, body) {
      assertNoMergeAction("closeIssue");
      if (body) {
        await gh(`/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body: assertPublicText(body) }) });
      }
      await gh(`/issues/${number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
    },
  };
}

export function liveTerrariumPort(env: AgentsEnv): TerrariumPort {
  const base = env.TERRARIUM_URL?.replace(/\/+$/, "");
  const token = env.TERRARIUM_CONTROL_TOKEN;
  async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    if (!base || !token) throw new Error("TERRARIUM_URL and TERRARIUM_CONTROL_TOKEN are required");
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init?.body ? { "idempotency-key": crypto.randomUUID() } : {}),
      },
    });
    return (await res.json()) as Record<string, unknown>;
  }
  return {
    async spawn(task, taskProof) {
      const proof = taskProof.trim();
      if (!proof) throw new Error("Terrarium spawn needs a host taskProof");
      const json = await call("/api/runs", { method: "POST", body: JSON.stringify({ task, taskProof: proof }) });
      const contract = (json.contract ?? json) as Record<string, string>;
      return {
        runId: String(contract.runId ?? json.runId),
        taskFingerprint: String(contract.taskFingerprint ?? ""),
        nonce: String(contract.nonce ?? ""),
        taskProof: proof,
      };
    },
    async wait(runId) {
      const started = Date.now();
      const budgetMs = 8 * 60_000;
      while (true) {
        const json = await call(`/api/runs/${encodeURIComponent(runId)}/status`);
        const status = (json.status ?? json) as Record<string, unknown>;
        const terminal = (status.terminal ?? {}) as Record<string, unknown>;
        const name = String(status.status ?? "");
        if (name === "done" || name === "failed" || name === "cancelled" || Date.now() - started > budgetMs) {
          return {
            runId,
            taskFingerprint: String(terminal.taskFingerprint ?? ""),
            nonce: String(terminal.nonce ?? ""),
            ok: name === "done" && terminal.ok === true,
            taskContractStatus: String(terminal.taskContractStatus ?? ""),
          } satisfies TerrariumReceipt;
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    },
  };
}
