import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuotationForm } from "@/components/billing/quotation-form/quotation-form";

// /billing/invoices/:id/edit — looks up the type so the form shows the
// right series (proforma / tax invoice). RLS limits it to the account.
export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("invoices").select("invoice_type").eq("id", id).maybeSingle();
  if (!data) notFound();
  return <QuotationForm kind={data.invoice_type === "tax_invoice" ? "tax_invoice" : "proforma"} invoiceId={id} />;
}
