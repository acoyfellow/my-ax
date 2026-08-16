export const FABRIC_STRATEGIES = ["one", "map", "race", "quorum"] as const;
export type FabricStrategy = (typeof FABRIC_STRATEGIES)[number];
export const FABRIC_BACKENDS = ["inproc", "terrarium", "cmux_pi"] as const;
export type FabricBackend = (typeof FABRIC_BACKENDS)[number];

export type FabricTask = { id: string; backend: FabricBackend };
export type FabricResult = { id: string; backend: FabricBackend; ok: boolean; result?: unknown; error?: string };

export function pickFabricBackend(input: {
  prefer?: FabricBackend;
  terrariumReady?: boolean;
  cmuxDispatchable?: boolean;
}): FabricBackend {
  if (input.prefer === "cmux_pi" && input.cmuxDispatchable) return "cmux_pi";
  if (input.prefer === "terrarium" && input.terrariumReady) return "terrarium";
  if (input.prefer === "inproc" || !input.prefer) return "inproc";
  if (input.cmuxDispatchable) return "cmux_pi";
  if (input.terrariumReady) return "terrarium";
  return "inproc";
}

export async function runFabric(
  strategy: FabricStrategy,
  tasks: FabricTask[],
  run: (task: FabricTask) => Promise<FabricResult>,
  quorum = 1,
): Promise<FabricResult[]> {
  if (tasks.length === 0) return [];
  if (strategy === "one") return [await run(tasks[0])];
  if (strategy === "map") {
    const out: FabricResult[] = [];
    for (const task of tasks) out.push(await run(task));
    return out;
  }
  if (strategy === "race") {
    return [await Promise.race(tasks.map((task) => run(task)))];
  }
  const settled = await Promise.all(tasks.map((task) => run(task)));
  const wins = settled.filter((row) => row.ok);
  if (wins.length < quorum) return settled.filter((row) => !row.ok).slice(0, 1);
  return wins.slice(0, quorum);
}
