import { QuotationForm } from "@/components/billing/quotation-form/quotation-form";

// /billing/invoices/new?type=proforma|tax_invoice&contact=<id>&conversation=<id>
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const kind = one(sp.type) === "tax_invoice" ? "tax_invoice" : "proforma";
  return (
    <QuotationForm
      key={kind}
      kind={kind}
      initialContactId={one(sp.contact)}
      conversationId={one(sp.conversation)}
      dealId={one(sp.deal)}
    />
  );
}
