import { createRequire, register } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const originalResolveFilename = Module._resolveFilename;
const workerStub = new URL("./cloudflare-workers-test-stub.cjs", import.meta.url).pathname;

Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "cloudflare:workers") return workerStub;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

register("./cloudflare-test-loader-hooks.mjs", import.meta.url);
