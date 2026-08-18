import { assertNoMergeAction, usableIssueLabels, type TerrariumReceipt } from "./policy";
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
      await gh(`/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
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
    async listPullFiles(number) {
      assertNoMergeAction("listPullFiles");
      const json = await gh(`/pulls/${number}/files?per_page=100`);
      return (Array.isArray(json) ? json : []).map((row) => String((row as { filename?: string }).filename || "")).filter(Boolean);
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
        body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: "main", draft: false }),
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
        body: JSON.stringify({ body, event: "REQUEST_CHANGES" }),
      });
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
    async spawn(task) {
      const json = await call("/api/runs", { method: "POST", body: JSON.stringify({ task }) });
      const contract = (json.contract ?? json) as Record<string, string>;
      return {
        runId: String(contract.runId ?? json.runId),
        taskFingerprint: String(contract.taskFingerprint ?? ""),
        nonce: String(contract.nonce ?? ""),
      };
    },
    async wait(runId) {
      const json = await call(`/api/runs/${encodeURIComponent(runId)}/status`);
      const status = (json.status ?? json) as Record<string, unknown>;
      const terminal = (status.terminal ?? {}) as Record<string, unknown>;
      const receipt: TerrariumReceipt = {
        runId,
        taskFingerprint: String(terminal.taskFingerprint ?? ""),
        nonce: String(terminal.nonce ?? ""),
        ok: status.status === "done" && terminal.ok === true,
        taskContractStatus: String(terminal.taskContractStatus ?? ""),
      };
      return receipt;
    },
  };
}
