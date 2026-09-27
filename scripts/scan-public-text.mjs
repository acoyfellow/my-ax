#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { findLeaksInText } from "./public-leak-rules.mjs";

const repo = process.env.PUBLIC_TEXT_REPO || "acoyfellow/my-ax";
const [owner, name] = repo.split("/");

const query = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){
  issues(first:50,after:$cursor){pageInfo{hasNextPage endCursor} nodes{number title body comments(first:100){nodes{url body}}}}
}}`;
const prQuery = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){
  pullRequests(first:50,after:$cursor){pageInfo{hasNextPage endCursor} nodes{number title body comments(first:100){nodes{url body}}}}
}}`;

function graphql(text, cursor) {
  const args = ["api", "graphql", "-f", `query=${text}`, "-F", `owner=${owner}`, "-F", `name=${name}`];
  if (cursor) args.push("-F", `cursor=${cursor}`);
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

function* threads(text, field) {
  let cursor = null;
  do {
    const page = graphql(text, cursor).data.repository[field];
    yield* page.nodes;
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
}

const findings = [];
for (const [text, field, kind] of [[query, "issues", "issue"], [prQuery, "pullRequests", "pr"]]) {
  for (const thread of threads(text, field)) {
    findings.push(...findLeaksInText(`${kind} #${thread.number} title`, thread.title ?? ""));
    findings.push(...findLeaksInText(`${kind} #${thread.number} body`, thread.body ?? ""));
    for (const comment of thread.comments.nodes) {
      findings.push(...findLeaksInText(`${kind} #${thread.number} comment ${comment.url}`, comment.body ?? ""));
    }
  }
}

if (findings.length) {
  console.error(`Public text scan failed (${findings.length}):\n` + findings.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`✓ public text: ${repo} issues and pull requests clean`);
