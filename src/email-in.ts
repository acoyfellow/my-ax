export type ParsedEmail = { subject: string; body: string };

export function parseRawEmail(raw: string): ParsedEmail {
  const headEnd = raw.indexOf("\r\n\r\n");
  const head = headEnd >= 0 ? raw.slice(0, headEnd) : raw;
  const body = headEnd >= 0 ? raw.slice(headEnd + 4) : "";
  const subjectLine = head.split("\r\n").find((line) => /^subject:/i.test(line));
  const subject = subjectLine ? subjectLine.replace(/^subject:\s*/i, "").trim().slice(0, 200) : "";
  return { subject, body: body.trim().slice(0, 50_000) };
}

export function emailEnabled(env: { EMAIL_ENABLED?: string }): boolean {
  return env.EMAIL_ENABLED === "1";
}

export type SendEmailInput = { to: string; subject: string; body: string };

export async function sendEmail(env: { RESEND_API_KEY?: string; EMAIL_FROM?: string; fetch?: typeof fetch }, input: SendEmailInput): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY is not set" };
  const from = env.EMAIL_FROM ?? "my.ax <noreply@my.ax.cloudflare.dev>";
  const doFetch = env.fetch ?? fetch;
  const response = await doFetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.body }),
  });
  if (!response.ok) return { ok: false, error: `resend ${response.status}` };
  return { ok: true };
}
