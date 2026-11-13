import { QuotationForm } from "@/components/billing/quotation-form/quotation-form";

// /billing/quotations/new?contact=<id>&conversation=<id>&deal=<id>
export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  return (
    <QuotationForm
      initialContactId={one(sp.contact)}
      conversationId={one(sp.conversation)}
      dealId={one(sp.deal)}
    />
  );
}
