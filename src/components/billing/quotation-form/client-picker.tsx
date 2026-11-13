"use client";

// Client (Billed To) search: "Name (M:+91 xxxxx xxxxx)", plus "+ New client".

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { INDIAN_STATES } from "@/lib/billing/states";
import { displayPhone, type Client } from "./types";

interface Props {
  value: Client | null;
  onChange: (c: Client | null) => void;
  disabled?: boolean;
}

export function ClientPicker({ value, onChange, disabled }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/billing/clients?q=${encodeURIComponent(q)}`);
        const json = await res.json().catch(() => ({}));
        if (!cancelled) setResults(res.ok ? (json.clients ?? []) : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">
            {value.name || value.company || "Client"}
            <span className="ml-1 font-normal text-muted-foreground">(M:{displayPhone(value.phone)})</span>
          </span>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            aria-label="Change client"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        value={q}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search client by name, mobile, company or GSTIN"
        className="pl-8"
        aria-label="Client"
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover shadow-lg">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          )}
          {!loading && results.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No clients found.</div>}
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c);
                setOpen(false);
                setQ("");
              }}
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted cursor-pointer"
            >
              <span className="text-sm">
                {c.name || c.company || "Unnamed"} <span className="text-muted-foreground">(M:{displayPhone(c.phone)})</span>
              </span>
              {(c.company || c.gstin) && (
                <span className="text-[11px] text-muted-foreground">
                  {[c.company, c.gstin].filter(Boolean).join(" · ")}
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
            className="flex w-full items-center gap-1.5 border-t px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted cursor-pointer"
          >
            <Plus className="h-4 w-4" /> New client{q.trim() ? ` "${q.trim()}"` : ""}
          </button>
        </div>
      )}
      <NewClientDialog
        open={creating}
        onOpenChange={setCreating}
        initialName={/\d{5,}/.test(q) ? "" : q.trim()}
        initialPhone={/\d{5,}/.test(q) ? q.trim() : ""}
        onCreated={(c) => {
          onChange(c);
          setQ("");
        }}
      />
    </div>
  );
}

function NewClientDialog({
  open,
  onOpenChange,
  initialName,
  initialPhone,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialName: string;
  initialPhone: string;
  onCreated: (c: Client) => void;
}) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", company: "", state: "", gstin: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: initialName, phone: initialPhone, email: "", company: "", state: "", gstin: "" });
  }, [open, initialName, initialPhone]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/billing/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not create the client");
        return;
      }
      toast.success(json.existing ? "This number is already a client — selected it" : "Client created");
      onCreated(json.client as Client);
      onOpenChange(false);
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
          <DialogDescription>Added to your contacts. If the number already exists, that client is used.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="nc-name">Name *</Label>
            <Input id="nc-name" value={form.name} onChange={set("name")} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nc-phone">Mobile *</Label>
            <Input id="nc-phone" value={form.phone} onChange={set("phone")} inputMode="tel" placeholder="98765 43210" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nc-company">Company</Label>
            <Input id="nc-company" value={form.company} onChange={set("company")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nc-email">Email</Label>
            <Input id="nc-email" type="email" value={form.email} onChange={set("email")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nc-state">State</Label>
            <select id="nc-state" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={form.state} onChange={set("state")}>
              <option value="">Select</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nc-gstin">GSTIN</Label>
            <Input id="nc-gstin" value={form.gstin} onChange={set("gstin")} maxLength={15} className="uppercase" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !form.name.trim() || !form.phone.trim()}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
