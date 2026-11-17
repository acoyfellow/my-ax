export type MachineState = "pending" | "approved" | "logged_out";
export type PairedMachine = { name: string; title: string; state: MachineState; hostName: string | null; createdAt: number; lastSeenAt: number | null; connected: boolean; tools: string[] };

export const MACHINECTL_REPO = "https://github.com/acoyfellow/machinectl.git";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function machineNameFrom(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
}

export function addMachineCommand(origin: string, rawName: string, allowShell: boolean): string {
  const name = machineNameFrom(rawName);
  const shellFlag = allowShell ? " --shell" : "";
  const nameFlag = name ? ` --name ${shellQuote(name)}` : "";
  return [
    `[ -d ~/machinectl ] || git clone ${MACHINECTL_REPO} ~/machinectl`,
    `cd ~/machinectl && git pull -q && npm install --silent && npm run build --silent`,
    `cloudflared access login ${shellQuote(origin)}`,
    `node dist/index.js install-agent --url ${shellQuote(origin)}${nameFlag}${shellFlag}`,
  ].join(" && \\\n  ");
}

export function machineStatusLine(machine: PairedMachine): string {
  if (machine.state === "pending") return "Waiting for your approval. It has no access yet.";
  if (machine.state === "logged_out") return "Logged out. It cannot connect until you allow it again.";
  if (!machine.connected) return "Approved · offline";
  return `Connected${machine.hostName ? " · " + machine.hostName : ""} · ${machine.tools.length} tools`;
}
