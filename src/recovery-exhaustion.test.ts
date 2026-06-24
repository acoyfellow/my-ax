import test from "node:test";
import assert from "node:assert/strict";
import { recoveryExhaustionContract } from "./recovery-exhaustion-contract";

test("recovery exhaustion contract is terminal, actionable, and owner-session linked", () => {
  assert.deepEqual(recoveryExhaustionContract("session/a", {
    terminalMessage: "Recovery stopped.", incidentId: "incident-1", reason: "no progress",
  }), {
    transcriptMeta: { status: "interrupted", recoveryIncidentId: "incident-1", recoveryReason: "no progress" },
    notification: {
      kind: "session.update",
      sessionId: "session/a",
      title: "My AX turn was interrupted",
      body: "Recovery stopped. Next action: open the conversation and try again.",
      href: "/?session=session%2Fa",
    },
  });
});

test("controlled proof labels the receipt truthfully", () => {
  const contract = recoveryExhaustionContract("proof-session", {
    terminalMessage: "proof", incidentId: "proof-1", reason: "controlled", proof: true,
  });
  assert.equal(contract.notification.title, "Recovery receipt proof");
  assert.match(contract.notification.body, /Controlled proof/);
});
