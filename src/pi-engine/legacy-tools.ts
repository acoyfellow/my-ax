import { Type } from "@earendil-works/pi-ai";
import { defineExtension, section } from "@earendil-works/pi-durable";
import { awaitWithContext } from "@earendil-works/chord/context";
import type { ToolSet } from "ai";
import { TOOLS } from "../tools";
import { coerceToolArguments } from "../tool-arguments";
import { limitModelToolOutputWithSpill } from "../tool-output-limit";
import type { ToolContext, ToolDef } from "../types";
import { widgetToolName, widgetWording } from "../widget-names";

export const PI_SHARED_TOOL_EXCLUDE = new Set(["search_conversations"]);

type AnyToolRegistration = Parameters<typeof defineExtension>[0]["tools"] extends ReadonlyArray<infer T> | undefined ? T : never;

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function piToolFromDef(definition: ToolDef, context: () => ToolContext): AnyToolRegistration {
  return {
    name: widgetToolName(definition.name),
    description: widgetWording(definition.description),
    parameters: Type.Unsafe<Record<string, unknown>>(describeParametersAsWidgets(definition.parameters) as never),
    execute: async (args: Record<string, unknown>, _api: unknown, ctx: Parameters<typeof awaitWithContext>[1]) => {
      const toolContext = context();
      const output = await awaitWithContext(definition.execute(coerceToolArguments(args), toolContext), ctx);
      return textResult(await limitModelToolOutputWithSpill(output, definition.name, toolContext.writeFile));
    },
  } as unknown as AnyToolRegistration;
}

function describeParametersAsWidgets(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(describeParametersAsWidgets);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema as Record<string, unknown>).map(([key, value]) => [key, key === "description" && typeof value === "string" ? widgetWording(value) : describeParametersAsWidgets(value)]));
}

function piToolFromAiSdk(name: string, aiTool: ToolSet[string]): AnyToolRegistration {
  const schema = (aiTool as { inputSchema?: { jsonSchema?: unknown } }).inputSchema?.jsonSchema ?? { type: "object", properties: {} };
  return {
    name,
    description: String((aiTool as { description?: string }).description ?? name),
    parameters: Type.Unsafe<Record<string, unknown>>(schema as never),
    execute: async (args: Record<string, unknown>, _api: unknown, ctx: Parameters<typeof awaitWithContext>[1]) => {
      const run = (aiTool as { execute?: (input: unknown, options: unknown) => Promise<unknown> }).execute;
      if (!run) throw new Error(`${name} cannot run here`);
      const output = await awaitWithContext(run(coerceToolArguments(args), { toolCallId: crypto.randomUUID(), messages: [] }), ctx);
      return textResult(typeof output === "string" ? output : JSON.stringify(output));
    },
  } as unknown as AnyToolRegistration;
}

export function sharedToolsExtension(options: { context: () => ToolContext; extra?: () => ToolSet; instructions: string }) {
  const fromDefs = TOOLS.filter((definition) => !PI_SHARED_TOOL_EXCLUDE.has(definition.name)).map((definition) => piToolFromDef(definition, options.context));
  const extra = options.extra?.() ?? {};
  const fromAiSdk = Object.entries(extra).map(([name, aiTool]) => piToolFromAiSdk(name, aiTool));
  return defineExtension({ name: "myax.shared", sections: [section("myax-shared", () => options.instructions)], tools: [...fromDefs, ...fromAiSdk] });
}
