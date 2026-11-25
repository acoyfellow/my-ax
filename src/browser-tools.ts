import puppeteer from "@cloudflare/puppeteer";
import type { ToolDef } from "./types";
import { saveBrowserRecording, type RecordDb } from "./domain/records";
import { storeInlineRasterArtifact } from "./uploads";
import { safePublicHttpUrl } from "./public-url";
import { formatKilledByOwner } from "./killable-shell";

const MAX_PREVIEW = 2_000;
const REPLAY_SETTLE_MS = 700;

export interface BrowserRunResult {
  kind: "browser-run";
  status: "done" | "error";
  url: string;
  title?: string;
  textPreview?: string;
  sessionId?: string;
  recorded: boolean;
  recordingFormat: "rrweb";
  note: string;
  replayUrl?: string;
  screenshotSrc?: string;
  replayMotion?: "inspection-scroll";
  error?: string;
}

function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export const BROWSER_OPEN_TOOL: ToolDef = {
  name: "browser_open",
  description: "Open a public web page in Cloudflare Browser Run, capture a rendered text preview, and create an inline visual replay with a short observation window so playback is inspectable. Use for public web browsing and visible UI checks; do not claim authenticated access.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Public http/https URL to open" },
    },
    required: ["url"],
  },
  execute: async (input, ctx) => {
    const startedAt = Date.now();
    const signal = ctx.signal;
    const raw = String(input.url ?? "");
    const url = safePublicHttpUrl(raw);
    if (!url) {
      return JSON.stringify({
        kind: "browser-run",
        status: "error",
        url: raw,
        recorded: false,
        recordingFormat: "rrweb",
        note: "Browser Run did not start.",
        error: "URL must be public http/https without credentials or private/loopback addressing.",
      } satisfies BrowserRunResult);
    }
    if (signal?.aborted) return formatKilledByOwner({ tool: "browser_open", elapsedMs: 0, terminated: true });
    const browser = await puppeteer.launch(ctx.env.BROWSER, { recording: true });
    const sessionId = browser.sessionId();
    const closeBrowser = () => { void browser.close().catch(() => browser.disconnect()); };
    signal?.addEventListener("abort", closeBrowser, { once: true });
    try {
      if (signal?.aborted) return formatKilledByOwner({ tool: "browser_open", elapsedMs: Date.now() - startedAt, terminated: true });
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        if (!signal?.aborted && safePublicHttpUrl(request.url())) void request.continue();
        else void request.abort("blockedbyclient");
      });
      await page.setViewport({ width: 430, height: 760 });
      await page.goto(url.href, { waitUntil: "load", timeout: 20_000 });
      if (signal?.aborted) return formatKilledByOwner({ tool: "browser_open", elapsedMs: Date.now() - startedAt, terminated: true });
      const finalUrl = safePublicHttpUrl(page.url());
      if (!finalUrl) throw new Error("Navigation redirected to a forbidden private or non-http destination.");
      const title = await page.title();
      const textPreview = await page.evaluate((limit) => document.body?.innerText?.slice(0, limit) ?? "", MAX_PREVIEW);
      let screenshotSrc: string | undefined;
      let replayUrl: string | undefined;
      try {
        await saveBrowserRecording(ctx.env.DB as unknown as RecordDb, sessionId, ctx.identity.email.toLowerCase(), ctx.sessionId);
        replayUrl = `/browser/replay/${encodeURIComponent(sessionId)}`;
      } catch {
        replayUrl = undefined;
      }
      try {
        const screenshot = await page.screenshot({ type: "png", encoding: "base64" }) as string;
        const artifact = await storeInlineRasterArtifact(ctx.env, ctx.identity, `data:image/png;base64,${screenshot}`);
        screenshotSrc = artifact?.src;
      } catch {}
      await sleepOrAbort(REPLAY_SETTLE_MS, signal);
      await page.mouse.move(16, 16);
      await sleepOrAbort(REPLAY_SETTLE_MS, signal);
      await page.mouse.move(210, 180, { steps: 10 });
      await page.evaluate(() => window.scrollTo({ top: Math.min(240, document.documentElement.scrollHeight), behavior: "smooth" }));
      await sleepOrAbort(REPLAY_SETTLE_MS, signal);
      await page.mouse.move(360, 620, { steps: 10 });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await sleepOrAbort(REPLAY_SETTLE_MS, signal);
      return JSON.stringify({
        kind: "browser-run",
        status: "done",
        url: page.url(),
        title,
        textPreview,
        sessionId,
        recorded: true,
        recordingFormat: "rrweb",
        note: "Recorded by Cloudflare Browser Run with harmless inspection pointer movement and scroll so inline playback has visible motion and a scrub-able timeline.",
        replayMotion: "inspection-scroll",
        replayUrl,
        screenshotSrc,
      } satisfies BrowserRunResult);
    } catch (error) {
      if (signal?.aborted) {
        return formatKilledByOwner({ tool: "browser_open", elapsedMs: Date.now() - startedAt, terminated: true });
      }
      return JSON.stringify({
        kind: "browser-run",
        status: "error",
        url: url.href,
        sessionId,
        recorded: true,
        recordingFormat: "rrweb",
        note: "Browser Run recorded this failed attempt.",
        error: error instanceof Error ? error.message : String(error),
      } satisfies BrowserRunResult);
    } finally {
      signal?.removeEventListener("abort", closeBrowser);
      await browser.close().catch(() => browser.disconnect());
    }
  },
};
