import { createHash } from "node:crypto";

const join = (...parts) => parts.join("");

const privateDomainSuffixes = [
  join("cf", "data", ".org"),
  join(".cloudflare", ".dev"),
].map((value) => value.toLowerCase());

const accessTeamDomain = join(".cloudflare", "access", ".com");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const hostPattern = /[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi;

const forbiddenProse = [
  join("cloudflare", "-employee"),
  join("authenticated", " employees"),
  join("employee", " access session"),
  join("internal", " stratus"),
];

const credentialPatterns = [
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

const ownerUser = join("j", "coeyman");
const piiFragments = [
  [ownerUser, "owner username"],
  ["@" + join("cloudflare", ".com"), "cloudflare.com email address"],
  [ownerUser + "-macbook", "owner machine name"],
  [join("LEE", " terminal"), "private project codename"],
  [join("AUS", "-DOG"), "owner colo/region code"],
].map(([value, label]) => [value.toLowerCase(), label]);

const privateAccessTeamHashes = new Set([
  "07c35aba1468193d274bdb3662ccacc6fa80c1ba23f95ec632dd79582a1585da",
]);

const privateAccountIdHashes = new Set([
  "84e081be7fbcc1565a9f14c7eab7b1856c6d16075abf7d2aa9ac3187bc8d5d46",
]);

export function privateHostsIn(text) {
  const hits = new Set();
  for (const match of text.matchAll(hostPattern)) {
    const host = match[0].toLowerCase();
    for (const suffix of privateDomainSuffixes) {
      const bare = suffix.replace(/^\./, "");
      if (host === bare || host.endsWith(suffix.startsWith(".") ? suffix : `.${suffix}`)) hits.add(host);
    }
    if (host.endsWith(accessTeamDomain) && privateAccessTeamHashes.has(sha256(host.slice(0, -accessTeamDomain.length).split(".").pop()))) hits.add(`${host.slice(0, 3)}…${accessTeamDomain}`);
  }
  return [...hits];
}

function privateAccountIdsIn(text) {
  const hits = [];
  for (const match of text.matchAll(/\b[0-9a-f]{32}\b/gi)) {
    const digest = sha256(match[0].toLowerCase());
    if (privateAccountIdHashes.has(digest)) hits.push(`${match[0].slice(0, 4)}…`);
  }
  return hits;
}

export function findLeaksInText(label, text) {
  const findings = [];
  const lower = text.toLowerCase();
  for (const host of privateHostsIn(text)) findings.push(`${label}: private host (${host})`);
  for (const id of privateAccountIdsIn(text)) findings.push(`${label}: private account id (${id})`);
  for (const phrase of forbiddenProse) if (lower.includes(phrase)) findings.push(`${label}: deployment-specific prose (${phrase})`);
  for (const pattern of credentialPatterns) if (pattern.test(text)) findings.push(`${label}: credential-like material (${pattern.source})`);
  for (const [fragment, name] of piiFragments) if (lower.includes(fragment)) findings.push(`${label}: owner PII (${name})`);
  return findings;
}
