import { extractMentions, parseSlashInput, type Mention } from "./registry";
import type { Skill } from "./skills";

export type MentionResolver = {
  skill(name: string): Promise<Skill | null>;
  chat(id: string): Promise<{ name: string; turns: Array<{ role: string; text: string }> } | null>;
};

export type Expanded = { text: string; files: string[]; skill: Skill | null; unresolved: Mention[] };

type Inject = (skill: Pick<Skill, "name" | "instructions" | "allowedTools">, userText: string) => string;

const CHAT_QUOTE_LIMIT = 4_000;

function quoteChat(name: string, turns: Array<{ role: string; text: string }>): string {
  const body = turns.map((turn) => `${turn.role === "user" ? "Owner" : "Assistant"}: ${turn.text.replace(/\s+/g, " ").trim()}`).join("\n").slice(-CHAT_QUOTE_LIMIT);
  return `<referenced-conversation name="${name.replace(/"/g, "'")}">\n${body}\n</referenced-conversation>`;
}

export async function expandMessage(raw: string, resolver: MentionResolver, inject: Inject): Promise<Expanded> {
  const { text: withoutMentions, mentions } = extractMentions(raw);
  const files: string[] = [];
  const quotes: string[] = [];
  const unresolved: Mention[] = [];
  const extraSkills: Skill[] = [];
  for (const mention of mentions) {
    if (mention.kind === "file") files.push(mention.ref);
    else if (mention.kind === "chat") {
      const chat = await resolver.chat(mention.ref);
      if (chat) quotes.push(quoteChat(chat.name, chat.turns));
      else unresolved.push(mention);
    } else {
      const skill = await resolver.skill(mention.ref);
      if (skill) extraSkills.push(skill);
      else unresolved.push(mention);
    }
  }
  let text = withoutMentions;
  let skill: Skill | null = null;
  const slash = parseSlashInput(text);
  if (slash) {
    const named = await resolver.skill(slash.trigger);
    if (named) {
      skill = named;
      const argText = Object.entries(slash.args).map(([key, value]) => `${key}: ${value}`).join("\n");
      text = inject(named, [argText, slash.rest].filter(Boolean).join("\n"));
    }
  }
  for (const extra of extraSkills) text = inject(extra, text);
  if (quotes.length) text = `${quotes.join("\n\n")}\n\n${text}`;
  return { text, files, skill, unresolved };
}
