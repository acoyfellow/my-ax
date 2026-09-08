import { Effect } from "effect";
import type { ModelPort } from "./orchestrate";
import type { AgentsEnv } from "./workflows";
import { implementModelEffect, implementationModelLayer } from "./model-implementation-program";

export { applyModelEdits, jsonObject, validateModelImplementation } from "./model-implementation-policy";

export function createImplementationModel(env: AgentsEnv, modelId: string): ModelPort {
  return {
    modelId,
    implement: (input, repository) => implementModelEffect(input).pipe(Effect.provide(implementationModelLayer(env, modelId, repository))),
  };
}
