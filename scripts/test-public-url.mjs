import assert from "node:assert/strict";
import { safePublicHttpUrl } from "../src/public-url.ts";

for (const url of [
  "http://127.0.0.1/", "http://10.0.0.1/", "https://172.16.0.1/", "https://192.168.1.1/",
  "http://169.254.169.254/", "http://100.64.0.1/", "http://100.127.255.254/",
  "http://192.0.0.1/", "http://192.0.2.1/", "http://198.18.0.1/", "http://198.51.100.1/", "http://203.0.113.1/",
  "http://[::]/", "http://[::1]/", "https://[fd00::1]/", "https://[::ffff:127.0.0.1]/",
  "https://user:pass@example.com/", "file:///etc/passwd",
]) assert.equal(safePublicHttpUrl(url), null, url);

assert.equal(safePublicHttpUrl("https://example.com/path")?.hostname, "example.com");
assert.equal(safePublicHttpUrl("https://fcm.googleapis.com/fcm/send/token", { httpsOnly: true })?.hostname, "fcm.googleapis.com");
assert.equal(safePublicHttpUrl("http://example.com/")?.protocol, "http:");
assert.equal(safePublicHttpUrl("http://example.com/", { httpsOnly: true }), null);
console.log("✓ public URL policy negative cases");
