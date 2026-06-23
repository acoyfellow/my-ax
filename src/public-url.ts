// Shared server-side destination policy for user/model supplied URLs.
// This is a fail-closed literal-host check. Redirect consumers must also
// validate the final URL because a public origin can redirect to a forbidden
// destination. DNS-level private resolution requires infrastructure support
// and must not be implied by this helper.

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::" || host === "::1" || host === "0.0.0.0") return true;
  if (/^(?:127|10)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const [a, b, c] = [Number(v4[1]), Number(v4[2]), Number(v4[3])];
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 0 && c === 0) return true;
    if (a === 192 && b === 0 && c === 2) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a === 0 || a >= 224) return true;
  }
  return host.includes(":") && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb") || host.startsWith("::ffff:"));
}

export function safePublicHttpUrl(raw: string, options: { httpsOnly?: boolean } = {}): URL | null {
  try {
    const url = new URL(raw);
    const protocolAllowed = options.httpsOnly ? url.protocol === "https:" : url.protocol === "https:" || url.protocol === "http:";
    if (!protocolAllowed || url.username || url.password || isPrivateHostname(url.hostname)) return null;
    return url;
  } catch { return null; }
}

/** Validate a credentialed/server-side outbound destination at its use site. */
export function requirePublicHttpsUrl(raw: string): URL {
  const url = safePublicHttpUrl(raw, { httpsOnly: true });
  if (!url) throw new Error("Outbound destination must be a public HTTPS URL without embedded credentials");
  return url;
}
