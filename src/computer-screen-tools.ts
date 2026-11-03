import type { Sandbox } from "@cloudflare/sandbox";
import { COMPUTER_SCREEN_PORT, ensureComputerDisplay, getNamedComputer } from "./named-computer";
import { storeInlineMediaArtifact } from "./uploads";
import type { ToolContext, ToolDef } from "./types";

const ID_PARAM = { type: "string", description: "Computer id: lowercase letters, digits, hyphens" };
const MAX_RECORD_SECONDS = 30;
const MAX_WAIT_MS = 60_000;

export type ScreenWaitQuery = { idle?: number; change?: boolean; region?: string; since?: number; timeout?: number };

export function screenWaitPath(query: ScreenWaitQuery): string {
  const params = new URLSearchParams();
  if (query.change) params.set("change", "");
  if (typeof query.idle === "number") params.set("idle", String(Math.max(0, Math.min(MAX_WAIT_MS, Math.round(query.idle)))));
  if (typeof query.region === "string" && /^\d+,\d+,\d+,\d+$/.test(query.region)) params.set("region", query.region);
  if (typeof query.since === "number" && Number.isInteger(query.since) && query.since >= 0) params.set("since", String(query.since));
  params.set("timeout", String(Math.max(100, Math.min(MAX_WAIT_MS, Math.round(query.timeout ?? 10_000)))));
  return `/wait?${params.toString().replace(/change=(&|$)/, "change$1")}`;
}

export function screenRecordPath(seconds: unknown): string {
  const value = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : 5;
  return `/record?seconds=${Math.max(1, Math.min(MAX_RECORD_SECONDS, Math.round(value)))}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function screenFetch(sandbox: Sandbox, path: string): Promise<Response> {
  await ensureComputerDisplay(sandbox);
  const response = await sandbox.containerFetch(`http://localhost:${COMPUTER_SCREEN_PORT}${path}`, COMPUTER_SCREEN_PORT);
  if (!response.ok) throw new Error(`voxl ${path.split("?")[0]} returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response;
}

function openScreen(args: Record<string, unknown>, ctx: ToolContext) {
  return getNamedComputer(ctx.env, ctx.identity, typeof args.id === "string" ? args.id : "");
}

async function storeMedia(ctx: ToolContext, mime: string, response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const artifact = await storeInlineMediaArtifact(ctx.env, ctx.identity, `data:${mime};base64,${bytesToBase64(bytes)}`);
  if (!artifact) throw new Error("screen capture could not be stored");
  return artifact;
}

export const COMPUTER_SCREENSHOT_TOOL: ToolDef = {
  name: "computer_screenshot",
  description: "Capture a named computer's screen as a PNG shown in the chat. Returns seq: pass it to computer_wait as since to wait for what an action changes.",
  parameters: { type: "object", properties: { id: ID_PARAM }, required: ["id"] },
  execute: async (args, ctx) => {
    const { sandbox, computerId } = await openScreen(args, ctx);
    const response = await screenFetch(sandbox, "/screenshot");
    const seq = Number(response.headers.get("x-voxl-seq") ?? Number.NaN);
    const artifact = await storeMedia(ctx, "image/png", response);
    return JSON.stringify({ ...artifact, computerId, ...(Number.isFinite(seq) ? { seq } : {}) });
  },
};

export const COMPUTER_WAIT_TOOL: ToolDef = {
  name: "computer_wait",
  description: "Wait until a named computer's screen settles (idle ms with no change, default 300) or, with change: true, until it first changes. region \"x,y,w,h\" watches one area; since takes a seq from computer_screenshot or an earlier wait. Use this instead of sleeping after an action.",
  parameters: {
    type: "object",
    properties: {
      id: ID_PARAM,
      idle: { type: "number", description: "Milliseconds the screen must stay still. Default 300." },
      change: { type: "boolean", description: "Return at the first change instead of waiting for stillness." },
      region: { type: "string", description: "Only watch x,y,w,h in screen pixels." },
      since: { type: "number", description: "seq from a screenshot or earlier wait; returns at once if anything changed after it." },
      timeout: { type: "number", description: "Give up after this many ms. Default 10000, max 60000." },
    },
    required: ["id"],
  },
  execute: async (args, ctx) => {
    const { sandbox, computerId } = await openScreen(args, ctx);
    const response = await screenFetch(sandbox, screenWaitPath(args as ScreenWaitQuery));
    return JSON.stringify({ computerId, ...(await response.json() as Record<string, unknown>) });
  },
};

export const COMPUTER_RECORD_TOOL: ToolDef = {
  name: "computer_record",
  description: `Record the next seconds (1-${MAX_RECORD_SECONDS}, default 5) of a named computer's screen as an MP4 shown in the chat.`,
  parameters: {
    type: "object",
    properties: { id: ID_PARAM, seconds: { type: "number", description: `1-${MAX_RECORD_SECONDS}, default 5.` } },
    required: ["id"],
  },
  execute: async (args, ctx) => {
    const { sandbox, computerId } = await openScreen(args, ctx);
    const response = await screenFetch(sandbox, screenRecordPath(args.seconds));
    return JSON.stringify({ ...(await storeMedia(ctx, "video/mp4", response)), computerId });
  },
};
