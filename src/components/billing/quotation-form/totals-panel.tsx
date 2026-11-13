"use client";

// Totals panel: CGST/SGST/IGST box, "+ Ledger" lines, Net Total,
// Discount, Round Off, Grand Total and amount in words.

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { amountInWords, type CalcResult } from "@/lib/billing/calc";
import { inr, newKey, type LedgerOption, type LedgerRow } from "./types";

interface Props {
  totals: CalcResult;
  taxed: boolean;
  ledgerOptions: LedgerOption[];
  ledgers: LedgerRow[];
  onLedgers: (rows: LedgerRow[]) => void;
  discount: string;
  onDiscount: (v: string) => void;
  roundOffAuto: boolean;
  roundOff: string;
  onRoundOff: (auto: boolean, value: string) => void;
  disabled?: boolean;
}

const Row = ({ label, value, strong, muted }: { label: React.ReactNode; value: string; strong?: boolean; muted?: boolean }) => (
  <div className={`flex items-center justify-between gap-3 py-1 ${strong ? "text-base font-semibold" : "text-sm"} ${muted ? "text-muted-foreground" : ""}`}>
    <span>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);

export function TotalsPanel({
  totals,
  taxed,
  ledgerOptions,
  ledgers,
  onLedgers,
  discount,
  onDiscount,
  roundOffAuto,
  roundOff,
  onRoundOff,
  disabled,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");
  const [amount, setAmount] = useState("");

  const addLedger = () => {
    const opt = ledgerOptions.find((l) => l.id === pick);
    const a = Number(amount);
    if (!opt || !amount || !Number.isFinite(a)) return;
    onLedgers([...ledgers, { key: newKey(), ledger_id: opt.id, ledger_name: opt.name, amount: String(a) }]);
    setPick("");
    setAmount("");
    setAdding(false);
  };

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {taxed && (
        <div className="rounded-lg bg-muted/40 p-3">
          <Row label="CGST" value={`₹${inr(totals.cgst)}`} muted={totals.cgst === 0} />
          <Row label="SGST" value={`₹${inr(totals.sgst)}`} muted={totals.sgst === 0} />
          <Row label="IGST" value={`₹${inr(totals.igst)}`} muted={totals.igst === 0} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {totals.placeOfSupply ? `Place of supply: ${totals.placeOfSupply}. ` : ""}
            {totals.interState ? "Client in another state → IGST." : "Same state → CGST + SGST."}
          </p>
        </div>
      )}

      <div>
        {ledgers.map((l) => (
          <div key={l.key} className="flex items-center justify-between gap-2 py-1 text-sm">
            <span className="truncate">{l.ledger_name}</span>
            <span className="flex items-center gap-1">
              <Input
                type="number"
                step="0.01"
                value={l.amount}
                disabled={disabled}
                onChange={(e) => onLedgers(ledgers.map((x) => (x.key === l.key ? { ...x, amount: e.target.value } : x)))}
                className="h-8 w-28 text-right text-sm tabular-nums"
                aria-label={`${l.ledger_name} amount`}
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onLedgers(ledgers.filter((x) => x.key !== l.key))}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive cursor-pointer"
                  aria-label={`Remove ${l.ledger_name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          </div>
        ))}
        {!disabled &&
          (adding ? (
            <div className="flex items-center gap-1.5 py-1">
              <select
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                aria-label="Select Ledger"
                autoFocus
              >
                <option value="">Select Ledger</option>
                {ledgerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addLedger()}
                placeholder="Amount"
                className="h-8 w-24 text-right text-sm"
              />
              <Button type="button" size="sm" className="h-8 w-8 p-0" onClick={addLedger} disabled={!pick || !amount} aria-label="Add ledger">
                <Check className="h-4 w-4" />
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setAdding(false)} aria-label="Cancel">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={!ledgerOptions.length}
              className="inline-flex items-center gap-1 py-1 text-sm font-medium text-primary hover:underline cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              title={ledgerOptions.length ? undefined : "Add ledgers in Settings → Billing → Ledgers"}
            >
              <Plus className="h-3.5 w-3.5" /> Ledger
            </button>
          ))}
      </div>

      <div className="border-t pt-2">
        <Row label="Net Total" value={`₹${inr(totals.netTotal)}`} />
        {taxed && <Row label="Tax" value={`₹${inr(totals.totalTax)}`} muted />}
        <div className="flex items-center justify-between gap-3 py-1 text-sm">
          <span>Discount</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={discount}
            disabled={disabled}
            onChange={(e) => onDiscount(e.target.value)}
            placeholder="0.00"
            className="h-8 w-28 text-right text-sm tabular-nums"
            aria-label="Discount"
          />
        </div>
        <div className="flex items-center justify-between gap-3 py-1 text-sm">
          <label className="flex items-center gap-1.5">
            Round Off
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={roundOffAuto}
                disabled={disabled}
                onChange={(e) => onRoundOff(e.target.checked, roundOff)}
                className="h-3.5 w-3.5 accent-primary"
              />
              auto
            </span>
          </label>
          <Input
            type="number"
            step="0.01"
            value={roundOffAuto ? String(totals.roundOff) : roundOff}
            disabled={disabled || roundOffAuto}
            onChange={(e) => onRoundOff(false, e.target.value)}
            className="h-8 w-28 text-right text-sm tabular-nums"
            aria-label="Round off"
          />
        </div>
        <div className="mt-1 border-t pt-2">
          <Row label="Grand Total" value={`₹${inr(totals.grandTotal)}`} strong />
          <p className="text-right text-[11px] italic text-muted-foreground">{amountInWords(totals.grandTotal)}</p>
        </div>
      </div>
    </div>
  );
}
