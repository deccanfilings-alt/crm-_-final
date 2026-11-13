import { QuotationForm } from "@/components/billing/quotation-form/quotation-form";

// /billing/quotations/:id/edit
export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuotationForm quotationId={id} />;
}
