"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBillingFetch } from "./use-billing-list";

type Kind = "gst" | "vat";

export function TaxRatesTab({ canEdit }: { canEdit: boolean }) {
  const rates = useBillingFetch<{ gst: number[]; vat: number[] }>(
    "/api/billing/tax-rates",
    (j) => ({ gst: (j.gst as number[]) ?? [], vat: (j.vat as number[]) ?? [] }),
    { gst: [], vat: [] },
  );
  const [draft, setDraft] = useState<Record<Kind, string>>({ gst: "", vat: "" });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const add = (kind: Kind) => {
    const n = Number(draft[kind]);
    if (draft[kind] === "" || !Number.isFinite(n) || n < 0 || n > 100) {
      toast.error("Enter a rate between 0 and 100");
      return;
    }
    rates.setData((d) => ({ ...d, [kind]: [...new Set([...d[kind], n])].sort((a, b) => a - b) }));
    setDraft((x) => ({ ...x, [kind]: "" }));
    setDirty(true);
  };
  const remove = (kind: Kind, r: number) => {
    rates.setData((d) => ({ ...d, [kind]: d[kind].filter((x) => x !== r) }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/billing/tax-rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rates.data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not save");
        return;
      }
      rates.setData({ gst: json.gst, vat: json.vat });
      setDirty(false);
      toast.success("Tax rates saved");
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  if (rates.error) return <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">{rates.error}</p>;
  if (rates.loading && !rates.data.gst.length) return <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">These fill every GST rate dropdown on quotations and particulars.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {(["gst", "vat"] as const).map((kind) => (
          <div key={kind} className="rounded-xl border bg-card p-4">
            <h3 className="text-sm font-semibold">{kind.toUpperCase()} Rate Details</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {rates.data[kind].map((r) => (
                <span key={r} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-sm tabular-nums">
                  {r}%
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove(kind, r)}
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                      aria-label={`Remove ${r}%`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {!rates.data[kind].length && <span className="text-sm text-muted-foreground">None</span>}
            </div>
            {canEdit && (
              <div className="mt-3 flex gap-2">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={draft[kind]}
                  onChange={(e) => setDraft((x) => ({ ...x, [kind]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && add(kind)}
                  placeholder="Rate %"
                  className="h-8 w-28"
                />
                <Button size="sm" variant="outline" onClick={() => add(kind)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> {kind.toUpperCase()} Rate
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={!dirty || saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
