"use client";

// Bill Details: SR · Particulars & Description · Service Name · SAC ·
// Qty · Service Amount · Discount (INR/%) · GST Rate · Amount · delete

import { Link2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CalcResult } from "@/lib/billing/calc";
import type { Particular } from "@/components/settings/billing/particular-dialog";
import { ParticularPicker } from "./particular-picker";
import { inr, type ItemRow } from "./types";

interface Props {
  rows: ItemRow[];
  totals: CalcResult;
  particulars: Particular[];
  gstRates: number[];
  taxed: boolean;
  disabled?: boolean;
  showErrors: boolean;
  onChange: (key: string, patch: Partial<ItemRow>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
  onCreateParticular: (rowKey: string, name: string) => void;
  onAttachTasks: (rowKey: string) => void;
  canAttachTasks: boolean;
}

const num = "h-9 text-right text-sm tabular-nums";

export function BillDetailsTable({
  rows,
  totals,
  particulars,
  gstRates,
  taxed,
  disabled,
  showErrors,
  onChange,
  onAdd,
  onRemove,
  onCreateParticular,
  onAttachTasks,
  canAttachTasks,
}: Props) {
  const rates = [...new Set([...(gstRates.length ? gstRates : [0, 5, 12, 18, 28]), ...rows.map((r) => Number(r.gst_rate) || 0)])].sort(
    (a, b) => a - b,
  );

  const pick = (key: string, p: Particular) =>
    onChange(key, {
      particular_id: p.id,
      title: p.name,
      description: p.description ?? "",
      service_name: p.service_name ?? "",
      sac_code: p.sac_code ?? "",
      unit_price: p.default_amount != null ? String(Number(p.default_amount)) : "",
      gst_rate: p.gst_rate != null ? String(Number(p.gst_rate)) : "18",
    });

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-2 py-2 text-left font-medium">SR</th>
              <th className="px-2 py-2 text-left font-medium">Particulars &amp; Description</th>
              <th className="w-36 px-2 py-2 text-left font-medium">Service Name</th>
              <th className="w-24 px-2 py-2 text-left font-medium">SAC Code</th>
              <th className="w-16 px-2 py-2 text-right font-medium">Qty</th>
              <th className="w-28 px-2 py-2 text-right font-medium">Service Amount</th>
              <th className="w-36 px-2 py-2 text-right font-medium">Discount</th>
              <th className="w-24 px-2 py-2 text-right font-medium">GST Rate</th>
              <th className="w-28 px-2 py-2 text-right font-medium">Amount</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const line = totals.lines[i];
              return (
                <tr key={r.key} className="border-t align-top">
                  <td className="px-2 py-2 pt-4 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="space-y-1.5 px-2 py-2">
                    <ParticularPicker
                      value={r.title}
                      particulars={particulars}
                      disabled={disabled}
                      invalid={showErrors && !r.title.trim()}
                      onType={(title) => onChange(r.key, { title, particular_id: null })}
                      onPick={(p) => pick(r.key, p)}
                      onCreate={(name) => onCreateParticular(r.key, name)}
                    />
                    <div className="relative">
                      <Textarea
                        rows={2}
                        maxLength={250}
                        value={r.description}
                        disabled={disabled}
                        onChange={(e) => onChange(r.key, { description: e.target.value })}
                        placeholder="Description"
                        className="min-h-0 resize-y pb-5 text-xs"
                      />
                      <span className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-muted-foreground">
                        {r.description.length}/250
                      </span>
                    </div>
                    {canAttachTasks && (
                      <button
                        type="button"
                        onClick={() => onAttachTasks(r.key)}
                        disabled={disabled}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer disabled:opacity-50"
                      >
                        <Link2 className="h-3 w-3" />
                        {r.linked_task_ids.length ? `${r.linked_task_ids.length} task(s) attached` : "Attach Tasks"}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <Input className="h-9 text-sm" value={r.service_name} disabled={disabled} onChange={(e) => onChange(r.key, { service_name: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      className="h-9 font-mono text-xs"
                      inputMode="numeric"
                      value={r.sac_code}
                      disabled={disabled}
                      onChange={(e) => onChange(r.key, { sac_code: e.target.value.replace(/\D/g, "").slice(0, 8) })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input className={num} type="number" min={0} step="any" value={r.quantity} disabled={disabled} onChange={(e) => onChange(r.key, { quantity: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      className={cn(num, showErrors && r.unit_price === "" && "border-destructive")}
                      type="number"
                      min={0}
                      step="0.01"
                      value={r.unit_price}
                      disabled={disabled}
                      onChange={(e) => onChange(r.key, { unit_price: e.target.value })}
                      placeholder="0.00"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex">
                      <Input
                        className={cn(num, "rounded-r-none")}
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.discount_value}
                        disabled={disabled}
                        onChange={(e) => onChange(r.key, { discount_value: e.target.value })}
                        placeholder="0"
                      />
                      <div className="flex shrink-0 overflow-hidden rounded-r-md border border-l-0 text-[11px]">
                        {(["INR", "PERCENT"] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange(r.key, { discount_type: t })}
                            className={cn(
                              "px-1.5 font-medium cursor-pointer",
                              r.discount_type === t ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted",
                            )}
                            aria-pressed={r.discount_type === t}
                          >
                            {t === "INR" ? "INR" : "%"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {line && line.discount > 0 && <div className="mt-0.5 text-right text-[10px] text-muted-foreground">−₹{inr(line.discount)}</div>}
                  </td>
                  <td className="px-2 py-2">
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-1 text-right text-sm disabled:opacity-60"
                      value={r.gst_rate}
                      disabled={disabled || !taxed}
                      onChange={(e) => onChange(r.key, { gst_rate: e.target.value })}
                      aria-label={`GST rate, row ${i + 1}`}
                    >
                      {rates.map((rate) => (
                        <option key={rate} value={String(rate)}>
                          {rate}%
                        </option>
                      ))}
                    </select>
                    <div className="mt-0.5 text-right text-[10px] text-muted-foreground">INR {inr(line?.tax ?? 0)}</div>
                  </td>
                  <td className="px-2 py-2 pt-4 text-right font-medium tabular-nums">₹{inr(line?.lineTotal ?? 0)}</td>
                  <td className="px-1 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive"
                      disabled={disabled || rows.length === 1}
                      onClick={() => onRemove(r.key)}
                      aria-label={`Delete row ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-semibold">
              <td colSpan={5} className="px-2 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">
                Total
              </td>
              <td className="px-2 py-2 text-right tabular-nums">₹{inr(totals.serviceAmountTotal)}</td>
              <td colSpan={2} />
              <td className="px-2 py-2 text-right tabular-nums">₹{inr(totals.lines.reduce((s, l) => s + l.lineTotal, 0))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {!disabled && (
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-4 w-4" /> Add Row
        </Button>
      )}
    </div>
  );
}
