import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { QuotationList } from "@/components/billing/quotation-list/quotation-list";

// /billing/quotations — the WebLedger-style quotation list.
// (useSearchParams in the list needs a Suspense boundary.)
export default function BillingQuotationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <QuotationList />
    </Suspense>
  );
}
