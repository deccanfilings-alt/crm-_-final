import { describe, it, expect } from "vitest";
import {
  DEFAULT_CUSTOMIZABLE_HREFS,
  reorderNavHrefs,
  togglePinnedHref,
  applySidebarPinOrder,
  mergeNavHrefsWithDefaults,
} from "./use-sidebar-preferences";

describe("sidebar-preferences pure logic", () => {
  it("reorders items correctly using arrayMove behavior", () => {
    const initial = ["/team-chat", "/contacts", "/pipelines", "/quotations"];
    // Move /quotations to position of /team-chat (index 0)
    const reordered = reorderNavHrefs(initial, "/quotations", "/team-chat");
    expect(reordered).toEqual(["/quotations", "/team-chat", "/contacts", "/pipelines"]);
  });

  it("leaves order unchanged when moving item to itself or if item not found", () => {
    const initial = ["/team-chat", "/contacts"];
    expect(reorderNavHrefs(initial, "/team-chat", "/team-chat")).toEqual(initial);
    expect(reorderNavHrefs(initial, "/nonexistent", "/team-chat")).toEqual(initial);
  });

  it("toggles pinned state on and off", () => {
    const pinned1 = togglePinnedHref([], "/quotations");
    expect(pinned1).toEqual(["/quotations"]);

    const pinned2 = togglePinnedHref(pinned1, "/action-items");
    expect(pinned2).toEqual(["/quotations", "/action-items"]);

    const pinned3 = togglePinnedHref(pinned2, "/quotations");
    expect(pinned3).toEqual(["/action-items"]);
  });

  it("moves pinned item to the front of order", () => {
    const initial = ["/team-chat", "/contacts", "/quotations", "/pipelines"];
    const updated = applySidebarPinOrder(initial, "/quotations");
    expect(updated).toEqual(["/quotations", "/team-chat", "/contacts", "/pipelines"]);
  });

  it("merges stored order with default hrefs to handle new routes safely", () => {
    const saved = ["/quotations", "/team-chat"];
    const merged = mergeNavHrefsWithDefaults(saved);
    expect(merged[0]).toBe("/quotations");
    expect(merged[1]).toBe("/team-chat");
    expect(merged.length).toBe(DEFAULT_CUSTOMIZABLE_HREFS.length);
    // Contains all other default items
    expect(merged).toContain("/contacts");
    expect(merged).toContain("/pipelines");
  });
});
