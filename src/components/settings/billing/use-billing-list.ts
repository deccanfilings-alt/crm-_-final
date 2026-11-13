"use client";

import { useCallback, useEffect, useState } from "react";

/** Load a /api/billing/* list; `error` carries "run migration 076" etc. */
export function useBillingFetch<T>(url: string, pick: (json: Record<string, unknown>) => T, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not load");
        return;
      }
      setError(null);
      setData(pick(json));
    } catch {
      setError("Network error — please refresh");
    } finally {
      setLoading(false);
    }
    // `pick` is a stable inline selector in every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, loading, error, reload };
}

export const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
