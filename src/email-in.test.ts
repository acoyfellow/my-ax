import assert from "node:assert/strict";
import { test } from "node:test";
import { emailEnabled, parseRawEmail, sendEmail } from "./email-in";

test("parses subject and body from a raw message", () => {
  const parsed = parseRawEmail("From: a@b\r\nTo: c@d\r\nSubject: Hello there\r\n\r\nBody text here");
  assert.equal(parsed.subject, "Hello there");
  assert.equal(parsed.body, "Body text here");
});

test("missing subject becomes empty and body is empty without a header block", () => {
  const parsed = parseRawEmail("From: a@b");
  assert.equal(parsed.subject, "");
  assert.equal(parsed.body, "");
});

test("email is off unless explicitly enabled", () => {
  assert.equal(emailEnabled({}), false);
  assert.equal(emailEnabled({ EMAIL_ENABLED: "1" }), true);
});

test("sending without a Resend key fails loudly instead of silently dropping", async () => {
  const result = await sendEmail({}, { to: "a@b", subject: "s", body: "b" });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /RESEND_API_KEY/);
});
