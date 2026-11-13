"use client";

// Create / edit a Particular (service catalogue entry). Shared by
// Settings -> Billing -> Particulars and the quotation form's
// "Create Particulars" shortcut.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface Particular {
  id: string;
  name: string;
  service_name: string | null;
  gst_rate: number | null;
  vat_rate: number | null;
  sac_code: string | null;
  description: string | null;
  default_amount: number | null;
  is_active?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this one; omit to create. */
  particular?: Particular | null;
  /** Prefill the name when creating (e.g. from the quotation form search). */
  initialName?: string;
  gstRates: number[];
  onSaved: (p: Particular) => void;
}

const selectCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function ParticularDialog({ open, onOpenChange, particular, initialName, gstRates, onSaved }: Props) {
  const [form, setForm] = useState({ name: "", service_name: "", gst_rate: "18", sac_code: "", default_amount: "", description: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: particular?.name ?? initialName ?? "",
      service_name: particular?.service_name ?? "",
      gst_rate: particular?.gst_rate != null ? String(Number(particular.gst_rate)) : "18",
      sac_code: particular?.sac_code ?? "",
      default_amount: particular?.default_amount != null ? String(Number(particular.default_amount)) : "",
      description: particular?.description ?? "",
    });
  }, [open, particular, initialName]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(particular ? `/api/billing/particulars/${particular.id}` : "/api/billing/particulars", {
        method: particular ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          gst_rate: form.gst_rate === "" ? null : form.gst_rate,
          default_amount: form.default_amount === "" ? null : form.default_amount,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not save");
        return;
      }
      toast.success(particular ? "Particular updated" : "Particular created");
      onSaved(json.particular as Particular);
      onOpenChange(false);
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  const rates = gstRates.length ? gstRates : [0, 5, 12, 18, 28];

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{particular ? "Edit Particulars" : "Create Particulars"}</DialogTitle>
          <DialogDescription>A service you bill for. Picking it on a quotation fills these in.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="p-name">Name *</Label>
            <Input id="p-name" value={form.name} onChange={set("name")} maxLength={200} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-service">Service</Label>
            <Input id="p-service" value={form.service_name} onChange={set("service_name")} placeholder="e.g. Licensing" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-gst">GST Rate</Label>
            <select id="p-gst" className={selectCls} value={form.gst_rate} onChange={set("gst_rate")}>
              {rates.map((r) => (
                <option key={r} value={String(r)}>
                  {r}%
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-sac">SAC Code</Label>
            <Input id="p-sac" value={form.sac_code} onChange={set("sac_code")} inputMode="numeric" placeholder="e.g. 998231" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-amount">Amount (₹)</Label>
            <Input id="p-amount" type="number" min={0} step="0.01" value={form.default_amount} onChange={set("default_amount")} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <div className="flex justify-between">
              <Label htmlFor="p-desc">Description</Label>
              <span className="text-[11px] text-muted-foreground">{form.description.length}/250</span>
            </div>
            <Textarea id="p-desc" rows={3} maxLength={250} value={form.description} onChange={set("description")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
