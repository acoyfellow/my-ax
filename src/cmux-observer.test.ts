import { describe, expect, it } from "vitest";
import { observeCmux, type CmuxReadRequest } from "./cmux-observer";

const status = JSON.stringify({
  workspaces: [{ id: "workspace-1", surfaces: [{ id: "surface-1", title: "Pi" }] }],
});

function readerWithTail(tail: string) {
  const calls: CmuxReadRequest[] = [];
  return {
    calls,
    reader: async (request: CmuxReadRequest) => {
      calls.push(request);
      return request.kind === "status" ? status : tail;
    },
  };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("observeCmux", () => {
  it("caps terminal tails and marks the observation truncated", async () => {
    const fake = readerWithTail("abcdefgh");
    const observation = await observeCmux({ root: "cmux", surfaceIds: ["surface-1"], tailBytes: 4 }, { reader: fake.reader });

    expect(observation.tail).toBe("workspace-1/surface-1\nabcd");
    expect(observation.truncated).toBe(true);
    expect(fake.calls).toEqual([
      { kind: "status", root: "cmux" },
      { kind: "tail", root: "cmux", workspaceId: "workspace-1", surfaceId: "surface-1", maxBytes: 4 },
    ]);
  });

  it("caps reported status surfaces", async () => {
    const manySurfaces = JSON.stringify({
      workspaces: [{ id: "workspace-1", surfaces: [
        { id: "surface-1" },
        { id: "surface-2" },
        { id: "surface-3" },
      ] }],
    });
    const calls: CmuxReadRequest[] = [];
    const observation = await observeCmux({ root: "cmux" }, {
      reader: async (request) => {
        calls.push(request);
        return manySurfaces;
      },
      maxSurfaces: 2,
    });

    expect(observation.surfaces).toHaveLength(2);
    expect(observation.truncated).toBe(true);
    expect(calls).toEqual([{ kind: "status", root: "cmux" }]);
  });

  it("rejects steering-style fields before invoking the reader", async () => {
    const fake = readerWithTail("safe");

    await expect(observeCmux({ root: "cmux", surfaceIds: ["surface-1"], focus: true }, { reader: fake.reader })).rejects.toThrow("unsupported field");
    expect(fake.calls).toEqual([]);
  });

  it("rejects roots outside the fixed allow-list", async () => {
    const fake = readerWithTail("safe");

    await expect(observeCmux({ root: "../../etc", surfaceIds: ["surface-1"] }, { reader: fake.reader })).rejects.toThrow("not allow-listed");
    expect(fake.calls).toEqual([]);
  });

  it("redacts secrets from returned tails", async () => {
    const fake = readerWithTail("token=super-secret-value\nnormal output");
    const observation = await observeCmux({ root: "cmux", surfaceIds: ["surface-1"] }, { reader: fake.reader });

    expect(observation.redacted).toBe(true);
    expect(observation.tail).toContain("[REDACTED]");
    expect(observation.tail).not.toContain("super-secret-value");
  });

  it("hashes raw observed blobs and records the observation time", async () => {
    const rawTail = "raw terminal output";
    const fake = readerWithTail(rawTail);
    const observation = await observeCmux({ root: "cmux", surfaceIds: ["surface-1"] }, {
      reader: fake.reader,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });

    expect(observation.hashes.status).toBe(await sha256(status));
    expect(observation.hashes.tails["surface-1"]).toBe(await sha256(rawTail));
    expect(observation.observedAt).toBe("2026-08-11T00:00:00.000Z");
  });
});
