import { slugTrigger } from "./registry";

export type SkillRow = {
  id: string;
  owner_email: string;
  name: string;
  description: string;
  instructions: string;
  allowed_tools_json: string;
  source_session_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  allowedTools: string[];
  sourceSessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SkillDraft = { name: string; description: string; instructions: string; allowedTools?: string[]; sourceSessionId?: string | null };

export const SKILL_LIMITS = { name: 64, description: 300, instructions: 20_000, tools: 50 } as const;

export class SkillError extends Error {
  constructor(readonly code: "BadRequest" | "NotFound" | "Conflict", message: string) {
    super(message);
    this.name = "SkillError";
  }
}

export function publicSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    allowedTools: JSON.parse(row.allowed_tools_json) as string[],
    sourceSessionId: row.source_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function validateSkillDraft(draft: Partial<SkillDraft>): SkillDraft {
  const name = slugTrigger(String(draft.name ?? ""));
  const description = String(draft.description ?? "").trim();
  const instructions = String(draft.instructions ?? "").trim();
  const allowedTools = Array.isArray(draft.allowedTools) ? draft.allowedTools.map(String).filter(Boolean) : [];
  if (!draft.name || name === "command") throw new SkillError("BadRequest", "A skill needs a name");
  if (name.length > SKILL_LIMITS.name) throw new SkillError("BadRequest", `Name is longer than ${SKILL_LIMITS.name} characters`);
  if (!description) throw new SkillError("BadRequest", "A skill needs a one-line description");
  if (description.length > SKILL_LIMITS.description) throw new SkillError("BadRequest", `Description is longer than ${SKILL_LIMITS.description} characters`);
  if (!instructions) throw new SkillError("BadRequest", "A skill needs instructions");
  if (instructions.length > SKILL_LIMITS.instructions) throw new SkillError("BadRequest", `Instructions are longer than ${SKILL_LIMITS.instructions} characters`);
  if (allowedTools.length > SKILL_LIMITS.tools) throw new SkillError("BadRequest", `A skill can list at most ${SKILL_LIMITS.tools} tools`);
  return { name, description, instructions, allowedTools, sourceSessionId: draft.sourceSessionId ?? null };
}

export function skillMarkdown(skill: Skill): string {
  const tools = skill.allowedTools.length ? `\nallowed-tools: ${skill.allowedTools.join(", ")}` : "";
  return `---\nname: ${skill.name}\ndescription: ${skill.description.replace(/\n/g, " ")}${tools}\n---\n\n${skill.instructions}\n`;
}

export function parseSkillMarkdown(markdown: string): Partial<SkillDraft> {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown.replace(/\r\n/g, "\n").trimStart());
  if (!match) return { instructions: markdown.trim() };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const pair = /^([a-z-]+):\s*(.*)$/i.exec(line.trim());
    if (pair) meta[pair[1].toLowerCase()] = pair[2].trim();
  }
  return {
    name: meta.name,
    description: meta.description,
    instructions: match[2].trim(),
    allowedTools: meta["allowed-tools"] ? meta["allowed-tools"].split(",").map((tool) => tool.trim()).filter(Boolean) : [],
  };
}

export const SKILL_INVOCATION_OPEN = "<skill-invocation";

export function skillInjection(skill: Pick<Skill, "name" | "instructions" | "allowedTools">, userText: string): string {
  const tools = skill.allowedTools.length ? ` allowed-tools="${skill.allowedTools.join(",").replace(/"/g, "")}"` : "";
  const request = userText.trim() || "Follow the skill.";
  return `${SKILL_INVOCATION_OPEN} name="${skill.name}"${tools}>\nFor this turn only, follow these instructions from the owner's saved skill. They do not grant any tool or capability beyond what this conversation already has.\n\n${skill.instructions}\n</skill-invocation>\n\n${request}`;
}

type D1Like = {
  prepare(query: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> } };
};

export class SkillService {
  constructor(private db: D1Like, private ownerEmail: string, private now: () => Date = () => new Date(), private newId: () => string = () => crypto.randomUUID()) {}

  private owner() {
    return this.ownerEmail.toLowerCase();
  }

  async list(): Promise<Skill[]> {
    const { results = [] } = await this.db.prepare("SELECT * FROM skills WHERE owner_email = ? ORDER BY updated_at DESC").bind(this.owner()).all<SkillRow>();
    return results.map(publicSkill);
  }

  async get(id: string): Promise<Skill> {
    const row = await this.db.prepare("SELECT * FROM skills WHERE id = ? AND owner_email = ?").bind(id, this.owner()).first<SkillRow>();
    if (!row) throw new SkillError("NotFound", "skill not found");
    return publicSkill(row);
  }

  async byName(name: string): Promise<Skill | null> {
    const row = await this.db.prepare("SELECT * FROM skills WHERE name = ? AND owner_email = ?").bind(slugTrigger(name), this.owner()).first<SkillRow>();
    return row ? publicSkill(row) : null;
  }

  async create(input: Partial<SkillDraft>): Promise<Skill> {
    const draft = validateSkillDraft(input);
    if (await this.byName(draft.name)) throw new SkillError("Conflict", `You already have a skill called ${draft.name}`);
    const id = this.newId();
    const at = this.now().toISOString();
    await this.db.prepare("INSERT INTO skills (id, owner_email, name, description, instructions, allowed_tools_json, source_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, this.owner(), draft.name, draft.description, draft.instructions, JSON.stringify(draft.allowedTools ?? []), draft.sourceSessionId ?? null, at, at)
      .run();
    return this.get(id);
  }

  async update(id: string, input: Partial<SkillDraft>): Promise<Skill> {
    const current = await this.get(id);
    const draft = validateSkillDraft({ ...current, ...input });
    const clash = await this.byName(draft.name);
    if (clash && clash.id !== id) throw new SkillError("Conflict", `You already have a skill called ${draft.name}`);
    await this.db.prepare("UPDATE skills SET name = ?, description = ?, instructions = ?, allowed_tools_json = ?, updated_at = ? WHERE id = ? AND owner_email = ?")
      .bind(draft.name, draft.description, draft.instructions, JSON.stringify(draft.allowedTools ?? []), this.now().toISOString(), id, this.owner())
      .run();
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.db.prepare("DELETE FROM skills WHERE id = ? AND owner_email = ?").bind(id, this.owner()).run();
  }
}

export function draftSkillFromTranscript(sessionName: string, turns: Array<{ role: string; text: string }>): SkillDraft {
  const asks = turns.filter((turn) => turn.role === "user").map((turn) => turn.text.trim()).filter(Boolean);
  const answers = turns.filter((turn) => turn.role === "assistant").map((turn) => turn.text.trim()).filter(Boolean);
  const steps = asks.slice(0, 12).map((ask, index) => `${index + 1}. ${ask.replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
  const outcome = (answers.at(-1) ?? "").replace(/\s+/g, " ").slice(0, 600);
  return {
    name: slugTrigger(sessionName || "saved-skill"),
    description: `Repeat what happened in "${sessionName || "this conversation"}"`.slice(0, SKILL_LIMITS.description),
    instructions: `Do this the same way it was done before.\n\nWhat the owner asked, in order:\n${steps || "1. (no requests recorded)"}\n\nWhat a good result looked like:\n${outcome || "(no reply recorded)"}\n\nAsk before anything destructive. Keep the reply short.`,
    allowedTools: [],
  };
}
