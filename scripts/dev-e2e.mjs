import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const stateDir = resolve(root, ".wrangler/e2e-state");
const fixtureSql = resolve(root, ".wrangler/e2e-fixture.sql");
const port = process.env.MY_AX_E2E_PORT ?? "8787";
const reset = !process.argv.includes("--keep");

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (reset) rmSync(stateDir, { recursive: true, force: true });
run("npm", ["run", "build:assets"]);
run("npx", ["wrangler", "d1", "migrations", "apply", "my-ax-db-dev", "--local", "--env", "dev", "--persist-to", stateDir]);
run("node", ["scripts/seed-e2e.mjs", fixtureSql]);
run("npx", ["wrangler", "d1", "execute", "my-ax-db-dev", "--local", "--env", "dev", "--persist-to", stateDir, "--file", fixtureSql]);

const url = `http://127.0.0.1:${port}/?session=e2e-design-conversation`;
process.stdout.write(`\nMy AX isolated E2E: ${url}\nIdentity: dev@localhost\nState: ${stateDir}\n\n`);

const child = spawn("npx", ["wrangler", "dev", "--env", "dev", "--port", port, "--persist-to", stateDir, "--enable-containers=false", "--var", "DEV_USER_EMAIL:dev@localhost", "--var", `BRIDGE_BASE_URL:http://127.0.0.1:${port}`], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
