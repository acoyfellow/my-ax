import { Context, Layer } from "effect";

export class TerminalSocketFactory extends Context.Service()("my-ax/proof/TerminalSocketFactory") {}

export function terminalSocketLayer(connect) {
  return Layer.succeed(TerminalSocketFactory, TerminalSocketFactory.of({ connect }));
}
