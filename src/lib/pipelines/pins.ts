import type { Pipeline } from "@/types";

/**
 * Splits pipelines into the ones this user pinned (in the order they
 * pinned them) and the rest (in their original order). Pins that point
 * at pipelines not in the list (deleted, or from another account) are
 * ignored.
 */
export function splitPinnedPipelines<T extends Pick<Pipeline, "id">>(
  pipelines: readonly T[],
  pinnedIds: readonly string[],
): { pinned: T[]; others: T[] } {
  const byId = new Map(pipelines.map((p) => [p.id, p]));
  const pinned: T[] = [];
  const seen = new Set<string>();
  for (const id of pinnedIds) {
    const p = byId.get(id);
    if (p && !seen.has(id)) {
      pinned.push(p);
      seen.add(id);
    }
  }
  const others = pipelines.filter((p) => !seen.has(p.id));
  return { pinned, others };
}

/**
 * The pipeline to open when the page loads: the one in the URL if it
 * exists, else the current selection if still valid, else the first
 * pinned pipeline, else the first pipeline. Empty string if none.
 */
export function pickDefaultPipeline(
  pipelines: readonly Pick<Pipeline, "id">[],
  pinnedIds: readonly string[],
  opts: { queryId?: string | null; currentId?: string | null } = {},
): string {
  const exists = (id?: string | null): id is string =>
    !!id && pipelines.some((p) => p.id === id);
  if (exists(opts.queryId)) return opts.queryId;
  if (exists(opts.currentId)) return opts.currentId;
  const firstPinned = pinnedIds.find((id) => exists(id));
  if (firstPinned) return firstPinned;
  return pipelines[0]?.id ?? "";
}
