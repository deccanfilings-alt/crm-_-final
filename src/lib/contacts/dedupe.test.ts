import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canonicalPhone,
  dedupeByPhone,
  findExistingContact,
  getPhoneLookupKeys,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
} from "./dedupe";

describe("normalizeKey", () => {
  it("strips every non-digit", () => {
    expect(normalizeKey("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizeKey("15551234567")).toBe("15551234567");
  });

  it("collapses different formats of the same number to one key", () => {
    expect(normalizeKey("+44 7911 123456")).toBe(normalizeKey("447911123456"));
  });
});

describe("canonicalPhone", () => {
  it("prepends 91 to 10-digit Indian numbers", () => {
    expect(canonicalPhone("7995544799")).toBe("917995544799");
    expect(canonicalPhone("+91 79955 44799")).toBe("917995544799");
    expect(canonicalPhone("917995544799")).toBe("917995544799");
  });

  it("leaves other numbers as digits-only", () => {
    expect(canonicalPhone("+1 (555) 123-4567")).toBe("15551234567");
    expect(canonicalPhone("12345")).toBe("12345");
  });
});

describe("getPhoneLookupKeys", () => {
  it("generates both 10-digit and 12-digit variants for 10-digit numbers", () => {
    const keys = getPhoneLookupKeys("7995544799");
    expect(keys).toContain("7995544799");
    expect(keys).toContain("917995544799");
  });

  it("generates both 12-digit and 10-digit variants for 12-digit Indian numbers", () => {
    const keys = getPhoneLookupKeys("917995544799");
    expect(keys).toContain("917995544799");
    expect(keys).toContain("7995544799");
  });

  it("handles formatting and +91 prefix", () => {
    const keys = getPhoneLookupKeys("+91 79955 44799");
    expect(keys).toContain("917995544799");
    expect(keys).toContain("7995544799");
  });
});

describe("isExactMatch", () => {
  it("treats different formatting of the same digits as exact", () => {
    expect(isExactMatch({ id: "1", phone: "+1 555-123-4567" }, "15551234567")).toBe(
      true,
    );
  });

  it("is false for a trunk-variant (fuzzy) match", () => {
    // last-8 match but not the same full number
    expect(isExactMatch({ id: "1", phone: "37063949836" }, "370063949836")).toBe(
      false,
    );
  });
});

describe("isUniqueViolation", () => {
  it("detects Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: 23505 })).toBe(true);
  });
  it("detects unique violation messages from PostgREST/Supabase", () => {
    expect(
      isUniqueViolation({
        message: 'duplicate key value violates unique constraint "idx_contacts_account_phone_normalized"',
      })
    ).toBe(true);
    expect(
      isUniqueViolation({
        details: 'Key (account_id, phone_normalized)=(abc, 917995544799) already exists.',
      })
    ).toBe(true);
  });
  it("is false for other errors / non-objects", () => {
    expect(isUniqueViolation({ code: "23502" })).toBe(false);
    expect(isUniqueViolation({ message: "network timeout" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

describe("dedupeByPhone", () => {
  it("keeps the first occurrence and counts in-file duplicates", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "+1 555-1111", name: "A" },
      { phone: "15551111", name: "B" }, // same digits as #1
      { phone: "+1 555-2222", name: "C" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["A", "C"]);
    expect(duplicates).toBe(1);
  });

  it("drops rows with no digits", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "   " },
      { phone: "+1 555-3333" },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });

  it("deduplicates 10-digit and 12-digit (91) versions of the same Indian number", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "7995544799", name: "First" },
      { phone: "917995544799", name: "Second" },
    ]);
    expect(unique).toHaveLength(1);
    expect(unique[0].name).toBe("First");
    expect(duplicates).toBe(1);
  });
});

describe("findExistingContact", () => {
  // Minimal SupabaseClient stub: resolves the .from().select().eq().like()
  // and .or() chains to a fixed candidate set.
  function stubDb(rows: Array<{ id: string; phone: string; phone_normalized?: string }>): SupabaseClient {
    const builder = {
      select: () => builder,
      eq: () => builder,
      like: () => Promise.resolve({ data: rows, error: null }),
      or: () => Promise.resolve({ data: rows, error: null }),
    };
    return { from: () => builder } as unknown as SupabaseClient;
  }

  it("returns a trunk-variant match via phonesMatch", async () => {
    const db = stubDb([{ id: "c1", phone: "37063949836" }]);
    const hit = await findExistingContact(db, "acct", "+370 063 949 836");
    expect(hit?.id).toBe("c1");
  });

  it("matches contact when stored with spaces/formatting via phone_normalized", async () => {
    const db = stubDb([
      { id: "c1", phone: "+91 98765 43210", phone_normalized: "919876543210" },
    ]);
    const hit = await findExistingContact(db, "acct", "919876543210");
    expect(hit?.id).toBe("c1");
  });

  it("prefers exact match over fuzzy match when multiple candidates exist", async () => {
    const db = stubDb([
      { id: "fuzzy", phone: "370063949836" },
      { id: "exact", phone: "37063949836" },
    ]);
    const hit = await findExistingContact(db, "acct", "+370 63 949 836");
    expect(hit?.id).toBe("exact");
  });

  it("returns null when no candidate matches", async () => {
    const db = stubDb([{ id: "c1", phone: "15559999999" }]);
    const hit = await findExistingContact(db, "acct", "+1 555-123-4567");
    expect(hit).toBeNull();
  });

  it("returns null for an empty phone without querying", async () => {
    const db = stubDb([{ id: "c1", phone: "15551234567" }]);
    expect(await findExistingContact(db, "acct", "   ")).toBeNull();
  });
});
