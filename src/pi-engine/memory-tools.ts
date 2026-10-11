import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { awaitWithContext } from "@earendil-works/chord/context";
import { clipToolOutput } from "./workspace-tools";
import { PI_MEMORY_INSTRUCTIONS, type ConversationMemory } from "./conversation-index";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text: clipToolOutput(text) }] };
}

export function memoryToolsExtension(memory: () => ConversationMemory) {
  const search = defineTool({
    name: "search_conversations",
    description: "Full-text search across all of the owner's past conversations, on both engines. Returns sessionId, timestamp, role and a snippet.",
    parameters: Type.Object({
      query: Type.String({ description: "Full-text query" }),
      limit: Type.Optional(Type.Number({ description: "Maximum results, default 20, max 100" })),
      sort: Type.Optional(Type.Union([Type.Literal("relevance"), Type.Literal("recent")])),
      since: Type.Optional(Type.String({ description: "ISO date/time lower bound" })),
      until: Type.Optional(Type.String({ description: "ISO date/time upper bound" })),
    }),
    replay: "safe",
    execute: async (args, _api, context) => textResult(JSON.stringify(await awaitWithContext(memory().search(args.query, args), context))),
  });
  const read = defineTool({
    name: "read_conversation",
    description: "Read one past conversation's indexed transcript in order (user, assistant and tool entries). Use a sessionId from search_conversations.",
    parameters: Type.Object({
      sessionId: Type.String(),
      limit: Type.Optional(Type.Number({ description: "Most recent entries to return, default 100, max 400" })),
    }),
    replay: "safe",
    execute: async (args, _api, context) => textResult(JSON.stringify(await awaitWithContext(memory().read(args.sessionId, Math.min(Math.max(args.limit ?? 100, 1), 400)), context))),
  });
  return defineExtension({ name: "myax.memory", sections: [section("myax-memory", () => PI_MEMORY_INSTRUCTIONS)], tools: [search, read] });
}
