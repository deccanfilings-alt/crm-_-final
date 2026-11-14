import { redirect } from "next/navigation";

// The old billing hub. Its pages now live under /billing:
//   ?tab=tax_invoice -> /billing/invoices?type=tax_invoice
//   ?tab=quotes      -> /billing/quotations
//   otherwise        -> /billing/invoices?type=proforma
export default async function OldBillingHub({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const tab = (await searchParams).tab;
  if (tab === "quotes" || tab === "quotations") redirect("/billing/quotations");
  redirect(`/billing/invoices?type=${tab === "tax_invoice" ? "tax_invoice" : "proforma"}`);
}
