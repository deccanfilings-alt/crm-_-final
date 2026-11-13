"use client";

// "Issued By" / "Billed To" card. Shows the details that will print;
// the pencil edits them for THIS quotation only.

import { useState } from "react";
import { Check, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { INDIAN_STATES } from "@/lib/billing/states";
import type { Party } from "./types";

type Field = keyof Party;

const LABELS: Partial<Record<Field, string>> = {
  name: "Name",
  contact_name: "Contact person",
  address: "Address",
  city: "City",
  state: "State",
  pincode: "Pincode",
  phone: "Phone",
  email: "Email",
  gstin: "GSTIN",
  pan: "PAN",
  cin: "CIN",
};

interface Props {
  title: string;
  /** Label for the name row, e.g. "Billed From" / "Billed To". */
  nameLabel: string;
  value: Party | null;
  onChange: (p: Party) => void;
  fields: Field[];
  emptyText: string;
  disabled?: boolean;
  footer?: React.ReactNode;
}

export function PartyCard({ title, nameLabel, value, onChange, fields, emptyText, disabled, footer }: Props) {
  const [editing, setEditing] = useState(false);

  const set = (k: Field, v: string) => value && onChange({ ...value, [k]: v || null, ...(k === "name" ? { name: v } : {}) });

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {value && !disabled && (
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className={cn(
              "rounded p-1 hover:bg-muted cursor-pointer",
              editing ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
            aria-label={editing ? `Done editing ${title}` : `Edit ${title} for this quotation`}
            title={editing ? "Done" : "Edit for this quotation only"}
          >
            {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {!value ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : editing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {(["name", ...fields] as Field[]).map((k) => (
            <div key={k} className={cn("grid gap-1", (k === "name" || k === "address") && "sm:col-span-2")}>
              <Label className="text-[11px] text-muted-foreground">{k === "name" ? nameLabel : LABELS[k]}</Label>
              {k === "state" ? (
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={value.state ?? ""}
                  onChange={(e) => set("state", e.target.value)}
                >
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  className={cn("h-8 text-sm", (k === "gstin" || k === "pan" || k === "cin") && "uppercase")}
                  value={(value[k] as string | null | undefined) ?? ""}
                  onChange={(e) => set(k, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{nameLabel}</dt>
          <dd className="font-medium">{value.name}</dd>
          {fields.map((k) => {
            const v = value[k];
            if (!v) return null;
            return (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{LABELS[k]}</dt>
                <dd className="break-words">{String(v)}</dd>
              </div>
            );
          })}
        </dl>
      )}
      {footer}
    </div>
  );
}
