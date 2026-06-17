import puppeteer from "@cloudflare/puppeteer";
import { jsonSchema, tool, type ToolSet } from "ai";
import type { Env } from "./types";
import type { AccessIdentity } from "./auth";
import { storeInlineRasterArtifact } from "./uploads";
import { safePublicHttpUrl } from "./public-url";

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
  /** Durable exact captured viewport shown when DOM replay cannot reload remote assets. */
  screenshotSrc?: string;
  replayMotion?: "inspection-scroll";
  error?: string;
}

/**
 * Small visual-browser surface for Think.
 *
 * Browser Run records replayable rrweb session events when recording=true.
 * This is not an Unsurf mp4 trace yet; the output says so explicitly rather
 * than suggesting a video/viewer URL that the app does not own.
 */
export function createMyAxBrowserTools(env: Env, identity?: () => AccessIdentity | undefined, ownerSessionId?: () => string): ToolSet {
  return {
    browser_open: tool<Record<string, unknown>, BrowserRunResult>({
      description: "Open a public web page in Cloudflare Browser Run, capture a rendered text preview, and create an inline visual replay with a short observation window so playback is inspectable. Use for public web browsing and visible UI checks; do not claim authenticated access.",
      inputSchema: jsonSchema<Record<string, unknown>>({
        type: "object",
        properties: {
          url: { type: "string", description: "Public http/https URL to open" },
        },
        required: ["url"],
      }),
      execute: async (input) => {
        const raw = String(input.url ?? "");
        const url = safePublicHttpUrl(raw);
        if (!url) return { kind: "browser-run", status: "error", url: raw, recorded: false, recordingFormat: "rrweb", note: "Browser Run did not start.", error: "URL must be public http/https without credentials or private/loopback addressing." };
        const browser = await puppeteer.launch(env.BROWSER, { recording: true });
        const sessionId = browser.sessionId();
        try {
          const page = await browser.newPage();
          await page.setRequestInterception(true);
          page.on("request", (request) => {
            if (safePublicHttpUrl(request.url())) void request.continue();
            else void request.abort("blockedbyclient");
          });
          await page.setViewport({ width: 430, height: 760 });
          await page.goto(url.href, { waitUntil: "load", timeout: 20_000 });
          const finalUrl = safePublicHttpUrl(page.url());
          if (!finalUrl) throw new Error("Navigation redirected to a forbidden private or non-http destination.");
          const title = await page.title();
          const textPreview = await page.evaluate((limit) => document.body?.innerText?.slice(0, limit) ?? "", MAX_PREVIEW);
          // rrweb replays DOM events and can later fail to reload remote image
          // assets. Preserve the originally rendered viewport as an owned R2
          // raster artifact so the tool card always has durable visual proof.
          let screenshotSrc: string | undefined;
          const owner = identity?.();
          const ownerSession = ownerSessionId?.();
          if (owner && ownerSession) {
            await env.DB.prepare("INSERT OR REPLACE INTO browser_recordings(id, owner_email, session_id, created_at) VALUES (?, ?, ?, datetime('now'))")
              .bind(sessionId, owner.email.toLowerCase(), ownerSession).run();
          }
          if (owner) {
            try {
              const screenshot = await page.screenshot({ type: "png", encoding: "base64" }) as string;
              const artifact = await storeInlineRasterArtifact(env, owner, `data:image/png;base64,${screenshot}`);
              screenshotSrc = artifact?.src;
            } catch {
              // Screenshot persistence is a visual fallback only; never make a
              // successful browse/replay fail solely because storage is down.
            }
          }
          // Browser Run recordings need observable rrweb events over time; an
          // idle wait after load still produces an unplayable near-static
          // snapshot. Perform a harmless inspection scroll so the inline
          // replay has real motion and a useful timeline to scrub.
          await new Promise((resolve) => setTimeout(resolve, REPLAY_SETTLE_MS));
          await page.mouse.move(16, 16);
          await new Promise((resolve) => setTimeout(resolve, REPLAY_SETTLE_MS));
          await page.mouse.move(210, 180, { steps: 10 });
          await page.evaluate(() => window.scrollTo({ top: Math.min(240, document.documentElement.scrollHeight), behavior: "smooth" }));
          await new Promise((resolve) => setTimeout(resolve, REPLAY_SETTLE_MS));
          await page.mouse.move(360, 620, { steps: 10 });
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
          await new Promise((resolve) => setTimeout(resolve, REPLAY_SETTLE_MS));
          return {
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
            replayUrl: `/browser/replay/${encodeURIComponent(sessionId)}`,
            screenshotSrc,
          };
        } catch (error) {
          return { kind: "browser-run", status: "error", url: url.href, sessionId, recorded: true, recordingFormat: "rrweb", note: "Browser Run recorded this failed attempt.", error: error instanceof Error ? error.message : String(error) };
        } finally {
          await browser.close().catch(() => browser.disconnect());
        }
      },
    }),
  };
}
