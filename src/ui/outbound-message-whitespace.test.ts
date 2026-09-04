import { describe, expect, it } from "vitest";
import { removeLeadingTemplateWhitespace } from "./outbound-message-whitespace";

describe("removeLeadingTemplateWhitespace", () => {
  it("removes the whitespace-only template node before outbound text", () => {
    const body = document.createElement("div");
    body.append(document.createTextNode("\n  "));
    body.append(document.createTextNode("hello"));

    removeLeadingTemplateWhitespace(body);

    expect(body.textContent).toBe("hello");
    expect(body.firstChild?.textContent).toBe("hello");
  });

  it("preserves intentional leading whitespace in content", () => {
    const body = document.createElement("div");
    body.append(document.createTextNode("  hello"));

    removeLeadingTemplateWhitespace(body);

    expect(body.textContent).toBe("  hello");
  });
});
