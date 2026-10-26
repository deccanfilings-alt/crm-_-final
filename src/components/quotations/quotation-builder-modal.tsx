"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
  Building2,
  Upload,
  X,
  Stamp,
  PenTool,
  ChevronDown,
  ChevronUp,
  Phone,
  Mail,
  MessageSquare,
  Sparkles,
  RotateCcw,
  ExternalLink,
} from "lucide-react";
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
import { uploadAccountMedia } from "@/lib/storage/upload-media";
import type { Contact, Quotation } from "@/types";

interface FormItem {
  id?: string;
  title: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

interface QuotationBuilderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContact?: Contact | null;
  initialConversationId?: string | null;
  quotationToEdit?: Quotation | null;
  onSuccess?: (quotation: Quotation) => void;
}

export function QuotationBuilderModal({
  open,
  onOpenChange,
  initialContact,
  initialConversationId,
  quotationToEdit,
  onSuccess,
}: QuotationBuilderModalProps) {
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  // Dynamic Contact Search across entire database (5,500+ contacts)
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [searchingContacts, setSearchingContacts] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Form Fields - Quotation Meta
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

  // Dynamic WhatsApp Message / Cover Note
  const [customMessage, setCustomMessage] = useState("");
  const [isMessageEdited, setIsMessageEdited] = useState(false);
  const [activeMessageTab, setActiveMessageTab] = useState<"edit" | "preview">("edit");

  // Dynamic Issuing Entity & Signatures/Stamps (Collapsed by default for clean UX)
  const [showEntityDetails, setShowEntityDetails] = useState(false);
  const [companyName, setCompanyName] = useState("Deccan Filings");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyGstin, setCompanyGstin] = useState("");
  const [companyPan, setCompanyPan] = useState("");
  const [signatureUrl, setSignatureUrl] = useState("");
  const [stampUrl, setStampUrl] = useState("");

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const sigInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<FormItem[]>([
    {
      title: "Professional Services",
      description: "Comprehensive documentation, consulting and filing service",
      quantity: 1,
      unit_price: 5000,
      total: 5000,
    },
  ]);

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

  // Real-time Database Contact Search (searches all 5,500+ records)
  const searchContacts = useCallback(async (query: string) => {
    try {
      setSearchingContacts(true);
      const res = await fetch(`/api/contacts?search=${encodeURIComponent(query)}&limit=25`);
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts || []);
      }
    } catch (err) {
      console.error("Failed to search contacts:", err);
    } finally {
      setSearchingContacts(false);
    }
  }, []);

  // Debounced search on input change
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      searchContacts(contactSearch);
    }, 250);
    return () => clearTimeout(timer);
  }, [contactSearch, searchContacts, open]);

  // Click outside listener for contact dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setShowContactDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Generate smart default WhatsApp message
  const generateDefaultMessage = useCallback(() => {
    const validStr = validUntil
      ? new Date(validUntil).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "15 Days from issue";

    return [
      `📄 *Quotation from ${companyName || "Deccan Filings"}*`,
      "",
      `Dear *${clientName || "Valued Client"}*,`,
      "",
      `We have prepared your quotation for *${title || "Professional Services"}*.`,
      "",
      `💰 *Total Amount:* ₹${totals.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
      `🗓 *Valid Until:* ${validStr}`,
      "",
      "🔗 *View & Approve Online:*",
      "[Secure quotation link attached automatically]",
      "",
      "Please review and reply here if you have any questions!",
    ].join("\n");
  }, [companyName, clientName, title, totals.totalAmount, validUntil]);

  // Update default message when quotation basics change (unless user manually customized it)
  useEffect(() => {
    if (!isMessageEdited) {
      setCustomMessage(generateDefaultMessage());
    }
  }, [generateDefaultMessage, isMessageEdited]);

  // File upload handler
  const handleUploadFile = async (
    field: "company_logo_url" | "signature_url" | "stamp_url",
    file: File
  ) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (PNG, JPG, WEBP).");
      return;
    }

    try {
      if (field === "company_logo_url") setUploadingLogo(true);
      if (field === "signature_url") setUploadingSig(true);
      if (field === "stamp_url") setUploadingStamp(true);

      const res = await uploadAccountMedia("chat-media", file);
      if (field === "company_logo_url") setCompanyLogoUrl(res.publicUrl);
      if (field === "signature_url") setSignatureUrl(res.publicUrl);
      if (field === "stamp_url") setStampUrl(res.publicUrl);
      toast.success("Image uploaded successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to upload image");
    } finally {
      if (field === "company_logo_url") setUploadingLogo(false);
      if (field === "signature_url") setUploadingSig(false);
      if (field === "stamp_url") setUploadingStamp(false);
    }
  };

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

      // Dynamic Company & Signature Overrides
      setCompanyName(quotationToEdit.company_name || "Deccan Filings");
      setCompanyLogoUrl(quotationToEdit.company_logo_url || "");
      setCompanyAddress(quotationToEdit.company_address || "");
      setCompanyPhone(quotationToEdit.company_phone || "");
      setCompanyEmail(quotationToEdit.company_email || "");
      setCompanyWebsite(quotationToEdit.company_website || "");
      setCompanyGstin(quotationToEdit.gstin || "");
      setCompanyPan(quotationToEdit.pan || "");
      setSignatureUrl(quotationToEdit.signature_url || "");
      setStampUrl(quotationToEdit.stamp_url || "");

      if (quotationToEdit.custom_message) {
        setCustomMessage(quotationToEdit.custom_message);
        setIsMessageEdited(true);
      }

      // If quotation has custom company/signature, auto-open customization
      if (
        (quotationToEdit.company_name && quotationToEdit.company_name !== "Deccan Filings") ||
        quotationToEdit.signature_url ||
        quotationToEdit.stamp_url
      ) {
        setShowEntityDetails(true);
      }

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
        setClientAddress((contact as any)?.address || "");
        setClientGstin((contact as any)?.gstin || "");
      } else {
        setClientName("");
        setClientPhone("");
        setClientEmail("");
        setClientCompany("");
        setClientAddress("");
        setClientGstin("");
      }

      setTitle("");
      setIssueDate(new Date().toISOString().split("T")[0]);
      const d = new Date();
      d.setDate(d.getDate() + 15);
      setValidUntil(d.toISOString().split("T")[0]);

      setDiscountType("none");
      setDiscountValue(0);
      setTaxType("gst");
      setTaxRate(18.0);
      setNotes("");
      setIsMessageEdited(false);
      setShowEntityDetails(false);

      // Fetch default settings
      fetch("/api/quotations/settings")
        .then((r) => r.json())
        .then((data) => {
          if (data.settings) {
            const s = data.settings;
            if (s.company_name) setCompanyName(s.company_name);
            if (s.company_logo_url) setCompanyLogoUrl(s.company_logo_url);
            if (s.company_address) setCompanyAddress(s.company_address);
            if (s.company_phone) setCompanyPhone(s.company_phone);
            if (s.company_email) setCompanyEmail(s.company_email);
            if (s.company_website) setCompanyWebsite(s.company_website);
            if (s.gstin) setCompanyGstin(s.gstin);
            if (s.pan) setCompanyPan(s.pan);
            if (s.signature_url) setSignatureUrl(s.signature_url);
            if (s.stamp_url) setStampUrl(s.stamp_url);
            if (s.default_terms) setTerms(s.default_terms);
            if (s.default_tax_rate !== undefined) setTaxRate(s.default_tax_rate);
          }
        })
        .catch(() => {});

      setItems([
        {
          title: "Professional Services",
          description: "Comprehensive documentation, consulting and filing service",
          quantity: 1,
          unit_price: 5000,
          total: 5000,
        },
      ]);
    }
  }, [open, quotationToEdit, initialContact]);

  // Handle Contact Pick
  const handleSelectContact = (c: Contact) => {
    setSelectedContact(c);
    setClientName(c.name || c.phone || "Client");
    setClientPhone(c.phone || "");
    setClientEmail(c.email || "");
    setClientCompany(c.company || "");
    setClientAddress((c as any)?.address || "");
    setClientGstin((c as any)?.gstin || "");
    setShowContactDropdown(false);
    setContactSearch("");
    toast.success(`Linked contact: ${c.name || c.phone}`);
  };

  const handleClearSelectedContact = () => {
    setSelectedContact(null);
  };

  // Line Items Manipulation
  const handleItemChange = (index: number, field: keyof FormItem, value: any) => {
    setItems((prev) => {
      const updated = [...prev];
      const cur = { ...updated[index], [field]: value };
      cur.total =
        Math.round(
          (Number(cur.quantity || 0) * Number(cur.unit_price || 0) + Number.EPSILON) * 100
        ) / 100;
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
    if (sendAfterSave && !clientPhone.trim()) {
      toast.error("A WhatsApp phone number is required to send on WhatsApp.");
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
        contact_id:
          selectedContact?.id || initialContact?.id || quotationToEdit?.contact_id || null,
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
        custom_message: customMessage.trim() || null,
        // Dynamic Issuing Entity & Signatures
        company_name: companyName.trim() || null,
        company_logo_url: companyLogoUrl.trim() || null,
        company_address: companyAddress.trim() || null,
        company_phone: companyPhone.trim() || null,
        company_email: companyEmail.trim() || null,
        company_website: companyWebsite.trim() || null,
        gstin: companyGstin.trim() || null,
        pan: companyPan.trim() || null,
        signature_url: signatureUrl.trim() || null,
        stamp_url: stampUrl.trim() || null,
        items: items.map((it) => ({
          title: it.title,
          description: it.description || null,
          quantity: it.quantity,
          unit_price: it.unit_price,
        })),
      };

      const url = quotationToEdit ? `/api/quotations/${quotationToEdit.id}` : "/api/quotations";
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
        const sendRes = await fetch(`/api/quotations/${savedQuote.id}/send-whatsapp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ custom_message: customMessage.trim() }),
        });
        const sendData = await sendRes.json();
        if (!sendRes.ok) {
          throw new Error(sendData.error || "Quotation saved, but WhatsApp delivery failed");
        }
        toast.success("Quotation saved & dispatched via WhatsApp!");
      } else {
        toast.success(
          quotationToEdit ? "Quotation updated successfully!" : "Quotation created successfully!"
        );
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[95vw] sm:max-w-4xl p-0 overflow-hidden flex flex-col border border-border shadow-2xl">
        {/* Header */}
        <DialogHeader className="p-4 sm:p-6 pb-3 border-b bg-muted/20 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <Receipt className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-lg sm:text-xl font-bold">
                  {quotationToEdit
                    ? `Edit Quotation ${quotationToEdit.quote_number}`
                    : "Create New Quotation"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Prepare a formal, itemized quotation with GST, client details, and WhatsApp cover message.
                </DialogDescription>
              </div>
            </div>
            {quotationToEdit && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-semibold">
                {quotationToEdit.quote_number}
              </span>
            )}
          </div>
        </DialogHeader>

        {/* Scrollable Content */}
        <ScrollArea className="flex-1 p-4 sm:p-6 overflow-y-auto">
          <div className="space-y-6">
            {/* Top Row: Title & Dates (Spacious & Responsive) */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4">
              <div className="md:col-span-6 space-y-1.5">
                <Label htmlFor="quote_title" className="text-xs font-semibold">
                  Quotation Subject / Service Title *
                </Label>
                <Input
                  id="quote_title"
                  placeholder="e.g. Private Limited Company Registration & GST Filing"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="h-9 text-xs sm:text-sm"
                />
              </div>

              <div className="grid grid-cols-2 md:col-span-6 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="issue_date" className="text-xs font-medium">Issue Date</Label>
                  <Input
                    id="issue_date"
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="valid_until" className="text-xs font-medium">Valid Until</Label>
                  <Input
                    id="valid_until"
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Issuing Entity & Signatures (Collapsible Banner - Clean UX) */}
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center justify-between p-3 sm:p-4 bg-muted/20">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div className="truncate">
                    <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                      <span>Issuing Entity:</span>
                      <span className="text-primary font-bold">{companyName || "Deccan Filings"}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                      Default billing company, digital signatures & official seal
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 shrink-0"
                  onClick={() => setShowEntityDetails(!showEntityDetails)}
                >
                  {showEntityDetails ? (
                    <>
                      Close Details <ChevronUp className="h-3.5 w-3.5" />
                    </>
                  ) : (
                    <>
                      Customize Entity & Stamp <ChevronDown className="h-3.5 w-3.5" />
                    </>
                  )}
                </Button>
              </div>

              {showEntityDetails && (
                <div className="p-4 border-t space-y-4 bg-muted/5">
                  <p className="text-xs text-muted-foreground">
                    Serving another client or sister entity? You can override company name, GSTIN, digital signatures, and official seals for this quotation:
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Issuing Company Name</Label>
                      <Input
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="Deccan Filings"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Company Phone</Label>
                      <Input
                        value={companyPhone}
                        onChange={(e) => setCompanyPhone(e.target.value)}
                        placeholder="+91 99999 99999"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Billing Email</Label>
                      <Input
                        type="email"
                        value={companyEmail}
                        onChange={(e) => setCompanyEmail(e.target.value)}
                        placeholder="billing@example.com"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Issuing GSTIN</Label>
                      <Input
                        value={companyGstin}
                        onChange={(e) => setCompanyGstin(e.target.value)}
                        placeholder="36AAAAA0000A1Z5"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Issuing PAN</Label>
                      <Input
                        value={companyPan}
                        onChange={(e) => setCompanyPan(e.target.value)}
                        placeholder="AAAAA0000A"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Address / City</Label>
                      <Input
                        value={companyAddress}
                        onChange={(e) => setCompanyAddress(e.target.value)}
                        placeholder="Hyderabad, Telangana"
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>

                  {/* Dynamic Signature & Stamp Uploaders */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
                    {/* Authorized Signature Card */}
                    <div className="p-3.5 border rounded-lg bg-card space-y-2.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold flex items-center gap-1.5">
                          <PenTool className="h-3.5 w-3.5 text-primary" />
                          Authorized Signature
                        </Label>
                        <input
                          type="file"
                          ref={sigInputRef}
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUploadFile("signature_url", f);
                          }}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={uploadingSig}
                          onClick={() => sigInputRef.current?.click()}
                          className="h-7 text-[11px] gap-1"
                        >
                          {uploadingSig ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Upload className="h-3 w-3" />
                          )}
                          Upload Photo
                        </Button>
                      </div>

                      <Input
                        className="h-7 text-xs"
                        placeholder="Or enter signature image URL..."
                        value={signatureUrl}
                        onChange={(e) => setSignatureUrl(e.target.value)}
                      />

                      {signatureUrl ? (
                        <div className="relative mt-2 p-2 border rounded-md bg-muted/20 flex items-center justify-center">
                          <img
                            src={signatureUrl}
                            alt="Signature Preview"
                            className="h-12 max-w-[160px] object-contain"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 h-5 w-5 text-muted-foreground hover:text-destructive"
                            onClick={() => setSignatureUrl("")}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground italic">
                          No signature uploaded. A standard signature underline will be displayed.
                        </p>
                      )}
                    </div>

                    {/* Official Stamp / Seal Card */}
                    <div className="p-3.5 border rounded-lg bg-card space-y-2.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold flex items-center gap-1.5">
                          <Stamp className="h-3.5 w-3.5 text-primary" />
                          Official Seal / Stamp
                        </Label>
                        <input
                          type="file"
                          ref={stampInputRef}
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUploadFile("stamp_url", f);
                          }}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={uploadingStamp}
                          onClick={() => stampInputRef.current?.click()}
                          className="h-7 text-[11px] gap-1"
                        >
                          {uploadingStamp ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Upload className="h-3 w-3" />
                          )}
                          Upload Seal
                        </Button>
                      </div>

                      <Input
                        className="h-7 text-xs"
                        placeholder="Or enter stamp image URL..."
                        value={stampUrl}
                        onChange={(e) => setStampUrl(e.target.value)}
                      />

                      {stampUrl ? (
                        <div className="relative mt-2 p-2 border rounded-md bg-muted/20 flex items-center justify-center">
                          <img
                            src={stampUrl}
                            alt="Stamp Preview"
                            className="h-12 max-w-[100px] object-contain"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 h-5 w-5 text-muted-foreground hover:text-destructive"
                            onClick={() => setStampUrl("")}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground italic">
                          Optional. Upload official seal to imprint on the quotation.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Client & Mobile Search (Searches 5,500+ contacts with real-time dropdown) */}
            <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">Client / Recipient Information</span>
                </div>

                {/* Database Search Input with Auto-complete Dropdown */}
                <div className="relative w-full sm:w-80" ref={searchContainerRef}>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      className="h-8 pl-8 pr-8 text-xs"
                      placeholder="Search 5,500+ contacts by mobile or name..."
                      value={contactSearch}
                      onFocus={() => setShowContactDropdown(true)}
                      onChange={(e) => {
                        setContactSearch(e.target.value);
                        setShowContactDropdown(true);
                      }}
                    />
                    {searchingContacts ? (
                      <Loader2 className="absolute right-2.5 top-2.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : contactSearch ? (
                      <button
                        type="button"
                        onClick={() => setContactSearch("")}
                        className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>

                  {/* Dropdown Results */}
                  {showContactDropdown && (
                    <div className="absolute top-9 left-0 right-0 z-50 rounded-lg border bg-popover text-popover-foreground shadow-xl max-h-56 overflow-y-auto divide-y">
                      {contacts.length > 0 ? (
                        contacts.map((c) => (
                          <div
                            key={c.id}
                            className="p-2.5 text-xs hover:bg-muted cursor-pointer transition-colors flex items-center justify-between gap-2"
                            onClick={() => handleSelectContact(c)}
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-foreground truncate">
                                {c.name || "Customer"}
                              </div>
                              <div className="text-primary font-mono text-[11px] flex items-center gap-1 mt-0.5">
                                <Phone className="h-3 w-3 shrink-0" />
                                {c.phone || "No phone"}
                              </div>
                              {c.company && (
                                <div className="text-[10px] text-muted-foreground truncate">
                                  {c.company}
                                </div>
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[11px] shrink-0 text-primary"
                            >
                              Select
                            </Button>
                          </div>
                        ))
                      ) : (
                        <div className="p-3 text-xs text-muted-foreground text-center">
                          {searchingContacts ? "Searching database..." : "No contacts found. Enter client details below manually."}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Linked Contact Indicator */}
              {selectedContact && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
                  <div className="flex items-center gap-2 truncate">
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <span className="truncate">
                      Linked Contact: <strong>{selectedContact.name || "Customer"}</strong> ({selectedContact.phone})
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground hover:text-destructive"
                    onClick={handleClearSelectedContact}
                  >
                    Unlink
                  </Button>
                </div>
              )}

              {/* Client Form Fields (Responsive Grid) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="client_name">Client / Signatory Name *</Label>
                  <Input
                    id="client_name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Srikanth Rao"
                    required
                    className="h-9 text-xs sm:text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-primary" htmlFor="client_phone">
                    WhatsApp Mobile Number *
                  </Label>
                  <Input
                    id="client_phone"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="h-9 text-xs sm:text-sm font-mono"
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
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="client_company">Company / Business Name</Label>
                  <Input
                    id="client_company"
                    value={clientCompany}
                    onChange={(e) => setClientCompany(e.target.value)}
                    placeholder="Srikanth Ventures LLP"
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="client_gstin">Client GSTIN (Optional)</Label>
                  <Input
                    id="client_gstin"
                    value={clientGstin}
                    onChange={(e) => setClientGstin(e.target.value)}
                    placeholder="36AAAAA0000A1Z5"
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="client_address">Address / City</Label>
                  <Input
                    id="client_address"
                    value={clientAddress}
                    onChange={(e) => setClientAddress(e.target.value)}
                    placeholder="Banjara Hills, Hyderabad"
                    className="h-9 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-bold">Quotation Line Items</Label>
                  <span className="text-xs text-muted-foreground">({items.length} items)</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs font-medium"
                  onClick={handleAddItem}
                >
                  <Plus className="h-3.5 w-3.5 text-primary" />
                  Add Line Item
                </Button>
              </div>

              <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[550px]">
                    <thead className="bg-muted/40 text-muted-foreground border-b font-semibold">
                      <tr>
                        <th className="p-3 text-left w-6/12">Item Title & Scope</th>
                        <th className="p-3 text-center w-2/12">Qty</th>
                        <th className="p-3 text-right w-2/12">Unit Rate (₹)</th>
                        <th className="p-3 text-right w-2/12">Total (₹)</th>
                        <th className="p-3 text-center w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-muted/20 transition-colors">
                          <td className="p-2.5 space-y-1.5">
                            <Input
                              className="h-8 text-xs font-medium"
                              placeholder="Service title e.g. Company Incorporation"
                              value={item.title}
                              onChange={(e) => handleItemChange(idx, "title", e.target.value)}
                            />
                            <Input
                              className="h-7 text-[11px] text-muted-foreground"
                              placeholder="Scope details (e.g. drafting MOA, DIN generation, ROC approvals)"
                              value={item.description}
                              onChange={(e) => handleItemChange(idx, "description", e.target.value)}
                            />
                          </td>
                          <td className="p-2.5 align-top">
                            <Input
                              type="number"
                              min="1"
                              step="1"
                              className="h-8 text-center text-xs"
                              value={item.quantity}
                              onChange={(e) =>
                                handleItemChange(idx, "quantity", parseFloat(e.target.value) || 0)
                              }
                            />
                          </td>
                          <td className="p-2.5 align-top">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              className="h-8 text-right text-xs"
                              value={item.unit_price}
                              onChange={(e) =>
                                handleItemChange(idx, "unit_price", parseFloat(e.target.value) || 0)
                              }
                            />
                          </td>
                          <td className="p-3 align-top text-right font-bold text-foreground">
                            ₹{item.total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                          <td className="p-2.5 align-top text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveItem(idx)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Calculations & Totals Summary Panel */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {/* Discount & Tax Controls */}
              <div className="space-y-4 rounded-xl border p-4 bg-muted/10">
                <div className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                  Discounts & Taxes
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <Label className="text-xs">Internal Notes / Deliverable Timeline</Label>
                  <Textarea
                    className="text-xs"
                    rows={2}
                    placeholder="e.g. Turnaround time: 5-7 working days after KYC receipt."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              {/* Financial Calculation Breakdown Card */}
              <div className="rounded-xl border p-4 bg-muted/20 flex flex-col justify-between shadow-sm">
                <div className="space-y-2 text-xs">
                  <div className="font-bold text-sm border-b pb-2 flex justify-between">
                    <span>Financial Summary</span>
                    <span className="text-muted-foreground font-normal">INR (₹)</span>
                  </div>

                  <div className="flex justify-between text-muted-foreground pt-1">
                    <span>Subtotal:</span>
                    <span className="font-medium text-foreground">
                      ₹{totals.subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {totals.discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-600 font-semibold">
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

                <div className="pt-3 border-t mt-3 flex items-baseline justify-between">
                  <span className="text-sm font-bold text-foreground">Grand Total:</span>
                  <span className="text-2xl font-black text-primary tracking-tight">
                    ₹{totals.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* WhatsApp Accompanying Message & Preview (The Message Space) */}
            <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2.5">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-emerald-600" />
                  <div>
                    <span className="font-bold text-xs text-foreground">
                      WhatsApp Accompanying Message & Cover Note
                    </span>
                    <p className="text-[11px] text-muted-foreground">
                      This is the exact message text delivered to the client on WhatsApp alongside the quote link.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="inline-flex rounded-md border p-0.5 bg-muted/30 text-xs">
                    <button
                      type="button"
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        activeMessageTab === "edit"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setActiveMessageTab("edit")}
                    >
                      Edit Message
                    </button>
                    <button
                      type="button"
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        activeMessageTab === "preview"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setActiveMessageTab("preview")}
                    >
                      WhatsApp Preview
                    </button>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px] text-muted-foreground hover:text-foreground gap-1"
                    title="Reset to generated default message"
                    onClick={() => {
                      setIsMessageEdited(false);
                      setCustomMessage(generateDefaultMessage());
                      toast.info("Reset to default message template");
                    }}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </Button>
                </div>
              </div>

              {activeMessageTab === "edit" ? (
                <div className="space-y-1.5">
                  <Textarea
                    className="text-xs font-mono leading-relaxed"
                    rows={6}
                    value={customMessage}
                    onChange={(e) => {
                      setCustomMessage(e.target.value);
                      setIsMessageEdited(true);
                    }}
                    placeholder="Enter accompanying message for WhatsApp delivery..."
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Supports WhatsApp markdown (*bold*, _italic_, ~strike~).</span>
                    <span>{customMessage.length} characters</span>
                  </div>
                </div>
              ) : (
                /* Realistic WhatsApp Chat Bubble Preview */
                <div className="p-4 rounded-lg bg-[#efeae2] dark:bg-[#0b141a] border flex justify-center">
                  <div className="max-w-md w-full bg-[#ffffff] dark:bg-[#202c33] p-3.5 rounded-lg shadow-sm text-xs space-y-2 border-l-4 border-emerald-500">
                    <div className="whitespace-pre-wrap font-sans text-gray-800 dark:text-gray-100 leading-relaxed text-[12px]">
                      {customMessage || "No message content."}
                    </div>
                    <div className="flex items-center justify-end gap-1 text-[10px] text-gray-400 dark:text-gray-400 pt-1">
                      <span>Just now</span>
                      <span className="text-sky-500 font-bold">✓✓</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Terms and Conditions Accordion/Block */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Quotation Terms & Conditions</Label>
              <Textarea
                className="text-xs font-mono"
                rows={3}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </div>
          </div>
        </ScrollArea>

        {/* Footer */}
        <DialogFooter className="p-4 border-t bg-muted/20 gap-2 sm:gap-0 shrink-0">
          <Button
            type="button"
            variant="outline"
            disabled={saving || sending}
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={saving || sending}
              onClick={() => handleSaveQuotation(false)}
              className="text-xs"
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
              className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
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
