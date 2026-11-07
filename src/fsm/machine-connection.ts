export const MACHINE_NAME_KEY = "machineName";
export const MACHINE_USER_KEY = "user";
export const TOOLS_KEY = "tools";
export const SOCKET_GENERATION_KEY = "socketGeneration";

export interface ConnectionStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<unknown>;
}

export type MachineConnection<Tool> =
  | { kind: "disconnected" }
  | { kind: "connected"; generation: string; user: string }
  | { kind: "ready"; generation: string; user: string; machineName: string; tools: Tool[] };

export async function readMachineConnection<Tool>(storage: ConnectionStorage): Promise<MachineConnection<Tool>> {
  const generation = await storage.get<string>(SOCKET_GENERATION_KEY);
  if (!generation) return { kind: "disconnected" };
  const user = (await storage.get<string>(MACHINE_USER_KEY)) ?? "unknown";
  const machineName = await storage.get<string>(MACHINE_NAME_KEY);
  const tools = await storage.get<Tool[]>(TOOLS_KEY);
  if (machineName === undefined || tools === undefined) return { kind: "connected", generation, user };
  return { kind: "ready", generation, user, machineName, tools };
}

export async function laptopConnected(storage: ConnectionStorage, generation: string, user: string): Promise<void> {
  await storage.delete([MACHINE_NAME_KEY, TOOLS_KEY]);
  await storage.put({ [MACHINE_USER_KEY]: user, [SOCKET_GENERATION_KEY]: generation });
}

export async function isCurrentGeneration(storage: ConnectionStorage, generation: string | undefined): Promise<boolean> {
  return Boolean(generation) && generation === await storage.get<string>(SOCKET_GENERATION_KEY);
}

export async function laptopAnnounced<Tool>(storage: ConnectionStorage, generation: string | undefined, machineName: string, tools: Tool[]): Promise<boolean> {
  if (!await isCurrentGeneration(storage, generation)) return false;
  await storage.put({ [MACHINE_NAME_KEY]: machineName, [TOOLS_KEY]: tools });
  return true;
}

export async function laptopDisconnected(storage: ConnectionStorage, generation: string | undefined): Promise<boolean> {
  const active = await storage.get<string>(SOCKET_GENERATION_KEY);
  if (generation && generation !== active) return false;
  await storage.delete([MACHINE_NAME_KEY, MACHINE_USER_KEY, TOOLS_KEY, SOCKET_GENERATION_KEY]);
  return true;
}
