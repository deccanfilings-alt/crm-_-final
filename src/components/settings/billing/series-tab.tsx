"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CalendarPlus, Loader2, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { financialYear, formatSeriesNumber } from "@/lib/billing/masters";
import { useBillingFetch } from "./use-billing-list";

interface Period {
  id?: string;
  prefix: string;
  suffix: string;
  applicable_from: string | null;
  applicable_to: string | null;
  starting_no: number;
  next_no: number;
}
interface Series {
  id: string;
  name: string;
  is_default: boolean;
  periods: Period[];
  next_number: string | null;
}

const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("-") : "—");

export function SeriesTab({ canEdit, docType = "quotation" }: { canEdit: boolean; docType?: "quotation" | "invoice" | "receipt" }) {
  const list = useBillingFetch<Series[]>(`/api/billing/series?doc_type=${docType}`, (j) => (j.series as Series[]) ?? [], []);
  const [editing, setEditing] = useState<Series | null>(null);
  const [rows, setRows] = useState<Period[]>([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const openEdit = (s: Series) => {
    setEditing(s);
    setName(s.name);
    setRows(s.periods.map((p) => ({ ...p })));
  };

  const setRow = (i: number, patch: Partial<Period>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const addFyRow = () => {
    const fy = financialYear();
    const base = rows[0];
    setRows((r) => [
      ...r,
      {
        prefix: base?.prefix ?? "",
        suffix: `/${fy.label}`,
        applicable_from: fy.from,
        applicable_to: fy.to,
        starting_no: 1,
        next_no: 1,
      },
    ]);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/billing/series/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          periods: rows.map((r) => ({
            ...r,
            applicable_from: r.applicable_from || null,
            applicable_to: r.applicable_to || null,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not save");
        return;
      }
      toast.success("Series saved");
      setEditing(null);
      void list.reload();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  const makeDefault = async (s: Series) => {
    const res = await fetch(`/api/billing/series/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Could not change the default");
      return;
    }
    toast.success(`"${s.name}" is now the default`);
    void list.reload();
  };

  const remove = async (s: Series) => {
    if (!window.confirm(`Delete series "${s.name}"? Existing documents keep their numbers.`)) return;
    const res = await fetch(`/api/billing/series/${s.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Could not delete");
      return;
    }
    toast.success("Deleted");
    void list.reload();
  };

  const create = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/billing/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, doc_type: docType }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not create");
        return;
      }
      toast.success("Series created — set its prefix and numbers");
      setCreating(false);
      setNewName("");
      await list.reload();
    } finally {
      setSaving(false);
    }
  };

  if (list.error) return <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">{list.error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          How {docType} numbers are made: <span className="font-mono">prefix + running number + suffix</span>. Add a dated row per
          financial year to restart numbering each year.
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Series
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Voucher Series Name</th>
              <th className="px-3 py-2 text-left font-medium">Prefix</th>
              <th className="px-3 py-2 text-left font-medium">Suffix</th>
              <th className="px-3 py-2 text-right font-medium">Starting No</th>
              <th className="px-3 py-2 text-left font-medium">Next number</th>
              <th className="px-3 py-2 text-center font-medium">Default</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {list.loading && !list.data.length ? (
              <tr>
                <td colSpan={7} className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : list.data.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No series yet — save the Company &amp; Bank tab once to create the default one.
                </td>
              </tr>
            ) : (
              list.data.map((s) => {
                const first = s.periods[0];
                return (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2 font-medium">
                      {s.name}
                      {s.periods.length > 1 && <span className="ml-1 text-xs text-muted-foreground">({s.periods.length} rows)</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{first?.prefix || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{first?.suffix || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{first?.starting_no ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{s.next_number ?? "—"}</td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="radio"
                        name={`default-${docType}`}
                        checked={s.is_default}
                        disabled={!canEdit || s.is_default}
                        onChange={() => makeDefault(s)}
                        aria-label={`Make ${s.name} the default`}
                        className="h-4 w-4 accent-primary cursor-pointer"
                      />
                    </td>
                    <td className="px-2 py-2">
                      {canEdit && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Actions for ${s.name}`}>
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="text-xs">
                            <DropdownMenuItem onClick={() => openEdit(s)}>
                              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                            </DropdownMenuItem>
                            {!s.is_default && (
                              <DropdownMenuItem onClick={() => remove(s)} className="text-destructive">
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* New series */}
      <Dialog open={creating} onOpenChange={(o) => !saving && setCreating(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Series</DialogTitle>
            <DialogDescription>You&apos;ll set its prefix and numbers next.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="s-new">Series Name *</Label>
            <Input id="s-new" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Quotation 2026-27" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={create} disabled={saving || !newName.trim()}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit series */}
      <Dialog open={!!editing} onOpenChange={(o) => !saving && !o && setEditing(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Series</DialogTitle>
            <DialogDescription>
              The first undated row is the fallback. A dated row is used for documents dated inside its range.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="s-name">Series Name *</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Prefix</th>
                  <th className="px-2 py-2 text-left font-medium">Suffix</th>
                  <th className="px-2 py-2 text-left font-medium">Applicable from</th>
                  <th className="px-2 py-2 text-left font-medium">Applicable to</th>
                  <th className="px-2 py-2 text-left font-medium">Starting No.</th>
                  <th className="px-2 py-2 text-left font-medium">Next No.</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id ?? `new-${i}`} className="border-t align-top">
                    <td className="px-2 py-1.5">
                      <Input className="h-8 w-28 font-mono text-xs" value={r.prefix} onChange={(e) => setRow(i, { prefix: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8 w-24 font-mono text-xs" value={r.suffix} onChange={(e) => setRow(i, { suffix: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="date" className="h-8 w-36 text-xs" value={r.applicable_from ?? ""} onChange={(e) => setRow(i, { applicable_from: e.target.value || null })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="date" className="h-8 w-36 text-xs" value={r.applicable_to ?? ""} onChange={(e) => setRow(i, { applicable_to: e.target.value || null })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="number" min={0} className="h-8 w-20 text-xs" value={r.starting_no} onChange={(e) => setRow(i, { starting_no: Number(e.target.value) })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="number" min={0} className="h-8 w-20 text-xs" value={r.next_no} onChange={(e) => setRow(i, { next_no: Number(e.target.value) })} />
                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {formatSeriesNumber(r.prefix, Math.max(r.next_no, r.starting_no), r.suffix)}
                      </div>
                    </td>
                    <td className="px-1 py-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                        disabled={rows.length === 1}
                        aria-label="Remove row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRows((r) => [...r, { prefix: "", suffix: "", applicable_from: null, applicable_to: null, starting_no: 1, next_no: 1 }])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Item
            </Button>
            <Button size="sm" variant="outline" onClick={addFyRow}>
              <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Add {financialYear().label} financial year
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Dates show as DD-MM-YYYY in lists: {fmtDate(financialYear().from)} → {fmtDate(financialYear().to)} is this financial year.
            Numbers already used are always skipped.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
