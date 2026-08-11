const workerStub = "data:text/javascript,export class DurableObject {} export class RpcTarget {} export class WorkerEntrypoint {} export class WorkflowEntrypoint {} export const env = {}; export const exports = {};";
const emailStub = "data:text/javascript,export class EmailMessage {}";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { shortCircuit: true, url: workerStub };
  if (specifier === "cloudflare:email") return { shortCircuit: true, url: emailStub };
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === "cloudflare:email") return { format: "module", shortCircuit: true, source: "export class EmailMessage {}" };
  return nextLoad(url, context);
}
