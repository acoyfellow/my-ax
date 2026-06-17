// oauth-store-facade.ts — tiny helper to build the OAuthClientStore
// facade from a Hono request context + the env binding. Shared by
// connector routes, MCP CRUD routes, and the /api status endpoint.

import { makeOAuthClientStore } from "./oauth-store";
import type { Env } from "./types";

export function oauthStoreFor(c: { req: { url: string }; env: Env }) {
  const origin = new URL(c.req.url).origin;
  return makeOAuthClientStore(c.env.OAUTH_CLIENT!, origin);
}
