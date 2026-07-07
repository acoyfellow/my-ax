import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { getRasterArtifact, getUploadObject, storeImageUpload } from "../uploads";
import { getAudioMessageObject } from "../audio-messages";

export function registerUploadRoutes(app: Hono<AppEnv>) {
  app.post("/api/uploads", async (c) => {
    try {
      const form = await c.req.formData();
      const file = form.get("file");
      const sessionId = String(form.get("sessionId") ?? "draft");
      if (!(file instanceof File)) throw new Error("multipart field file is required");
      const attachment = await storeImageUpload(c.env, c.get("identity"), sessionId, file);
      return c.json<ApiResponse>({ ok: true, command: "POST /api/uploads", result: attachment, next_actions: [] }, 201);
    } catch (err) {
      return c.json<ApiResponse>({
        ok: false,
        command: "POST /api/uploads",
        error: { code: "UPLOAD_FAILED", message: err instanceof Error ? err.message : String(err) },
        next_actions: [],
      }, 400);
    }
  });

  app.get("/api/artifacts/:id", async (c) => {
    try {
      const obj = await getRasterArtifact(c.env, c.get("identity"), c.req.param("id"));
      if (!obj) throw new Error("artifact not found");
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("Cache-Control", "private, max-age=31536000, immutable");
      return new Response(obj.body, { headers });
    } catch {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
    }
  });

  app.get("/api/audio/:id", async (c) => {
    try {
      const obj = await getAudioMessageObject(c.env, c.get("identity"), c.req.param("id"));
      if (!obj) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Audio message not found or expired" }, next_actions: [] }, 404);
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("Content-Type", "audio/mpeg");
      // Clips are immutable and owner-private; cache within the TTL window.
      headers.set("Cache-Control", "private, max-age=86400");
      headers.set("Accept-Ranges", "bytes");
      return new Response(obj.body, { headers });
    } catch {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Audio message not found" }, next_actions: [] }, 404);
    }
  });

  app.get("/api/uploads/:key{.+}", async (c) => {
    try {
      const obj = await getUploadObject(c.env, c.get("identity"), c.req.param("key"));
      if (!obj) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Upload not found" }, next_actions: [] }, 404);
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("Cache-Control", "private, max-age=31536000, immutable");
      return new Response(obj.body, { headers });
    } catch {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Upload not found" }, next_actions: [] }, 404);
    }
  });
}
