import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { InvoiceList } from "@/components/billing/invoice-list/invoice-list";

// /billing/invoices?type=proforma|tax_invoice — WebLedger-style invoice list.
export default function BillingInvoicesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <InvoiceList />
    </Suspense>
  );
}
