export interface ImplementationGrant {
  issueNumber: number;
  head: string;
  submissionHead: string;
  expiresAt: number;
  nonce: string;
}

export interface ImplementationFile {
  path: string;
  content: string;
}

const MAX_FILES = 20;
const MAX_BYTES = 500_000;
const ALLOWED_PATH = /^(?:src|migrations)\/[A-Za-z0-9._/-]+$/;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signature(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return encodeBase64Url(new Uint8Array(signed));
}

function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function createImplementationGrant(secret: string, grant: ImplementationGrant): Promise<string> {
  if (!secret.trim()) throw new Error("implementation grant secret is required");
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(grant)));
  return `${payload}.${await signature(secret, payload)}`;
}

export async function verifyImplementationGrant(secret: string, token: string, now = Date.now()): Promise<ImplementationGrant> {
  const [payload, provided, extra] = token.split(".");
  if (!payload || !provided || extra || !equal(await signature(secret, payload), provided)) throw new Error("invalid implementation grant");
  const grant = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as ImplementationGrant;
  if (!Number.isInteger(grant.issueNumber) || grant.issueNumber <= 0) throw new Error("invalid issue number");
  if (grant.head !== `bot/issue-${grant.issueNumber}`) throw new Error("invalid implementation head");
  if (!grant.nonce || grant.nonce.length < 16) throw new Error("invalid implementation nonce");
  if (grant.submissionHead !== `factory/submission-${grant.issueNumber}-${grant.nonce}`) throw new Error("invalid submission head");
  if (!Number.isFinite(grant.expiresAt) || grant.expiresAt <= now) throw new Error("implementation grant expired");
  return grant;
}

export function validateImplementationFiles(value: unknown): ImplementationFile[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FILES) throw new Error("invalid implementation file count");
  const files = value.map((row) => {
    const file = row as Partial<ImplementationFile>;
    if (typeof file.path !== "string" || !ALLOWED_PATH.test(file.path) || file.path.includes("..")) throw new Error("invalid implementation path");
    if (typeof file.content !== "string") throw new Error("invalid implementation content");
    return { path: file.path, content: file.content };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error("duplicate implementation path");
  const bytes = files.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0);
  if (bytes > MAX_BYTES) throw new Error("implementation submission is too large");
  if (!files.some((file) => file.path.startsWith("src/"))) throw new Error("implementation needs a product source file");
  return files;
}
