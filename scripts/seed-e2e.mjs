import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const output = resolve(process.argv[2] ?? ".wrangler/e2e-fixture.sql");
const sessionId = "e2e-design-conversation";
const owner = "dev@localhost";
const base = Date.parse("2026-09-10T08:45:00.000Z");

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => sqlString(JSON.stringify(value));

const entries = [
  { role: "user", content: "Can you audit the authentication boundary and tell me what an agent certificate would actually prove?" },
  { role: "assistant", content: "Yes. I’ll separate **identity**, **delegated authority**, and **execution evidence** so a certificate does not become a proxy for human approval.\n\n### Working model\n\n| Principal | What it proves | What it does not prove |\n|---|---|---|\n| Person | Account identity | Approval of every action |\n| Device | Enrolled key possession | Who is at the keyboard |\n| Agent | Calling workload | Permission for this operation |\n| Grant | Narrow delegated authority | Correctness of the result |" },
  { role: "tool", tool: "workspace_read", content: "src/auth.ts\n\nexport type AccessIdentity = {\n  email: string;\n  sub: string;\n};", meta: { toolCallId: "fixture-tool-read", args: { path: "src/auth.ts", line_start: 1, line_end: 8 } } },
  { role: "assistant", content: "The current boundary correctly derives the person from verified Access identity. The next useful step is introducing a distinct agent principal without converting it into a fake human identity." },
  { role: "user", content: "Could my agent collaborate with someone else’s agent without sharing either person’s credentials?" },
  { role: "assistant", content: "That is the strongest product direction.\n\n> The room is shared. Authority is personal. Work connects them.\n\nA request should remain pending until the assignee accepts it. Acceptance creates a narrow grant bound to the caller, audience, operation, argument digest, expiration, and single use." },
  { role: "tool", tool: "delegate_many", content: JSON.stringify({ status: "completed", tasks: [{ label: "threat-model", outcome: "identified 3 trust boundaries" }, { label: "product-flow", outcome: "drafted accept/decline handoff" }] }, null, 2), meta: { toolCallId: "fixture-tool-delegate", args: { tasks: ["Threat-model the handoff", "Draft the product flow"] } } },
  { role: "assistant", content: "Two independent passes agree on the boundary:\n\n1. The shared room may request work.\n2. The assignee must accept before private authority is used.\n3. Credentials and unshared tool output stay private.\n4. Only an admitted result and its redacted receipt become room-visible.\n\n```text\nrequest → pending → accepted → running → completed | blocked | declined\n```" },
  { role: "user", content: "File an issue for the delegated-work failure." },
  { role: "tool", tool: "work_code", content: "Publication is unavailable inside this execution capability.", isError: true, meta: { toolCallId: "fixture-tool-error", args: { task: "Create a GitHub issue" } } },
  { role: "assistant", content: "I’m blocked from publishing through this capability. I can prepare the exact issue body, but I should not claim the issue was filed without a mutation receipt." },
  { role: "user", content: "Before we deploy, show me how this whole conversation feels in the redesigned interface—including long text, tools, failures, and receipts." },
  { role: "assistant", content: "This local conversation is a deterministic design fixture backed by the real local D1 transcript path. Reloading, switching conversations, scrolling, tool expansion, dark mode, and responsive layout can be tested without touching production data.\n\n**Environment receipt**\n\n- Identity: `dev@localhost`\n- Storage: isolated local Wrangler state\n- Production access: none\n- Container execution: disabled\n- Fixture: `e2e-design-conversation`" },
];

const statements = [
  "PRAGMA foreign_keys = ON;",
  `DELETE FROM conversation_entries WHERE session_id = ${sqlString(sessionId)} AND owner_email = ${sqlString(owner)};`,
  `DELETE FROM sessions WHERE id = ${sqlString(sessionId)} AND owner_email = ${sqlString(owner)};`,
  `INSERT INTO sessions (id, name, stable_name, status, owner_email, created_at, updated_at) VALUES (${sqlString(sessionId)}, ${sqlString("Design test · Agent authority")}, ${sqlString("e2e-design-conversation")}, 'active', ${sqlString(owner)}, ${sqlString(new Date(base).toISOString())}, ${sqlString(new Date(base + entries.length * 60_000).toISOString())});`,
  ...entries.map((entry, index) => {
    const ts = new Date(base + index * 60_000).toISOString();
    return `INSERT INTO conversation_entries (session_id, owner_email, ts, role, tool, is_error, content, meta_json, sequence_number) VALUES (${sqlString(sessionId)}, ${sqlString(owner)}, ${sqlString(ts)}, ${sqlString(entry.role)}, ${entry.tool ? sqlString(entry.tool) : "NULL"}, ${entry.isError ? 1 : 0}, ${sqlString(entry.content)}, ${entry.meta ? json(entry.meta) : "NULL"}, ${index + 1});`;
  }),
];

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${statements.join("\n")}\n`);
process.stdout.write(`${output}\n`);
