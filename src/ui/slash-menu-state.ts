import { activeToken, encodeMention, type ActiveToken, type Command, type Mention } from "../commands/registry";

export type MentionOption = Mention & { detail: string };

export type MenuItem = { kind: "command"; command: Command } | { kind: "mention"; mention: MentionOption };

export type MenuKey = "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Escape";

export type MenuKeyResult = { handled: boolean; index: number; choose: boolean; close: boolean };

export function menuKey(key: string, index: number, count: number): MenuKeyResult {
  if (count === 0) return { handled: key === "Escape", index: 0, choose: false, close: key === "Escape" };
  if (key === "ArrowDown") return { handled: true, index: (index + 1) % count, choose: false, close: false };
  if (key === "ArrowUp") return { handled: true, index: (index - 1 + count) % count, choose: false, close: false };
  if (key === "Enter" || key === "Tab") return { handled: true, index, choose: true, close: false };
  if (key === "Escape") return { handled: true, index, choose: false, close: true };
  return { handled: false, index, choose: false, close: false };
}

export type Replacement = { text: string; caret: number };

export function replaceToken(text: string, token: ActiveToken, insert: string): Replacement {
  const next = `${text.slice(0, token.start)}${insert}${text.slice(token.end)}`;
  return { text: next, caret: token.start + insert.length };
}

export function commandInsertText(command: Command): string {
  const args = command.requiredArgs.map((name) => `${name}:`).join(" ");
  return `/${command.trigger} ${args}`.trimEnd() + " ";
}

export function mentionInsertText(mention: Mention): string {
  return `${encodeMention(mention)} `;
}

export function tokenAt(text: string, caret: number): ActiveToken | null {
  return activeToken(text, caret);
}

export type ChooseOutcome = { type: "run"; command: Command } | { type: "insert"; replacement: Replacement };

export function chooseItem(item: MenuItem, text: string, token: ActiveToken): ChooseOutcome {
  if (item.kind === "mention") return { type: "insert", replacement: replaceToken(text, token, mentionInsertText(item.mention)) };
  const remainder = `${text.slice(0, token.start)}${text.slice(token.end)}`.trim();
  if (item.command.runsOnEnter && item.command.available && !remainder) return { type: "run", command: item.command };
  return { type: "insert", replacement: replaceToken(text, token, commandInsertText(item.command)) };
}

export const KIND_LABEL: Record<Command["kind"] | Mention["kind"], string> = {
  builtin: "my.ax",
  recipe: "tool",
  skill: "skill",
  connector: "mcp",
  laptop: "laptop",
  file: "file",
  chat: "chat",
};
