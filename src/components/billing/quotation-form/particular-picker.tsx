"use client";

// "Particulars" cell: type to search the Particulars master, pick one to
// fill service / SAC / amount / GST / description, or keep free text.
// The last option creates a new particular.

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Particular } from "@/components/settings/billing/particular-dialog";

interface Props {
  value: string;
  particulars: Particular[];
  onType: (title: string) => void;
  onPick: (p: Particular) => void;
  onCreate: (name: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}

export function ParticularPicker({ value, particulars, onType, onPick, onCreate, disabled, invalid }: Props) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const t = value.trim().toLowerCase();
    const list = particulars.filter((p) => p.is_active !== false);
    if (!t) return list.slice(0, 30);
    return list
      .filter((p) => [p.name, p.service_name, p.sac_code].some((v) => (v ?? "").toLowerCase().includes(t)))
      .slice(0, 30);
  }, [value, particulars]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const exact = particulars.some((p) => p.name.toLowerCase() === value.trim().toLowerCase());

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onType(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Select particulars"
        aria-invalid={invalid || undefined}
        className="h-9 text-sm"
      />
      {open && !disabled && (
        <div className="absolute z-30 mt-1 max-h-64 w-full min-w-[260px] overflow-y-auto rounded-md border bg-popover shadow-lg">
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onPick(p);
                setOpen(false);
              }}
              className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-muted cursor-pointer"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">{p.name}</span>
                {(p.service_name || p.sac_code) && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[p.service_name, p.sac_code && `SAC ${p.sac_code}`].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              {p.default_amount != null && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">₹{Number(p.default_amount).toLocaleString("en-IN")}</span>
              )}
            </button>
          ))}
          {matches.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No particulars match.</div>}
          {!exact && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onCreate(value.trim());
              }}
              className="flex w-full items-center gap-1.5 border-t px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted cursor-pointer"
            >
              <Plus className="h-4 w-4" /> Create Particulars{value.trim() ? ` "${value.trim()}"` : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
