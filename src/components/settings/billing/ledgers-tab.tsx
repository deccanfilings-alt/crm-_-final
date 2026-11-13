"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
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
import { selectCls, useBillingFetch } from "./use-billing-list";

interface Ledger {
  id: string;
  name: string;
  ledger_group: string;
}

export function LedgersTab({ canEdit }: { canEdit: boolean }) {
  const list = useBillingFetch<{ ledgers: Ledger[]; groups: string[] }>(
    "/api/billing/ledgers",
    (j) => ({ ledgers: (j.ledgers as Ledger[]) ?? [], groups: (j.groups as string[]) ?? [] }),
    { ledgers: [], groups: [] },
  );
  const [editing, setEditing] = useState<Ledger | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", ledger_group: "" });
  const [saving, setSaving] = useState(false);

  const openDialog = (l: Ledger | null) => {
    setEditing(l);
    setForm({ name: l?.name ?? "", ledger_group: l?.ledger_group ?? "Indirect Expenses" });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/billing/ledgers/${editing.id}` : "/api/billing/ledgers", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not save");
        return;
      }
      toast.success(editing ? "Ledger updated" : "Ledger created");
      setOpen(false);
      void list.reload();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (l: Ledger) => {
    if (!window.confirm(`Delete ledger "${l.name}"?`)) return;
    const res = await fetch(`/api/billing/ledgers/${l.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Could not delete");
      return;
    }
    toast.success("Deleted");
    void list.reload();
  };

  if (list.error) return <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">{list.error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Extra lines you can add to a quotation&apos;s totals, e.g. Government Fees.</p>
        {canEdit && (
          <Button size="sm" onClick={() => openDialog(null)}>
            <Plus className="mr-1 h-4 w-4" /> Ledger
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Ledger No.</th>
              <th className="px-3 py-2 text-left font-medium">Ledger Name</th>
              <th className="px-3 py-2 text-left font-medium">Ledger Group</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {list.loading && !list.data.ledgers.length ? (
              <tr>
                <td colSpan={4} className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : list.data.ledgers.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No ledgers yet.</td>
              </tr>
            ) : (
              list.data.ledgers.map((l, i) => (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2 font-medium">{l.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.ledger_group}</td>
                  <td className="px-2 py-2">
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Actions for ${l.name}`}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="text-xs">
                          <DropdownMenuItem onClick={() => openDialog(l)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => remove(l)} className="text-destructive">
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

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Ledger" : "Create Ledgers"}</DialogTitle>
            <DialogDescription>Groups follow Tally, for an easy export later.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="l-name">Ledger Name *</Label>
              <Input id="l-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-group">Ledger Group *</Label>
              <select
                id="l-group"
                className={selectCls}
                value={form.ledger_group}
                onChange={(e) => setForm((f) => ({ ...f, ledger_group: e.target.value }))}
              >
                {list.data.groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
