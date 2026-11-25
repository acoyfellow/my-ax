import { unsafe } from "@earendil-works/pi-schema";
import { defineExtension, section } from "@earendil-works/pi-durable";
import { awaitWithContext } from "@earendil-works/chord/context";
import { TOOLS } from "../tools";
import { BROWSER_OPEN_TOOL } from "../browser-tools";
import { coerceToolArguments } from "../tool-arguments";
import { limitModelToolOutputWithSpill } from "../tool-output-limit";
import type { ToolContext, ToolDef } from "../types";
import { widgetToolName, widgetWording } from "../widget-names";

export const PI_SHARED_TOOL_EXCLUDE = new Set(["search_conversations"]);

type AnyToolRegistration = Parameters<typeof defineExtension>[0]["tools"] extends ReadonlyArray<infer T> | undefined ? T : never;

function textResult(text: string) {
  return { output: [{ type: "text" as const, text }] };
}

function piToolFromDef(definition: ToolDef, context: (signal?: AbortSignal) => ToolContext): AnyToolRegistration {
  return {
    name: widgetToolName(definition.name),
    description: widgetWording(definition.description),
    parameters: unsafe<Record<string, unknown>>(describeParametersAsWidgets(definition.parameters) as never),
    execute: async (args: Record<string, unknown>, api: { output?: (chunk: string) => void }, ctx: Parameters<typeof awaitWithContext>[1]) => {
      const toolContext = context(ctx.abortSignal);
      const output = await definition.execute(coerceToolArguments(args), toolContext);
      if (ctx.abortSignal?.aborted) {
        api?.output?.(`${output}\n`);
        throw new DOMException(output || `Tool ${definition.name} killed by owner`, "AbortError");
      }
      return textResult(await limitModelToolOutputWithSpill(output, definition.name, toolContext.writeFile));
    },
  } as unknown as AnyToolRegistration;
}

function describeParametersAsWidgets(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(describeParametersAsWidgets);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema as Record<string, unknown>).map(([key, value]) => [key, key === "description" && typeof value === "string" ? widgetWording(value) : describeParametersAsWidgets(value)]));
}

export function sharedToolsExtension(options: { context: (signal?: AbortSignal) => ToolContext; instructions: string }) {
  const allDefs: ToolDef[] = [...TOOLS.filter((definition) => !PI_SHARED_TOOL_EXCLUDE.has(definition.name)), BROWSER_OPEN_TOOL];
  const tools = allDefs.map((definition) => piToolFromDef(definition, options.context));
  return defineExtension({ name: "myax.shared", sections: [section("myax-shared", () => options.instructions)], tools });
}
