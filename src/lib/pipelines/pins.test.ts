import { describe, expect, it } from "vitest";

import { pickDefaultPipeline, splitPinnedPipelines } from "./pins";

const P = (id: string) => ({ id });
const list = [P("a"), P("b"), P("c"), P("d")];

describe("splitPinnedPipelines", () => {
  it("puts pinned pipelines first, in the order they were pinned", () => {
    const { pinned, others } = splitPinnedPipelines(list, ["c", "a"]);
    expect(pinned.map((p) => p.id)).toEqual(["c", "a"]);
    expect(others.map((p) => p.id)).toEqual(["b", "d"]);
  });

  it("ignores pins for pipelines that no longer exist, and duplicates", () => {
    const { pinned, others } = splitPinnedPipelines(list, ["gone", "b", "b"]);
    expect(pinned.map((p) => p.id)).toEqual(["b"]);
    expect(others).toHaveLength(3);
  });

  it("handles no pins", () => {
    const { pinned, others } = splitPinnedPipelines(list, []);
    expect(pinned).toEqual([]);
    expect(others).toEqual(list);
  });
});

describe("pickDefaultPipeline", () => {
  it("prefers the pipeline named in the URL", () => {
    expect(pickDefaultPipeline(list, ["c"], { queryId: "b" })).toBe("b");
  });

  it("keeps a valid current selection", () => {
    expect(pickDefaultPipeline(list, ["c"], { currentId: "d" })).toBe("d");
  });

  it("falls back to the first pinned pipeline that still exists", () => {
    expect(pickDefaultPipeline(list, ["gone", "c", "a"])).toBe("c");
  });

  it("falls back to the first pipeline, or empty when there are none", () => {
    expect(pickDefaultPipeline(list, [])).toBe("a");
    expect(pickDefaultPipeline([], ["a"])).toBe("");
  });

  it("ignores a URL or selection pointing at a missing pipeline", () => {
    expect(pickDefaultPipeline(list, ["c"], { queryId: "zzz", currentId: "yyy" })).toBe("c");
  });
});
