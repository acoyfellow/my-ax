#!/usr/bin/env node
// trigger-deploy.mjs — kick the GitHub Actions "deploy" workflow with no laptop.
//
// This is how the My AX agent (or you, from anywhere) starts a full Class B
// deploy: a single authenticated POST to the GitHub REST API. No Docker, no
// wrangler, no Mac — just a fine-grained GitHub token with
// "Actions: read and write" on the target repo.
//
// ENV:
//   GITHUB_TOKEN   fine-grained PAT, Actions:write on the repo (store this as a
//                  My AX secret/connector so the agent can trigger deploys).
//   GH_REPO        owner/repo (default: acoyfellow/my-ax)
//   GH_REF         branch or tag to deploy from (default: main)
//
// USAGE:
//   node scripts/trigger-deploy.mjs "shipping fix for X" [--no-migrations]

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GH_REPO || "acoyfellow/my-ax";
const ref = process.env.GH_REF || "main";
const reason = process.argv[2] || "agent-triggered deploy";
const runMigrations = !process.argv.includes("--no-migrations");

if (!token) { console.error("FATAL: GITHUB_TOKEN not set."); process.exit(1); }

const url = `https://api.github.com/repos/${repo}/actions/workflows/deploy.yml/dispatches`;
const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "my-ax-deploy-trigger",
  },
  body: JSON.stringify({
    ref,
    inputs: { reason, run_migrations: String(runMigrations) },
  }),
});

if (res.status === 204) {
  console.log(`[trigger-deploy] dispatched deploy.yml on ${repo}@${ref} — reason: "${reason}"`);
  console.log(`[trigger-deploy] watch: https://github.com/${repo}/actions/workflows/deploy.yml`);
} else {
  console.error(`[trigger-deploy] FAILED ${res.status}: ${await res.text()}`);
  process.exit(1);
}
