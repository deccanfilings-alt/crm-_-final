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
    const initial = ["/inbox", "/team-chat", "/contacts", "/quotations"];
    // Move /quotations to position of /inbox (index 0)
    const reordered = reorderNavHrefs(initial, "/quotations", "/inbox");
    expect(reordered).toEqual(["/quotations", "/inbox", "/team-chat", "/contacts"]);
  });

  it("leaves order unchanged when moving item to itself or if item not found", () => {
    const initial = ["/inbox", "/team-chat"];
    expect(reorderNavHrefs(initial, "/inbox", "/inbox")).toEqual(initial);
    expect(reorderNavHrefs(initial, "/nonexistent", "/inbox")).toEqual(initial);
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
    const initial = ["/inbox", "/team-chat", "/quotations", "/contacts"];
    const updated = applySidebarPinOrder(initial, "/quotations");
    expect(updated).toEqual(["/quotations", "/inbox", "/team-chat", "/contacts"]);
  });

  it("merges stored order with default hrefs to handle new routes safely", () => {
    const saved = ["/quotations", "/inbox"];
    const merged = mergeNavHrefsWithDefaults(saved);
    expect(merged[0]).toBe("/quotations");
    expect(merged[1]).toBe("/inbox");
    expect(merged.length).toBe(DEFAULT_CUSTOMIZABLE_HREFS.length);
    // Contains all other default items
    expect(merged).toContain("/team-chat");
    expect(merged).toContain("/contacts");
  });
});
