import { validateImplementationFiles } from "./implementation-submission";

export function jsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("implementation model returned no JSON object");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return JSON.parse(text.slice(start, index + 1));
  }
  throw new Error("implementation model returned incomplete JSON object");
}

function isTestPath(path: string): boolean {
  return /(?:^|[./-])(?:test|tests|spec|smoke)(?:[./-]|$)/i.test(path);
}

export function validateModelImplementation(value: unknown, selectedPaths: string[]) {
  const validated = validateImplementationFiles(value);
  if (!validated.some((file) => isTestPath(file.path))) throw new Error("implementation needs a focused test file");
  if (validated.some((file) => isTestPath(file.path) && /from ["']vitest["']/.test(file.content))) {
    throw new Error("tests must use node:test and node:assert/strict; vitest is not installed");
  }
  const changedProducts = validated.filter((file) => selectedPaths.includes(file.path) && !isTestPath(file.path));
  if (!changedProducts.length) throw new Error("implementation must change an existing product file from the selected context");
  const tests = validated.filter((file) => isTestPath(file.path));
  for (const product of changedProducts) {
    if (product.path.startsWith("migrations/")) continue;
    const directory = product.path.slice(0, product.path.lastIndexOf("/") + 1);
    const stem = product.path.slice(directory.length).replace(/\.[^.]+$/, "").toLowerCase();
    const related = tests.some((test) => test.path.startsWith(directory) && (
      product.path.endsWith(".svelte") || test.path.slice(directory.length).toLowerCase().startsWith(`${stem}.`)
    ));
    if (!related) throw new Error(`changed product file needs its own focused test: ${product.path}`);
  }
  return validated;
}

function validateChatSmoke(files: Array<{ path: string; content: string }>, context: Array<{ path: string; content: string }>) {
  const smoke = files.find((file) => /chat.*smoke\.mjs$/i.test(file.path))
    ?? context.find((file) => /chat.*smoke\.mjs$/i.test(file.path));
  if (!smoke) return;
  const chat = files.find((file) => /(?:^|\/)Chat\.svelte$/.test(file.path))
    ?? context.find((file) => /(?:^|\/)Chat\.svelte$/.test(file.path));
  if (!chat) throw new Error("changed chat smoke needs Chat.svelte context");
  const decodeDoubleQuoted = (raw: string) => JSON.parse(`"${raw}"`) as string;
  const includes = [...smoke.content.matchAll(/assertIncludes\(chat,\s*"((?:\\.|[^"\\])*)"/g)].map((match) => decodeDoubleQuoted(match[1]));
  const excludes = [...smoke.content.matchAll(/assertNotIncludes\(chat,\s*"((?:\\.|[^"\\])*)"/g)].map((match) => decodeDoubleQuoted(match[1]));
  for (const assertion of includes) {
    if (!chat.content.includes(assertion)) throw new Error(`chat smoke assertion is absent from resulting source: ${assertion}`);
  }
  for (const assertion of excludes) {
    if (chat.content.includes(assertion)) throw new Error(`chat smoke exclusion remains in resulting source: ${assertion}`);
  }
}

export function applyModelEdits(value: unknown, context: Array<{ path: string; content: string }>) {
  const edits = (value as { edits?: unknown }).edits;
  if (!Array.isArray(edits) || !edits.length || edits.length > 20) throw new Error("implementation model returned invalid edits");
  const files = edits.map((row) => {
    const edit = row as { path?: unknown; content?: unknown; replacements?: unknown };
    const path = String(edit.path || "");
    const existing = context.find((file) => file.path === path);
    if (!existing) {
      if (typeof edit.content !== "string") throw new Error("new implementation file needs full content");
      return { path, content: edit.content };
    }
    if (!Array.isArray(edit.replacements) || !edit.replacements.length || edit.replacements.length > 10) {
      throw new Error("existing implementation file needs bounded replacements");
    }
    let content = existing.content;
    for (const value of edit.replacements) {
      const replacement = value as { oldText?: unknown; newText?: unknown };
      if (typeof replacement.oldText !== "string" || !replacement.oldText || typeof replacement.newText !== "string") {
        throw new Error("invalid implementation replacement");
      }
      if (content.split(replacement.oldText).length !== 2) throw new Error("implementation replacement must match exactly once");
      content = content.replace(replacement.oldText, replacement.newText);
    }
    if (content.length < existing.content.length * 0.75) throw new Error(`implementation may not delete more than 25% of an existing file: ${path}`);
    return { path, content };
  });
  validateChatSmoke(files, context);
  return validateModelImplementation(files, context.map((file) => file.path));
}
