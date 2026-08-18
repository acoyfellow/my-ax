const HOST_MARKERS = [
  ["my", "ax", "cloudflare", "dev"].join("."),
  ["hooks", "ax", "cloudflare", "dev"].join("."),
  ["agents", "ax", "cloudflare", "dev"].join("."),
  ["support", "chat", "cloudflareaccess", "com"].join("."),
  ["open", "code", "cloudflare", "dev"].join("."),
  ["gitlab", "cf", "data", "org"].join("."),
];

const PROSE_MARKERS = [
  "employee worker",
  "employee deploy",
  "private wrapper",
  "deploy-employee",
  "deploy-agents",
  "my-ax-private",
];

export function publicTextViolations(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const marker of HOST_MARKERS) if (lower.includes(marker)) hits.push(marker);
  for (const marker of PROSE_MARKERS) if (lower.includes(marker)) hits.push(marker);
  return hits;
}

export function assertPublicText(text: string): string {
  const hits = publicTextViolations(text);
  if (hits.length) throw new Error(`public text names a private install: ${hits.join(", ")}`);
  return text;
}
