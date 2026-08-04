import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessReauthenticationHref, responseRequiresAuthentication } from "./auth-recovery";

describe("Access authentication recovery", () => {
  it("recognizes rejected and redirected API responses", () => {
    assert.equal(responseRequiresAuthentication(new Response("", { status: 401 })), true);
    assert.equal(responseRequiresAuthentication(new Response("", { status: 403 })), true);
    assert.equal(responseRequiresAuthentication({ type: "opaqueredirect", status: 0 } as Response), true);
    assert.equal(responseRequiresAuthentication(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })), false);
    assert.equal(responseRequiresAuthentication(new Response("login", { status: 200, headers: { "content-type": "text/html" } })), true);
  });

  it("forces Access sign-in and preserves the active conversation", () => {
    const href = accessReauthenticationHref("https://agent.example.com", "session-1");
    const url = new URL(href, "https://agent.example.com");
    assert.equal(url.pathname, "/cdn-cgi/access/logout");
    const returnUrl = new URL(url.searchParams.get("returnTo")!);
    assert.equal(returnUrl.origin, "https://agent.example.com");
    assert.equal(returnUrl.searchParams.get("session"), "session-1");
    assert.equal(returnUrl.searchParams.get("reauthenticated"), "1");
  });
});
