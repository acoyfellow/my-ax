import assert from "node:assert/strict";
import test from "node:test";
import {
  activeToken,
  builtinCommands,
  connectorCommands,
  dedupeTriggers,
  encodeMention,
  extractMentions,
  laptopCommands,
  parseSlashInput,
  rankCommands,
  recipeCommands,
  skillCommands,
  usageScore,
} from "./registry";
import { draftSkillFromTranscript, parseSkillMarkdown, SkillError, SkillService, skillInjection, skillMarkdown, validateSkillDraft, type SkillRow } from "./skills";
import { expandMessage } from "./expand";
import { rankFilePaths } from "./mention-sources";
import { argsFromFields, schemaFields } from "../connector-explore";
import { normalizeMcpDisplayName } from "../oauth-store-names";

const NOW = Date.parse("2026-11-08T12:00:00Z");

test("the registry merges built-ins, recipes, skills, connector tools and laptop tools into one shape", () => {
  const all = [
    ...builtinCommands(),
    ...recipeCommands([{ id: "r1", name: "Deploy Check", description: "check prod", inputSchema: { type: "object", properties: { env: { type: "string" } }, required: ["env"] }, status: "enabled" }]),
    ...skillCommands([{ id: "s1", name: "standup", description: "write my standup" }]),
    ...connectorCommands([{ server: "cloudflare", serverLabel: "Terrarium", tool: "terrarium_list", description: "list runs", inputSchema: {}, connected: true }]),
    ...laptopCommands([{ name: "screenshot", description: "take one", inputSchema: {} }], false),
  ];
  const kinds = new Set(all.map((command) => command.kind));
  assert.deepEqual([...kinds].sort(), ["builtin", "connector", "laptop", "recipe", "skill"]);
  const recipe = all.find((command) => command.kind === "recipe")!;
  assert.equal(recipe.trigger, "deploy-check");
  assert.deepEqual(recipe.requiredArgs, ["env"]);
  assert.equal(recipe.runsOnEnter, false);
  assert.equal(all.find((command) => command.kind === "connector")!.trigger, "terrarium.terrarium_list");
  const laptop = all.find((command) => command.kind === "laptop")!;
  assert.equal(laptop.available, false);
  assert.equal(laptop.unavailableReason, "laptop is offline");
});

test("a recipe with no required inputs runs on Enter, and a disabled one is shown but unavailable", () => {
  const [ready, pending] = recipeCommands([
    { id: "a", name: "ping", description: "", inputSchema: { type: "object", properties: {} }, status: "enabled" },
    { id: "b", name: "draft", description: "", inputSchema: {}, status: "pending" },
  ]);
  assert.equal(ready.runsOnEnter, true);
  assert.equal(pending.available, false);
  assert.equal(pending.unavailableReason, "recipe is pending");
});

test("ranking puts an exact trigger first, then prefix matches, and drops non-matches", () => {
  const commands = [...builtinCommands(), ...skillCommands([{ id: "s", name: "newsletter", description: "" }])];
  const ranked = rankCommands(commands, "new", [], NOW);
  assert.equal(ranked[0].trigger, "new");
  assert.equal(ranked[1].trigger, "newsletter");
  assert.ok(ranked.every((command) => command.trigger.includes("n") || `${command.title} ${command.description}`.toLowerCase().includes("new")));
  assert.ok(ranked.some((command) => command.trigger === "fork"), "fork matches through its description");
  assert.ok(!ranked.some((command) => command.trigger === "archive"), "archive does not match new at all");
  assert.equal(rankCommands(commands, "zzzz", [], NOW).length, 0);
});

test("recent, frequent use lifts a command above an equally good match", () => {
  const commands = skillCommands([{ id: "a", name: "alpha", description: "" }, { id: "b", name: "alps", description: "" }]);
  const ranked = rankCommands(commands, "al", [{ command_id: "skill:b", uses: 9, last_used_at: "2026-11-08 11:00:00" }], NOW);
  assert.equal(ranked[0].trigger, "alps");
  assert.ok(usageScore({ command_id: "x", uses: 9, last_used_at: "2026-11-08 11:00:00" }, NOW) > usageScore({ command_id: "x", uses: 9, last_used_at: "2026-09-01 11:00:00" }, NOW));
});

test("two sources with the same trigger both stay reachable", () => {
  const deduped = dedupeTriggers([...skillCommands([{ id: "s", name: "deploy", description: "" }]), ...recipeCommands([{ id: "r", name: "deploy", description: "", inputSchema: {}, status: "enabled" }])]);
  assert.deepEqual(deduped.map((command) => command.trigger), ["deploy", "deploy-2"]);
});

test("slash input parses the trigger, key:value arguments and the remaining text", () => {
  assert.deepEqual(parseSlashInput('/deploy-check env:prod note:"two words" and then report'), { trigger: "deploy-check", args: { env: "prod", note: "two words" }, rest: "and then report" });
  assert.equal(parseSlashInput("not a command"), null);
  assert.deepEqual(parseSlashInput("/new"), { trigger: "new", args: {}, rest: "" });
});

test("the composer only opens the menu for a slash at the line start or an @ after a space", () => {
  assert.deepEqual(activeToken("/dep", 4), { kind: "slash", query: "dep", start: 0, end: 4 });
  assert.deepEqual(activeToken("line one\n/sk", 12), { kind: "slash", query: "sk", start: 9, end: 12 });
  assert.equal(activeToken("a/b", 3), null);
  assert.deepEqual(activeToken("see @rea", 8), { kind: "mention", query: "rea", start: 4, end: 8 });
  assert.equal(activeToken("mail@host", 9), null);
});

test("mention pills round-trip and render as plain @labels in the sent text", () => {
  const pill = encodeMention({ kind: "file", ref: "notes/plan.md", label: "plan.md" });
  const { text, mentions } = extractMentions(`read ${pill} please`);
  assert.equal(text, "read @plan.md please");
  assert.deepEqual(mentions, [{ kind: "file", ref: "notes/plan.md", label: "plan.md" }]);
});

test("a skill is validated, exported to markdown and parsed back unchanged", () => {
  const draft = validateSkillDraft({ name: "Weekly Standup", description: "Write my standup", instructions: "List done, doing, blocked.", allowedTools: ["jira_search"] });
  assert.equal(draft.name, "weekly-standup");
  const markdown = skillMarkdown({ id: "x", ...draft, allowedTools: draft.allowedTools ?? [], sourceSessionId: null, createdAt: "", updatedAt: "" });
  const parsed = parseSkillMarkdown(markdown);
  assert.equal(parsed.name, "weekly-standup");
  assert.equal(parsed.description, "Write my standup");
  assert.equal(parsed.instructions, "List done, doing, blocked.");
  assert.deepEqual(parsed.allowedTools, ["jira_search"]);
  assert.throws(() => validateSkillDraft({ name: "x", description: "", instructions: "y" }), SkillError);
});

test("skill instructions apply to one turn and state they grant nothing extra", () => {
  const injected = skillInjection({ name: "standup", instructions: "Be brief.", allowedTools: [] }, "for monday");
  assert.match(injected, /^<skill-invocation name="standup">/);
  assert.match(injected, /do not grant any tool or capability/);
  assert.ok(injected.endsWith("for monday"));
});

test("expanding /skill-name swaps in the skill, quotes @chat, and keeps @file as an attachment", async () => {
  const skill = { id: "s1", name: "standup", description: "d", instructions: "Be brief.", allowedTools: [], sourceSessionId: null, createdAt: "", updatedAt: "" };
  const expanded = await expandMessage(
    `/standup day:monday ${encodeMention({ kind: "chat", ref: "c1", label: "Planning" })} ${encodeMention({ kind: "file", ref: "a/b.md", label: "b.md" })}`,
    { skill: async (name) => (name === "standup" ? skill : null), chat: async (id) => (id === "c1" ? { name: "Planning", turns: [{ role: "user", text: "ship friday" }] } : null) },
    skillInjection,
  );
  assert.equal(expanded.skill?.id, "s1");
  assert.deepEqual(expanded.files, ["a/b.md"]);
  assert.match(expanded.text, /<referenced-conversation name="Planning">\nOwner: ship friday/);
  assert.match(expanded.text, /<skill-invocation name="standup">/);
  assert.match(expanded.text, /day: monday/);
});

test("an unknown /trigger or a missing mention is left alone and reported", async () => {
  const expanded = await expandMessage(`/nothing here ${encodeMention({ kind: "chat", ref: "gone", label: "Old" })}`, { skill: async () => null, chat: async () => null }, skillInjection);
  assert.equal(expanded.skill, null);
  assert.equal(expanded.text, "/nothing here @Old");
  assert.equal(expanded.unresolved.length, 1);
});

test("saving a conversation as a skill drafts steps from the owner's requests", () => {
  const draft = draftSkillFromTranscript("Release notes", [{ role: "user", text: "collect merged PRs" }, { role: "assistant", text: "Here are 4 PRs" }, { role: "user", text: "write notes" }]);
  assert.equal(draft.name, "release-notes");
  assert.match(draft.instructions, /1\. collect merged PRs\n2\. write notes/);
  assert.match(draft.instructions, /Here are 4 PRs/);
});

function fakeDb() {
  const rows: SkillRow[] = [];
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async all<T>() {
              return { results: rows.filter((row) => row.owner_email === values[0]) as unknown as T[] };
            },
            async first<T>() {
              if (sql.includes("WHERE id = ?")) return (rows.find((row) => row.id === values[0] && row.owner_email === values[1]) ?? null) as T | null;
              return (rows.find((row) => row.name === values[0] && row.owner_email === values[1]) ?? null) as T | null;
            },
            async run() {
              if (sql.startsWith("INSERT")) rows.push({ id: String(values[0]), owner_email: String(values[1]), name: String(values[2]), description: String(values[3]), instructions: String(values[4]), allowed_tools_json: String(values[5]), source_session_id: values[6] as string | null, created_at: String(values[7]), updated_at: String(values[8]) });
              if (sql.startsWith("DELETE")) rows.splice(rows.findIndex((row) => row.id === values[0]), 1);
              return {};
            },
          };
        },
      };
    },
  };
}

test("skills are owner-scoped and a duplicate name is refused", async () => {
  const db = fakeDb();
  let n = 0;
  const mine = new SkillService(db, "Me@Example.com", () => new Date(NOW), () => `id-${++n}`);
  const theirs = new SkillService(db, "other@example.com", () => new Date(NOW), () => `id-${++n}`);
  await mine.create({ name: "standup", description: "d", instructions: "i" });
  await assert.rejects(mine.create({ name: "Standup", description: "d", instructions: "i" }), (error: unknown) => error instanceof SkillError && error.code === "Conflict");
  assert.equal((await theirs.list()).length, 0);
  await assert.rejects(theirs.get("id-1"), (error: unknown) => error instanceof SkillError && error.code === "NotFound");
  assert.equal((await mine.list())[0].name, "standup");
});

test("@file search prefers basename matches and skips dependency folders", () => {
  const ranked = rankFilePaths(["src/plan.md", "docs/old/plan-notes.md", "node_modules/x/plan.md", "README.md"], "plan");
  assert.deepEqual(ranked, ["src/plan.md", "docs/old/plan-notes.md"]);
});

test("the explorer turns a tool schema into form fields and back into typed arguments", () => {
  const fields = schemaFields({ type: "object", properties: { q: { type: "string", description: "query" }, limit: { type: "integer" }, deep: { type: "boolean" }, filter: { type: "object" } }, required: ["q"] });
  assert.deepEqual(fields.map((field) => `${field.name}:${field.type}:${field.required}`), ["q:string:true", "limit:integer:false", "deep:boolean:false", "filter:json:false"]);
  assert.deepEqual(argsFromFields(fields, { q: "hi", limit: "5", deep: "true", filter: '{"a":1}' }), { ok: true, args: { q: "hi", limit: 5, deep: true, filter: { a: 1 } } });
  assert.deepEqual(argsFromFields(fields, { limit: "5" }), { ok: false, field: "q", error: "q is required" });
  assert.deepEqual(argsFromFields(fields, { q: "x", limit: "2.5" }), { ok: false, field: "limit", error: "limit must be a whole number" });
});

test("an MCP display name is trimmed, collapsed and length-limited", () => {
  assert.equal(normalizeMcpDisplayName("  Terrarium \n box "), "Terrarium box");
  assert.equal(normalizeMcpDisplayName("   "), null);
  assert.equal(normalizeMcpDisplayName("x".repeat(61)), null);
});
