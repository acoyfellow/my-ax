import { describe, expect, it } from "vitest";
import type { RadarService } from "../types";
import type { ConnectorRunner } from "./connector-tools";
import { RADAR_SERVER_ID, withRadar } from "./radar-connector";

const brief = { id: "2610.1", title: "T", score: 91, reason: "r", summary: "s", link: "https://arxiv.org/abs/2610.1", published: "2026-10-01", categories: ["cs.AI"] };

function fakeRadar(calls: unknown[][]): RadarService {
  return {
    cycles: async (count) => (calls.push(["cycles", count]), []),
    top: async (request) => (calls.push(["top", request]), [brief]),
    paper: async (id) => (calls.push(["paper", id]), { id }),
    search: async (query, limit, minScore) => (calls.push(["search", query, limit, minScore]), [brief]),
  };
}

const emptyBase: ConnectorRunner = { list: async () => [], call: async () => "base" };

describe("withRadar", () => {
  it("leaves the runner alone when the binding is missing", () => {
    expect(withRadar(emptyBase, undefined)).toBe(emptyBase);
  });

  it("lists radar tools ahead of the owner's connectors, even if they fail", async () => {
    const failing: ConnectorRunner = { list: async () => Promise.reject(new Error("down")), call: async () => "" };
    const names = (await withRadar(failing, fakeRadar([])).list()).map((tool) => tool.name);

    expect(names).toEqual(["radar__top", "radar__paper", "radar__search", "radar__cycles"]);
  });

  it("forwards typed arguments and drops junk", async () => {
    const calls: unknown[][] = [];
    const runner = withRadar(emptyBase, fakeRadar(calls));

    expect(JSON.parse(await runner.call(RADAR_SERVER_ID, "top", { minScore: 90, limit: "5" }))).toEqual([brief]);
    expect(calls[0]).toEqual(["top", { minScore: 90, cycles: undefined, limit: undefined }]);
  });

  it("returns an error result instead of throwing on bad input", async () => {
    const result = JSON.parse(await withRadar(emptyBase, fakeRadar([])).call(RADAR_SERVER_ID, "paper", {}));

    expect(result).toEqual({ ok: false, error: "radar: id is required" });
  });

  it("passes other servers through to the base runner", async () => {
    expect(await withRadar(emptyBase, fakeRadar([])).call("github", "x", {})).toBe("base");
  });
});
