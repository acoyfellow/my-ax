import { describe, expect, it } from "vitest";
import { createOutboundMessageDraft } from "./outbound-message";

describe("createOutboundMessageDraft", () => {
  it("keeps the exact first character for a normal outbound message", () => {
    expect(createOutboundMessageDraft("hello").text).toBe("hello");
  });

  it("keeps intentional leading whitespace while checking visible content separately", () => {
    const draft = createOutboundMessageDraft("  code\n    line");

    expect(draft.text).toBe("  code\n    line");
    expect(draft.hasVisibleContent).toBe(true);
  });

  it("recognizes whitespace-only drafts without rewriting them", () => {
    const draft = createOutboundMessageDraft("  \n");

    expect(draft.text).toBe("  \n");
    expect(draft.hasVisibleContent).toBe(false);
  });
});
