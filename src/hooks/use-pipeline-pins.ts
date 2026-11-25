"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";

// Codes for "table doesn't exist yet" (migration 079 not applied):
// Postgres undefined_table, and PostgREST's schema-cache miss.
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

/**
 * The signed-in user's pinned pipelines (table pipeline_pins, migration
 * 079). Pins are personal: row-level security limits every read and
 * write to the user's own rows.
 *
 * `available` turns false if the table isn't there yet, so the page can
 * hide the pin controls instead of showing errors.
 */
export function usePipelinePins() {
  const supabase = useMemo(() => createClient(), []);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);
  const pending = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("pipeline_pins")
        .select("pipeline_id")
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        if (MISSING_TABLE_CODES.has(error.code ?? "")) {
          setAvailable(false);
        } else {
          console.error("[usePipelinePins] load failed:", error.message);
        }
      } else {
        setPinnedIds((data ?? []).map((r) => r.pipeline_id as string));
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const isPinned = useCallback(
    (pipelineId: string) => pinnedIds.includes(pipelineId),
    [pinnedIds],
  );

  const togglePin = useCallback(
    async (pipelineId: string) => {
      // Ignore repeat clicks while the previous change for this
      // pipeline is still saving.
      if (pending.current.has(pipelineId)) return;
      pending.current.add(pipelineId);

      const wasPinned = pinnedIds.includes(pipelineId);
      // Optimistic update; reverted below if the save fails.
      setPinnedIds((prev) =>
        wasPinned
          ? prev.filter((id) => id !== pipelineId)
          : [...prev.filter((id) => id !== pipelineId), pipelineId],
      );

      const { error } = wasPinned
        ? await supabase
            .from("pipeline_pins")
            .delete()
            .eq("pipeline_id", pipelineId)
        : await supabase
            .from("pipeline_pins")
            .insert({ pipeline_id: pipelineId });

      pending.current.delete(pipelineId);

      // 23505 = already pinned (e.g. from another tab): treat as success.
      if (error && error.code !== "23505") {
        console.error("[usePipelinePins] save failed:", error.message);
        setPinnedIds((prev) =>
          wasPinned
            ? [...prev.filter((id) => id !== pipelineId), pipelineId]
            : prev.filter((id) => id !== pipelineId),
        );
        toast.error(wasPinned ? "Couldn't unpin pipeline" : "Couldn't pin pipeline");
        return;
      }
      toast.success(wasPinned ? "Pipeline unpinned" : "Pipeline pinned");
    },
    [pinnedIds, supabase],
  );

  return { pinnedIds, loaded, available, isPinned, togglePin };
}
