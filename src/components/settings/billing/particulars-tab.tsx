"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, MoreVertical, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ParticularDialog, type Particular } from "./particular-dialog";
import { useBillingFetch } from "./use-billing-list";

const inr = (n: number | null) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);

export function ParticularsTab({ canEdit }: { canEdit: boolean }) {
  const list = useBillingFetch<Particular[]>("/api/billing/particulars", (j) => (j.particulars as Particular[]) ?? [], []);
  const rates = useBillingFetch<number[]>("/api/billing/tax-rates", (j) => (j.gst as number[]) ?? [], []);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Particular | null>(null);
  const [open, setOpen] = useState(false);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list.data;
    return list.data.filter((p) =>
      [p.name, p.service_name, p.sac_code, p.description].some((v) => (v ?? "").toLowerCase().includes(t)),
    );
  }, [list.data, q]);

  const remove = async (p: Particular) => {
    if (!window.confirm(`Delete "${p.name}"? Quotations that used it keep their text.`)) return;
    const res = await fetch(`/api/billing/particulars/${p.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Could not delete");
      return;
    }
    toast.success("Deleted");
    list.setData((d) => d.filter((x) => x.id !== p.id));
  };

  if (list.error) return <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">{list.error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search particulars, service, SAC" className="pl-8" />
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Particulars
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">No.</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Service</th>
              <th className="px-3 py-2 text-right font-medium">GST Rate</th>
              <th className="px-3 py-2 text-left font-medium">SAC Code</th>
              <th className="px-3 py-2 text-left font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {list.loading && !list.data.length ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  {q ? "No matches." : "No particulars yet — add the services you bill for."}
                </td>
              </tr>
            ) : (
              visible.map((p, i) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.service_name ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.gst_rate != null ? `${Number(p.gst_rate)}%` : "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.sac_code ?? "—"}</td>
                  <td className="max-w-[260px] truncate px-3 py-2 text-muted-foreground" title={p.description ?? ""}>
                    {p.description ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(p.default_amount)}</td>
                  <td className="px-2 py-2">
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Actions for ${p.name}`}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="text-xs">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditing(p);
                              setOpen(true);
                            }}
                          >
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => remove(p)} className="text-destructive">
                            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ParticularDialog
        open={open}
        onOpenChange={setOpen}
        particular={editing}
        gstRates={rates.data}
        onSaved={(p) =>
          list.setData((d) => {
            const exists = d.some((x) => x.id === p.id);
            const next = exists ? d.map((x) => (x.id === p.id ? p : x)) : [...d, p];
            return next.sort((a, b) => a.name.localeCompare(b.name));
          })
        }
      />
    </div>
  );
}
