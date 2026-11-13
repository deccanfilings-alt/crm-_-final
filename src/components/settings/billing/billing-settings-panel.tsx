"use client";

// Settings -> Billing: one place for everything billing.
//   Company & Bank  the existing company / bank / UPI / terms form
//                   (single source — synced to quotations automatically)
//   Series · Particulars · Ledgers · Tax Rates   WebLedger-style masters

import { useState } from "react";
import { Building2, Hash, Layers, ListTree, Percent } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { QuotationSettingsPanel } from "@/components/settings/quotation-settings-panel";
import { SettingsPanelHead } from "@/components/settings/settings-panel-head";
import { SeriesTab } from "./series-tab";
import { ParticularsTab } from "./particulars-tab";
import { LedgersTab } from "./ledgers-tab";
import { TaxRatesTab } from "./tax-rates-tab";

const TABS = [
  { id: "company", label: "Company & Bank", icon: Building2 },
  { id: "series", label: "Series", icon: Hash },
  { id: "particulars", label: "Particulars", icon: ListTree },
  { id: "ledgers", label: "Ledgers", icon: Layers },
  { id: "tax", label: "Tax Rates", icon: Percent },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function BillingSettingsPanel() {
  const { accountRole } = useAuth();
  const isAdmin = accountRole === "owner" || accountRole === "admin";
  const canAddParticulars = isAdmin || accountRole === "agent";
  const [tab, setTab] = useState<TabId>("company");

  return (
    <div className="space-y-5">
      <SettingsPanelHead
        title="Billing"
        description="Company and bank details, numbering, the services you bill for, ledgers and tax rates — used by quotations and invoices."
      />

      <div className="flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="Billing settings">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "company" && <QuotationSettingsPanel embedded />}
      {tab === "series" && <SeriesTab canEdit={isAdmin} docType="quotation" />}
      {tab === "particulars" && <ParticularsTab canEdit={canAddParticulars} />}
      {tab === "ledgers" && <LedgersTab canEdit={isAdmin} />}
      {tab === "tax" && <TaxRatesTab canEdit={isAdmin} />}
    </div>
  );
}
