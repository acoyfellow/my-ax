export type PairedMachine = { name: string; title: string; hostName: string | null; createdAt: number; connected: boolean; tools: string[] };
export type PairCode = { code: string; expiresAt: number; origin: string };

export const MACHINECTL_REPO = "https://github.com/acoyfellow/machinectl.git";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function pairCommandFor(pair: PairCode, rawName: string, allowShell = true): string {
  const name = rawName.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
  const nameFlag = name ? ` --name ${shellQuote(name)}` : "";
  return [
    `[ -d ~/machinectl ] || git clone ${MACHINECTL_REPO} ~/machinectl`,
    `cd ~/machinectl && git pull -q && npm install --silent && npm run build --silent`,
    `node dist/index.js pair ${pair.code} --url ${shellQuote(pair.origin)}${nameFlag}${allowShell ? " --shell" : ""}`,
  ].join(" && \\\n  ");
}
