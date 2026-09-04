import { describe, expect, it } from "vitest";
import { outboundMessageText } from "./outbound-message";

describe("outboundMessageText", () => {
  it("preserves the first sent character", () => {
    expect(outboundMessageText("hello")).toBe("hello");
  });

  it("preserves intentional leading whitespace", () => {
    expect(outboundMessageText("  indented\n    code")).toBe("  indented\n    code");
  });
});
