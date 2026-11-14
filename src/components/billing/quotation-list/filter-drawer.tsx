"use client";

// Filter drawer: By Client, Client Group, From/To Quotation Date.
// (Only one firm, so no firm filter.) The form remounts each time the
// drawer opens, so it always starts from the current filters.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClientPicker } from "@/components/billing/quotation-form/client-picker";
import type { Client } from "@/components/billing/quotation-form/types";
import type { ListFilters } from "./types";

type Applied = Pick<ListFilters, "client" | "group" | "from" | "to">;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: ListFilters;
  onApply: (f: Applied) => void;
  /** e.g. "Quotation Date" / "Invoice Date". */
  dateLabel?: string;
  description?: string;
}

export function FilterDrawer({ open, onOpenChange, value, onApply, dateLabel = "Quotation Date", description = "Narrow down the quotation list." }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {open && (
          <FilterForm
            dateLabel={dateLabel}
            initial={value}
            onApply={(f) => {
              onApply(f);
              onOpenChange(false);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function FilterForm({ initial, onApply, dateLabel }: { initial: ListFilters; onApply: (f: Applied) => void; dateLabel: string }) {
  const [client, setClient] = useState<ListFilters["client"]>(initial.client);
  const [group, setGroup] = useState(initial.group);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/billing/client-groups");
      const json = await res.json().catch(() => ({}));
      if (!cancelled && res.ok) setGroups(json.groups ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pickerValue: Client | null = client
    ? { id: client.id, name: client.label, phone: null, email: null, company: null, address: null, city: null, state: null, pincode: null, gstin: null, pan: null, cin: null, proprietor_name: null }
    : null;

  return (
    <div className="grid gap-4 px-4">
      <div className="grid gap-1.5">
        <Label>By Client</Label>
        <ClientPicker value={pickerValue} onChange={(c) => setClient(c ? { id: c.id, label: c.name || c.company || "Client" } : null)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="f-group">Client Group Name</Label>
        <select id="f-group" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="f-from">From {dateLabel}</Label>
          <Input id="f-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-to">To {dateLabel}</Label>
          <Input id="f-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-between gap-2 pt-2">
        <Button variant="ghost" onClick={() => onApply({ client: null, group: "", from: "", to: "" })}>
          Clear all filter
        </Button>
        <Button onClick={() => onApply({ client, group, from, to })}>Save</Button>
      </div>
    </div>
  );
}
