export const DEFAULT_AGENTS_MODEL = "grok-4.6";

export type IssueKind = "bug" | "enhancement" | "docs" | "spray" | "question" | "unknown";
export type Severity = "p0" | "p1" | "p2" | "p3";
export type DigDecision = "classify-only" | "draft" | "dig";
export type VisualLane = "none" | "public-web" | "owner-device";

export interface Classification {
  kind: IssueKind;
  severity: Severity;
  spray: boolean;
  draft: boolean;
  dig: DigDecision;
  visual: VisualLane;
  labels: string[];
  summary: string;
}

export interface VisualDiffTiers {
  A: boolean;
  B: boolean;
  C: boolean | null;
  S?: boolean;
  R?: boolean;
}

export interface VisualProof {
  lane: VisualLane;
  kind: "screenshot" | "video" | "visual-diff" | "none";
  url?: string;
  bytes?: number;
  note?: string;
  engine?: "vitest-visual-diff";
  pass?: boolean;
  tiers?: VisualDiffTiers;
}

export interface IssueInput {
  title: string;
  body: string;
  author: string;
  authorAssociation?: string;
  filesHint?: string[];
}

export interface PullInput {
  title: string;
  body: string;
  author: string;
  draft: boolean;
  headSha: string;
  files: string[];
  behindMain: number;
}

export interface AuditReceipt {
  headSha: string;
  promptDigest: string;
  recommendation: "merge-after-human" | "close" | "rebase" | "needs-human";
  neverApprove: true;
  neverMerge: true;
  findings: string[];
}

export interface TerrariumReceipt {
  runId: string;
  taskFingerprint: string;
  nonce: string;
  ok: boolean;
  taskContractStatus?: string;
  visual?: VisualProof;
}

const SPRAY_AUTHORS = new Set(["driveby-docs", "webbrain-one"]);
const SPRAY_TITLES = [/docs:\s*(add|improve)\s+readme/i, /add\s+\w+\s+readme/i];

export function resolveAgentsModel(env: { AGENTS_MODEL?: string }): string {
  const value = env.AGENTS_MODEL?.trim();
  return value && value.length > 0 ? value : DEFAULT_AGENTS_MODEL;
}

export function requireGateway(env: { LLM_GATEWAY_URL?: string; LLM_GATEWAY_TOKEN?: string }): void {
  if (!env.LLM_GATEWAY_URL?.trim() || !env.LLM_GATEWAY_TOKEN?.trim()) {
    throw new Error("LLM_GATEWAY_URL and LLM_GATEWAY_TOKEN are required; agents never call Workers AI");
  }
}

export function classifyIssue(input: IssueInput): Classification {
  const text = `${input.title}\n${input.body}`;
  const spray = isSpray(input);
  if (spray) {
    return {
      kind: "spray",
      severity: "p3",
      spray: true,
      draft: false,
      dig: "classify-only",
      visual: "none",
      labels: ["triage:spray"],
      summary: "Drive-by docs/translation spray; comment and stop.",
    };
  }
  const docs = /readme|docs?:|documentation|translation|spanish|i18n/i.test(text) && !/bug|repro|fail/i.test(text);
  if (docs) {
    return {
      kind: "docs",
      severity: "p3",
      spray: false,
      draft: false,
      dig: "classify-only",
      visual: "none",
      labels: ["docs"],
      summary: "Docs-only; one English README is source of truth.",
    };
  }
  const bug = /bug|fail|repro|regression|broken|error|dies|tts|voice/i.test(text);
  const hard = /hours|complex|investigate|root cause|across (many|multiple)|needs a cell|terrarium/i.test(text)
    || (input.body?.length ?? 0) > 2_000;
  const visual = visualLane(text);
  if (bug && hard) {
    return {
      kind: "bug",
      severity: "p1",
      spray: false,
      draft: false,
      dig: "dig",
      visual,
      labels: visual === "owner-device" ? ["bug", "triage:dig", "needs-owner-video"] : ["bug", "triage:dig"],
      summary: visual === "owner-device"
        ? "Hard bug on a device the cell cannot see. Park for owner photo/video."
        : "Hard bug; spawn Terrarium and require screenshot or video on the receipt.",
    };
  }
  if (bug) {
    const opted = /\btriage:draft\b/i.test(text);
    return {
      kind: "bug",
      severity: "p2",
      spray: false,
      draft: opted && visual !== "owner-device",
      dig: opted && visual !== "owner-device" ? "draft" : "classify-only",
      visual,
      labels: opted ? ["bug", "triage:draft"] : ["bug"],
      summary: opted ? "Opted-in draft PR." : "Bug labeled; draft only with triage:draft.",
    };
  }
  return {
    kind: "unknown",
    severity: "p3",
    spray: false,
    draft: false,
    dig: "classify-only",
    visual: "none",
    labels: ["triage:needs-human"],
    summary: "Needs a human label.",
  };
}

export function isSpray(input: IssueInput): boolean {
  if (SPRAY_AUTHORS.has(input.author.toLowerCase())) return true;
  return SPRAY_TITLES.some((re) => re.test(input.title));
}

export function shouldOpenDraft(classification: Classification): boolean {
  return classification.draft && !classification.spray && classification.dig !== "dig";
}

export function shouldSpawnDig(classification: Classification): boolean {
  return classification.dig === "dig" && classification.visual !== "owner-device";
}

export function visualLane(text: string): VisualLane {
  if (/ios|iphone|pwa|lock.?screen|mic|voice|tts|accessibility|tcc|screenshot from (the )?mac/i.test(text)) {
    return "owner-device";
  }
  if (/ui|css|page|browser|render|drawer|button|screenshot|video|demo/i.test(text)) return "public-web";
  return "none";
}

export function acceptVisualProof(lane: VisualLane, proof: VisualProof | undefined): boolean {
  if (lane === "none") return true;
  if (lane === "owner-device") return false;
  if (!proof) return false;
  if (proof.lane !== "public-web") return false;
  if (proof.engine !== "vitest-visual-diff" || proof.kind !== "visual-diff") return false;
  if (proof.pass !== true || !proof.tiers) return false;
  return proof.tiers.A === true && proof.tiers.B === true && proof.tiers.C !== false;
}

export function verifyTerrariumReceipt(expected: { runId: string; taskFingerprint: string; nonce: string }, got: TerrariumReceipt): boolean {
  return got.ok === true
    && got.runId === expected.runId
    && got.taskFingerprint === expected.taskFingerprint
    && got.nonce === expected.nonce
    && got.taskContractStatus !== "unproven";
}

export function auditPull(input: PullInput, promptDigest: string): AuditReceipt {
  const findings: string[] = [];
  if (input.behindMain > 0) findings.push(`behind main by ${input.behindMain} commits; rebase before land`);
  if (isSpray({ title: input.title, body: input.body, author: input.author })) {
    return {
      headSha: input.headSha,
      promptDigest,
      recommendation: "close",
      neverApprove: true,
      neverMerge: true,
      findings: ["matches spray pattern; close as declined"],
    };
  }
  if (/superseded|already landed|89882a7/i.test(input.body)) {
    return {
      headSha: input.headSha,
      promptDigest,
      recommendation: "close",
      neverApprove: true,
      neverMerge: true,
      findings: ["incomplete or superseded; do not merge over a stricter main fix"],
    };
  }
  if (input.draft) findings.push("still a draft");
  return {
    headSha: input.headSha,
    promptDigest,
    recommendation: findings.some((f) => f.startsWith("behind")) ? "rebase" : "merge-after-human",
    neverApprove: true,
    neverMerge: true,
    findings,
  };
}

export function forbiddenGitHubWrites(): readonly string[] {
  return ["merge", "approve", "admin", "delete_repo", "workflows"];
}

export function assertNoMergeAction(action: string): void {
  if (/merge|approve/i.test(action)) {
    throw new Error(`forbidden GitHub action: ${action}`);
  }
}
