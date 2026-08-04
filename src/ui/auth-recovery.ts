export function responseRequiresAuthentication(response: Response): boolean {
  if (response.type === "opaqueredirect" || response.status === 0) return true;
  if (response.status === 401 || response.status === 403) return true;
  if (response.redirected) return true;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return response.ok && !contentType.includes("application/json");
}

export function accessReauthenticationHref(origin: string, sessionId: string | null): string {
  const returnUrl = new URL("/", origin);
  if (sessionId) returnUrl.searchParams.set("session", sessionId);
  returnUrl.searchParams.set("reauthenticated", "1");
  const logoutUrl = new URL("/cdn-cgi/access/logout", origin);
  logoutUrl.searchParams.set("returnTo", returnUrl.toString());
  return logoutUrl.pathname + logoutUrl.search;
}
