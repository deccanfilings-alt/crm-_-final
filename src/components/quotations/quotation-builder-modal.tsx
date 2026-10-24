"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Loader2,
  Send,
  Receipt,
  User,
  Check,
  Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { calculateQuotationTotals } from "@/lib/quotations/calculations";
import type { Contact, Quotation } from "@/types";

interface QuotationBuilderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContact?: Contact | null;
  initialConversationId?: string | null;
  quotationToEdit?: Quotation | null;
  onSuccess?: (quotation: Quotation) => void;
}

interface FormItem {
  id?: string;
  title: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export function QuotationBuilderModal({
  open,
  onOpenChange,
  initialContact,
  initialConversationId,
  quotationToEdit,
  onSuccess,
}: QuotationBuilderModalProps) {
  const supabase = createClient();

  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  // Contact Picker
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  // Form Fields
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientCompany, setClientCompany] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [clientGstin, setClientGstin] = useState("");

  const [issueDate, setIssueDate] = useState(new Date().toISOString().split("T")[0]);
  const [validUntil, setValidUntil] = useState("");

  const [discountType, setDiscountType] = useState<"none" | "percentage" | "fixed">("none");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [taxType, setTaxType] = useState<"gst" | "none" | "custom">("gst");
  const [taxRate, setTaxRate] = useState<number>(18.0);

  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");

  const [items, setItems] = useState<FormItem[]>([
    { title: "Legal & Regulatory Filing", description: "Statutory fee and professional drafting", quantity: 1, unit_price: 5000, total: 5000 },
  ]);

  // Load Contacts for Search
  useEffect(() => {
    if (!open) return;
    async function loadContacts() {
      const { data } = await supabase
        .from("contacts")
        .select("*")
        .order("name", { ascending: true })
        .limit(50);
      if (data) setContacts(data as Contact[]);
    }
    loadContacts();
  }, [open, supabase]);

  // Prefill or reset state on open
  useEffect(() => {
    if (!open) return;

    if (quotationToEdit) {
      setTitle(quotationToEdit.title || "");
      setClientName(quotationToEdit.client_name || "");
      setClientPhone(quotationToEdit.client_phone || "");
      setClientEmail(quotationToEdit.client_email || "");
      setClientCompany(quotationToEdit.client_company || "");
      setClientAddress(quotationToEdit.client_address || "");
      setClientGstin(quotationToEdit.client_gstin || "");
      setIssueDate(quotationToEdit.issue_date || new Date().toISOString().split("T")[0]);
      setValidUntil(quotationToEdit.valid_until || "");
      setDiscountType(quotationToEdit.discount_type || "none");
      setDiscountValue(quotationToEdit.discount_value || 0);
      setTaxType(quotationToEdit.tax_type || "gst");
      setTaxRate(quotationToEdit.tax_rate ?? 18.0);
      setNotes(quotationToEdit.notes || "");
      setTerms(quotationToEdit.terms || "");

      if (quotationToEdit.items && quotationToEdit.items.length > 0) {
        setItems(
          quotationToEdit.items.map((it) => ({
            id: it.id,
            title: it.title,
            description: it.description || "",
            quantity: it.quantity,
            unit_price: it.unit_price,
            total: it.total,
          }))
        );
      }
    } else {
      // New quote
      const contact = initialContact || null;
      setSelectedContact(contact);
      if (contact) {
        setClientName(contact.name || contact.phone || "");
        setClientPhone(contact.phone || "");
        setClientEmail(contact.email || "");
        setClientCompany(contact.company || "");
        setClientAddress("");
      } else {
        setClientName("");
        setClientPhone("");
        setClientEmail("");
        setClientCompany("");
        setClientAddress("");
      }

      setTitle("");
      setIssueDate(new Date().toISOString().split("T")[0]);
      // Set valid until to 15 days ahead by default
      const d = new Date();
      d.setDate(d.getDate() + 15);
      setValidUntil(d.toISOString().split("T")[0]);

      setDiscountType("none");
      setDiscountValue(0);
      setTaxType("gst");
      setTaxRate(18.0);
      setNotes("");

      // Fetch default terms from settings
      fetch("/api/quotations/settings")
        .then((r) => r.json())
        .then((data) => {
          if (data.settings?.default_terms) {
            setTerms(data.settings.default_terms);
          }
          if (data.settings?.default_tax_rate !== undefined) {
            setTaxRate(data.settings.default_tax_rate);
          }
        })
        .catch(() => {});

      setItems([
        { title: "Service Charge", description: "Professional consultation and filing", quantity: 1, unit_price: 5000, total: 5000 },
      ]);
    }
  }, [open, quotationToEdit, initialContact]);

  // Handle Contact Pick
  const handleSelectContact = (c: Contact) => {
    setSelectedContact(c);
    setClientName(c.name || c.phone || "");
    setClientPhone(c.phone || "");
    setClientEmail(c.email || "");
    setClientCompany(c.company || "");
    setClientAddress("");
    setContactSearch("");
  };

  // Line Items Manipulation
  const handleItemChange = (index: number, field: keyof FormItem, value: any) => {
    setItems((prev) => {
      const updated = [...prev];
      const cur = { ...updated[index], [field]: value };
      cur.total = Math.round((Number(cur.quantity || 0) * Number(cur.unit_price || 0) + Number.EPSILON) * 100) / 100;
      updated[index] = cur;
      return updated;
    });
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { title: "", description: "", quantity: 1, unit_price: 1000, total: 1000 },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) {
      toast.info("A quotation must have at least one line item.");
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Live Totals Calculation
  const totals = useMemo(() => {
    return calculateQuotationTotals({
      items,
      discountType,
      discountValue,
      taxType,
      taxRate,
    });
  }, [items, discountType, discountValue, taxType, taxRate]);

  // Submit Handler
  const handleSaveQuotation = async (sendAfterSave = false) => {
    if (!title.trim()) {
      toast.error("Please enter a quotation title / subject.");
      return;
    }
    if (!clientName.trim()) {
      toast.error("Please enter the client name.");
      return;
    }
    if (items.some((it) => !it.title.trim())) {
      toast.error("All line items must have a title.");
      return;
    }

    if (sendAfterSave) setSending(true);
    else setSaving(true);

    try {
      const payload = {
        title: title.trim(),
        contact_id: selectedContact?.id || initialContact?.id || quotationToEdit?.contact_id || null,
        conversation_id: initialConversationId || quotationToEdit?.conversation_id || null,
        client_name: clientName.trim(),
        client_phone: clientPhone.trim() || null,
        client_email: clientEmail.trim() || null,
        client_company: clientCompany.trim() || null,
        client_address: clientAddress.trim() || null,
        client_gstin: clientGstin.trim() || null,
        issue_date: issueDate,
        valid_until: validUntil || null,
        discount_type: discountType,
        discount_value: discountValue,
        tax_type: taxType,
        tax_rate: taxRate,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
        items: items.map((it) => ({
          title: it.title,
          description: it.description || null,
          quantity: it.quantity,
          unit_price: it.unit_price,
        })),
      };

      const url = quotationToEdit ? "/api/quotations/" + quotationToEdit.id : "/api/quotations";
      const method = quotationToEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save quotation");
      }

      const savedQuote = data.quotation;

      if (sendAfterSave && savedQuote?.id) {
        toast.info("Sending quotation via WhatsApp...");
        const sendRes = await fetch("/api/quotations/" + savedQuote.id + "/send-whatsapp", {
          method: "POST",
        });
        const sendData = await sendRes.json();
        if (!sendRes.ok) {
          throw new Error(sendData.error || "Quotation saved, but WhatsApp delivery failed");
        }
        toast.success("Quotation saved & dispatched via WhatsApp!");
      } else {
        toast.success(quotationToEdit ? "Quotation updated successfully!" : "Quotation created successfully!");
      }

      onSuccess?.(savedQuote);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "An error occurred");
    } finally {
      setSaving(false);
      setSending(false);
    }
  };

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return [];
    const q = contactSearch.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q)
    );
  }, [contacts, contactSearch]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl p-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-6 pb-4 border-b">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            <DialogTitle className="text-xl">
              {quotationToEdit ? "Edit Quotation " + quotationToEdit.quote_number : "Create New Quotation"}
            </DialogTitle>
          </div>
          <DialogDescription>
            Prepare a formal, itemized quotation with GST, discounts, and payment terms for WhatsApp delivery.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 p-6">
          <div className="space-y-6">
            {/* Top Row: Title & Scope */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="q_title">Quotation Subject / Service Title *</Label>
                <Input
                  id="q_title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Private Limited Company Registration & GST Package"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="q_valid">Valid Until Date</Label>
                <Input
                  id="q_valid"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
            </div>

            {/* Client Details Section */}
            <div className="rounded-lg border p-4 bg-muted/20 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <User className="h-4 w-4 text-primary" />
                  Client Information
                </div>

                {!initialContact && (
                  <div className="relative w-64">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      className="h-8 pl-8 text-xs"
                      placeholder="Search existing contact..."
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                    />
                    {filteredContacts.length > 0 && (
                      <div className="absolute top-9 left-0 right-0 z-50 rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                        {filteredContacts.map((c) => (
                          <div
                            key={c.id}
                            className="p-2 text-xs hover:bg-muted cursor-pointer flex justify-between items-center"
                            onClick={() => handleSelectContact(c)}
                          >
                            <div>
                              <div className="font-semibold">{c.name || "Unnamed"}</div>
                              <div className="text-muted-foreground">{c.phone}</div>
                            </div>
                            <Check className="h-3 w-3 text-primary opacity-0 hover:opacity-100" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="client_name">Client / Signatory Name *</Label>
                  <Input
                    id="client_name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Srikanth Rao"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="client_phone">WhatsApp Phone</Label>
                  <Input
                    id="client_phone"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="client_email">Email</Label>
                  <Input
                    id="client_email"
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="client@example.com"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="client_company">Company / Business Name</Label>
                  <Input
                    id="client_company"
                    value={clientCompany}
                    onChange={(e) => setClientCompany(e.target.value)}
                    placeholder="Srikanth Ventures LLP"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="client_gstin">Client GSTIN (Optional)</Label>
                  <Input
                    id="client_gstin"
                    value={clientGstin}
                    onChange={(e) => setClientGstin(e.target.value)}
                    placeholder="36AAAAA0000A1Z5"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="client_address">Address / City</Label>
                  <Input
                    id="client_address"
                    value={clientAddress}
                    onChange={(e) => setClientAddress(e.target.value)}
                    placeholder="Banjara Hills, Hyderabad"
                  />
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Quotation Line Items</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={handleAddItem}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Line Item
                </Button>
              </div>

              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted text-muted-foreground border-b font-medium">
                    <tr>
                      <th className="p-2.5 text-left w-6/12">Item Title & Description</th>
                      <th className="p-2.5 text-center w-2/12">Qty</th>
                      <th className="p-2.5 text-right w-2/12">Unit Rate (₹)</th>
                      <th className="p-2.5 text-right w-2/12">Total (₹)</th>
                      <th className="p-2.5 text-center w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-muted/30">
                        <td className="p-2 space-y-1">
                          <Input
                            className="h-8 text-xs font-medium"
                            placeholder="Service title e.g. Name Approval (RUN)"
                            value={item.title}
                            onChange={(e) => handleItemChange(idx, "title", e.target.value)}
                          />
                          <Input
                            className="h-7 text-[11px] text-muted-foreground"
                            placeholder="Optional description / scope details"
                            value={item.description}
                            onChange={(e) => handleItemChange(idx, "description", e.target.value)}
                          />
                        </td>
                        <td className="p-2 align-top">
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            className="h-8 text-center text-xs"
                            value={item.quantity}
                            onChange={(e) => handleItemChange(idx, "quantity", parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="p-2 align-top">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 text-right text-xs"
                            value={item.unit_price}
                            onChange={(e) => handleItemChange(idx, "unit_price", parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="p-2.5 align-top text-right font-semibold text-foreground">
                          ₹{item.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-2 align-top text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveItem(idx)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Calculations & Totals Summary Panel */}
            <div className="grid gap-6 sm:grid-cols-2 pt-2">
              {/* Discount & Tax Controls */}
              <div className="space-y-4 rounded-lg border p-4 bg-muted/10">
                <div className="font-medium text-xs text-muted-foreground uppercase tracking-wider">
                  Discounts & Taxes
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Discount Type</Label>
                    <select
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={discountType}
                      onChange={(e) => setDiscountType(e.target.value as any)}
                    >
                      <option value="none">No Discount</option>
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed">Fixed Amount (₹)</option>
                    </select>
                  </div>

                  {discountType !== "none" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        {discountType === "percentage" ? "Discount %" : "Discount Amount (₹)"}
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        className="h-8 text-xs"
                        value={discountValue}
                        onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-xs">Tax Application</Label>
                    <select
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={taxType}
                      onChange={(e) => setTaxType(e.target.value as any)}
                    >
                      <option value="gst">GST (18% Standard)</option>
                      <option value="none">Tax Exempt / 0%</option>
                      <option value="custom">Custom Tax Rate</option>
                    </select>
                  </div>

                  {taxType === "custom" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tax Rate (%)</Label>
                      <Input
                        type="number"
                        min="0"
                        className="h-8 text-xs"
                        value={taxRate}
                        onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Internal Notes for Customer</Label>
                  <Textarea
                    className="text-xs"
                    rows={2}
                    placeholder="e.g. Turnaround time: 5-7 working days after document receipt."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              {/* Financial Calculation Breakdown Card */}
              <div className="rounded-lg border p-4 bg-muted/20 flex flex-col justify-between">
                <div className="space-y-2.5 text-xs">
                  <div className="font-semibold text-sm border-b pb-2 flex justify-between">
                    <span>Summary</span>
                    <span className="text-muted-foreground font-normal">INR (₹)</span>
                  </div>

                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal:</span>
                    <span className="font-medium text-foreground">
                      ₹{totals.subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {totals.discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-600 font-medium">
                      <span>Discount:</span>
                      <span>-₹{totals.discountAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-muted-foreground">
                    <span>Taxable Amount:</span>
                    <span className="font-medium text-foreground">
                      ₹{totals.taxableAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {totals.taxAmount > 0 && (
                    <>
                      <div className="flex justify-between text-muted-foreground">
                        <span>CGST ({(taxRate / 2).toFixed(1)}%):</span>
                        <span>₹{totals.cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>SGST ({(taxRate / 2).toFixed(1)}%):</span>
                        <span>₹{totals.sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="pt-4 border-t mt-3 flex items-baseline justify-between">
                  <span className="text-base font-bold text-foreground">Grand Total:</span>
                  <span className="text-2xl font-black text-primary tracking-tight">
                    ₹{totals.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Terms and Conditions Accordion/Block */}
            <div className="space-y-1.5">
              <Label className="text-xs">Quotation Terms & Conditions</Label>
              <Textarea
                className="text-xs font-mono"
                rows={3}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="p-4 border-t bg-muted/10 gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={saving || sending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={saving || sending}
              onClick={() => handleSaveQuotation(false)}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save as Draft"
              )}
            </Button>

            <Button
              type="button"
              disabled={saving || sending}
              onClick={() => handleSaveQuotation(true)}
              className="gap-1.5"
            >
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending via WhatsApp...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Save & Send on WhatsApp
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
