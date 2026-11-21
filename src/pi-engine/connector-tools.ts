export type ConnectorRunner = {
  list(): Promise<Array<{ name: string; serverId: string; toolName: string; description: string; inputSchema: unknown }>>;
  call(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string>;
};
