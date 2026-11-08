export type CommandKind = "builtin" | "recipe" | "skill" | "connector" | "laptop";

export type CommandAction =
  | { type: "client"; name: BuiltinName }
  | { type: "recipe"; recipeId: string }
  | { type: "skill"; skillId: string }
  | { type: "connector"; server: string; tool: string }
  | { type: "laptop"; tool: string };

export type Command = {
  id: string;
  kind: CommandKind;
  trigger: string;
  title: string;
  description: string;
  inputSchema: unknown;
  requiredArgs: string[];
  available: boolean;
  unavailableReason: string | null;
  runsOnEnter: boolean;
  action: CommandAction;
  score: number;
};

export const BUILTIN_NAMES = ["new", "fork", "model", "archive", "export", "voice", "rename", "skill-new", "skill-save", "tools"] as const;

export type BuiltinName = (typeof BUILTIN_NAMES)[number];

const BUILTIN_COPY: Record<BuiltinName, { title: string; description: string; runsOnEnter: boolean; requiredArgs: string[] }> = {
  new: { title: "New conversation", description: "Start a fresh conversation", runsOnEnter: true, requiredArgs: [] },
  fork: { title: "Fork", description: "Copy this conversation into a new one", runsOnEnter: true, requiredArgs: [] },
  model: { title: "Switch model", description: "Pick the model for this conversation", runsOnEnter: false, requiredArgs: ["model"] },
  archive: { title: "Archive", description: "Hide this conversation from the sidebar", runsOnEnter: true, requiredArgs: [] },
  export: { title: "Export markdown", description: "Download this conversation as markdown", runsOnEnter: true, requiredArgs: [] },
  voice: { title: "Voice", description: "Talk to this conversation", runsOnEnter: true, requiredArgs: [] },
  rename: { title: "Rename", description: "Rename this conversation", runsOnEnter: false, requiredArgs: ["name"] },
  "skill-new": { title: "New skill", description: "Write instructions you can call with /name", runsOnEnter: true, requiredArgs: [] },
  "skill-save": { title: "Save as skill", description: "Turn this conversation into a reusable skill", runsOnEnter: true, requiredArgs: [] },
  tools: { title: "Explore tools", description: "Browse every connected MCP, its tools, resources and prompts", runsOnEnter: true, requiredArgs: [] },
};

export function slugTrigger(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "command";
}

function requiredFromSchema(schema: unknown): string[] {
  if (!schema || typeof schema !== "object") return [];
  const required = (schema as { required?: unknown }).required;
  return Array.isArray(required) ? required.filter((name): name is string => typeof name === "string") : [];
}

function command(input: Omit<Command, "score" | "requiredArgs" | "runsOnEnter"> & { requiredArgs?: string[]; runsOnEnter?: boolean }): Command {
  const requiredArgs = input.requiredArgs ?? requiredFromSchema(input.inputSchema);
  return { ...input, requiredArgs, runsOnEnter: input.runsOnEnter ?? requiredArgs.length === 0, score: 0 };
}

export function builtinCommands(): Command[] {
  return BUILTIN_NAMES.map((name) => command({
    id: `builtin:${name}`,
    kind: "builtin",
    trigger: name,
    title: BUILTIN_COPY[name].title,
    description: BUILTIN_COPY[name].description,
    inputSchema: { type: "object", properties: Object.fromEntries(BUILTIN_COPY[name].requiredArgs.map((arg) => [arg, { type: "string" }])), required: BUILTIN_COPY[name].requiredArgs },
    requiredArgs: BUILTIN_COPY[name].requiredArgs,
    runsOnEnter: BUILTIN_COPY[name].runsOnEnter,
    available: true,
    unavailableReason: null,
    action: { type: "client", name },
  }));
}

export type RecipeSource = { id: string; name: string; description: string; inputSchema: unknown; status: string };

export function recipeCommands(recipes: RecipeSource[]): Command[] {
  return recipes.map((recipe) => command({
    id: `recipe:${recipe.id}`,
    kind: "recipe",
    trigger: slugTrigger(recipe.name),
    title: recipe.name,
    description: recipe.description,
    inputSchema: recipe.inputSchema,
    available: recipe.status === "enabled",
    unavailableReason: recipe.status === "enabled" ? null : `recipe is ${recipe.status}`,
    action: { type: "recipe", recipeId: recipe.id },
  }));
}

export type SkillSource = { id: string; name: string; description: string };

export function skillCommands(skills: SkillSource[]): Command[] {
  return skills.map((skill) => command({
    id: `skill:${skill.id}`,
    kind: "skill",
    trigger: slugTrigger(skill.name),
    title: skill.name,
    description: skill.description,
    inputSchema: { type: "object", properties: {} },
    requiredArgs: [],
    runsOnEnter: false,
    available: true,
    unavailableReason: null,
    action: { type: "skill", skillId: skill.id },
  }));
}

export type ConnectorToolSource = { server: string; serverLabel: string; tool: string; description: string; inputSchema: unknown; connected: boolean };

export function connectorCommands(tools: ConnectorToolSource[]): Command[] {
  return tools.map((tool) => command({
    id: `connector:${tool.server}:${tool.tool}`,
    kind: "connector",
    trigger: `${slugTrigger(tool.serverLabel)}.${slugTrigger(tool.tool)}`,
    title: `${tool.serverLabel} · ${tool.tool}`,
    description: tool.description,
    inputSchema: tool.inputSchema,
    runsOnEnter: false,
    available: tool.connected,
    unavailableReason: tool.connected ? null : `${tool.serverLabel} is not connected`,
    action: { type: "connector", server: tool.server, tool: tool.tool },
  }));
}

export type LaptopToolSource = { name: string; description: string; inputSchema: unknown };

export function laptopCommands(tools: LaptopToolSource[], connected: boolean): Command[] {
  return tools.map((tool) => command({
    id: `laptop:${tool.name}`,
    kind: "laptop",
    trigger: `mac.${slugTrigger(tool.name)}`,
    title: `Laptop · ${tool.name}`,
    description: tool.description,
    inputSchema: tool.inputSchema,
    runsOnEnter: false,
    available: connected,
    unavailableReason: connected ? null : "laptop is offline",
    action: { type: "laptop", tool: tool.name },
  }));
}

export type UsageRow = { command_id: string; uses: number; last_used_at: string };

export const USAGE_HALF_LIFE_DAYS = 7;

export function usageScore(row: UsageRow | undefined, now: number): number {
  if (!row) return 0;
  const ageDays = Math.max(0, (now - Date.parse(`${row.last_used_at.replace(" ", "T")}Z`)) / 86_400_000);
  return Math.log2(1 + row.uses) * Math.pow(0.5, ageDays / USAGE_HALF_LIFE_DAYS);
}

export function matchScore(command: Command, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const trigger = command.trigger.toLowerCase();
  if (trigger === q) return 100;
  if (trigger.startsWith(q)) return 60 - Math.min(20, trigger.length - q.length);
  if (trigger.split(/[._-]/).some((part) => part.startsWith(q))) return 40;
  const haystack = `${command.title} ${command.description}`.toLowerCase();
  if (haystack.includes(q)) return 20;
  let cursor = 0;
  for (const char of q) {
    cursor = trigger.indexOf(char, cursor);
    if (cursor < 0) return 0;
    cursor += 1;
  }
  return 10;
}

const KIND_ORDER: Record<CommandKind, number> = { builtin: 4, skill: 3, recipe: 3, connector: 2, laptop: 1 };

export function dedupeTriggers(commands: Command[]): Command[] {
  const seen = new Map<string, number>();
  return commands.map((entry) => {
    const count = seen.get(entry.trigger) ?? 0;
    seen.set(entry.trigger, count + 1);
    return count === 0 ? entry : { ...entry, trigger: `${entry.trigger}-${count + 1}` };
  });
}

export function rankCommands(commands: Command[], query: string, usage: UsageRow[], now: number, limit = 50): Command[] {
  const usageById = new Map(usage.map((row) => [row.command_id, row]));
  return dedupeTriggers(commands)
    .map((entry) => ({ entry, match: matchScore(entry, query) }))
    .filter(({ match }) => match > 0)
    .map(({ entry, match }) => ({ ...entry, score: match + 10 * usageScore(usageById.get(entry.id), now) + KIND_ORDER[entry.kind] + (entry.available ? 5 : 0) }))
    .sort((a, b) => b.score - a.score || a.trigger.localeCompare(b.trigger))
    .slice(0, limit);
}

export type ParsedSlash = { trigger: string; args: Record<string, string>; rest: string };

export function parseSlashInput(text: string): ParsedSlash | null {
  const match = /^\/([a-z0-9._-]+)(?:\s+([\s\S]*))?$/i.exec(text.trimStart());
  if (!match) return null;
  const args: Record<string, string> = {};
  const restParts: string[] = [];
  for (const token of (match[2] ?? "").match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const pair = /^([a-zA-Z_][\w-]*):(.*)$/.exec(token);
    if (pair) args[pair[1]] = pair[2].replace(/^"|"$/g, "");
    else restParts.push(token);
  }
  return { trigger: match[1].toLowerCase(), args, rest: restParts.join(" ") };
}

export type MentionKind = "file" | "chat" | "skill";

export type Mention = { kind: MentionKind; ref: string; label: string };

export const MENTION_PATTERN = /@\[(file|chat|skill):([^\]|]+)\|([^\]]+)\]/g;

export function encodeMention(mention: Mention): string {
  return `@[${mention.kind}:${mention.ref.replace(/[\]|]/g, "")}|${mention.label.replace(/[\]]/g, "")}]`;
}

export function extractMentions(text: string): { text: string; mentions: Mention[] } {
  const mentions: Mention[] = [];
  const clean = text.replace(MENTION_PATTERN, (_whole, kind: MentionKind, ref: string, label: string) => {
    mentions.push({ kind, ref, label });
    return `@${label}`;
  });
  return { text: clean, mentions };
}

export type ActiveToken = { kind: "slash" | "mention"; query: string; start: number; end: number };

export function activeToken(text: string, caret: number): ActiveToken | null {
  const before = text.slice(0, caret);
  const slash = /(^|\n)\/([a-z0-9._-]*)$/i.exec(before);
  if (slash) return { kind: "slash", query: slash[2], start: caret - slash[2].length - 1, end: caret };
  const mention = /(^|\s)@([^\s@]*)$/.exec(before);
  if (mention) return { kind: "mention", query: mention[2], start: caret - mention[2].length - 1, end: caret };
  return null;
}
