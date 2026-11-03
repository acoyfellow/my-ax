import type { RadarService } from "../types";
import type { ConnectorRunner } from "./connector-tools";

export const RADAR_SERVER_ID = "radar";

type CatalogEntry = Awaited<ReturnType<ConnectorRunner["list"]>>[number];

const RADAR_TOOLS: readonly CatalogEntry[] = [
  {
    name: "radar__top",
    serverId: RADAR_SERVER_ID,
    toolName: "top",
    description: "arXiv radar: the highest-scoring recent papers. Use to pick a paper to read, discuss or spike.",
    inputSchema: {
      type: "object",
      properties: {
        minScore: { type: "number", description: "Lowest relevance score, 0-100. Default 85." },
        cycles: { type: "number", description: "How many recent daily cycles to scan. Default 7." },
        limit: { type: "number", description: "Most papers to return. Default 12." },
      },
    },
  },
  {
    name: "radar__paper",
    serverId: RADAR_SERVER_ID,
    toolName: "paper",
    description: "arXiv radar: the full stored record for one paper id (abstract, authors, score, reason, links).",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Paper id as returned by radar__top or radar__search" } }, required: ["id"] },
  },
  {
    name: "radar__search",
    serverId: RADAR_SERVER_ID,
    toolName: "search",
    description: "arXiv radar: search every stored paper by text.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" }, minScore: { type: "number" } },
      required: ["query"],
    },
  },
  {
    name: "radar__cycles",
    serverId: RADAR_SERVER_ID,
    toolName: "cycles",
    description: "arXiv radar: recent daily fetch cycles with paper and high-relevance counts.",
    inputSchema: { type: "object", properties: { count: { type: "number" } } },
  },
];

const optionalNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`radar: ${field} is required`);

  return value.trim();
};

export async function callRadar(radar: RadarService, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  if (toolName === "top") return radar.top({ minScore: optionalNumber(args.minScore), cycles: optionalNumber(args.cycles), limit: optionalNumber(args.limit) });
  if (toolName === "paper") return radar.paper(requiredString(args.id, "id"));
  if (toolName === "search") return radar.search(requiredString(args.query, "query"), optionalNumber(args.limit), optionalNumber(args.minScore));
  if (toolName === "cycles") return radar.cycles(optionalNumber(args.count));
  throw new Error(`radar: unknown tool ${toolName}`);
}

export function withRadar(base: ConnectorRunner, radar: RadarService | undefined): ConnectorRunner {
  if (!radar) return base;

  return {
    list: async () => [...RADAR_TOOLS, ...(await base.list().catch(() => []))],
    call: async (serverId, toolName, args) => {
      if (serverId !== RADAR_SERVER_ID) return base.call(serverId, toolName, args);

      try {
        return JSON.stringify(await callRadar(radar, toolName, args));
      } catch (error) {
        return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}
