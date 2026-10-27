"use client";

import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import {
  Receipt,
  Loader2,
  Building2,
  Landmark,
  QrCode,
  FileText,
  Upload,
  X,
  CheckCircle2,
  Stamp,
  PenTool,
  Lock,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";
import { uploadAccountMedia } from "@/lib/storage/upload-media";
import type { QuotationSettings } from "@/types";

export function QuotationSettingsPanel() {
  const { accountRole } = useAuth();
  const canEdit = accountRole === "owner" || accountRole === "admin";
  const canEditBank = accountRole === "owner";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSig, setUploadingSig] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const sigInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<Partial<QuotationSettings>>({
    company_name: "Deccan Filings",
    company_address: "",
    company_phone: "",
    company_email: "",
    company_website: "",
    company_logo_url: "",
    gstin: "",
    pan: "",
    bank_name: "",
    bank_beneficiary_name: "",
    bank_account_no: "",
    bank_ifsc: "",
    upi_id: "",
    upi_qr_url: "",
    signature_url: "",
    stamp_url: "",
    quote_prefix: "DF-QT-",
    next_quote_number: 1001,
    default_currency: "INR",
    default_tax_rate: 18.0,
    default_terms: "",
  });

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/quotations/settings");
        if (res.ok) {
          const json = await res.json();
          if (json.settings) {
            setFormData(json.settings);
          }
        }
      } catch (err) {
        console.error("Failed to load quotation settings:", err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleChange = (field: keyof QuotationSettings, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleFileUpload = async (
    field: "company_logo_url" | "signature_url" | "stamp_url",
    file: File
  ) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload a valid image file (PNG, JPG, WEBP, SVG).");
      return;
    }

    try {
      if (field === "company_logo_url") setUploadingLogo(true);
      if (field === "signature_url") setUploadingSig(true);
      if (field === "stamp_url") setUploadingStamp(true);

      const res = await uploadAccountMedia("chat-media", file);
      handleChange(field, res.publicUrl);
      toast.success("Image uploaded successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to upload image");
    } finally {
      if (field === "company_logo_url") setUploadingLogo(false);
      if (field === "signature_url") setUploadingSig(false);
      if (field === "stamp_url") setUploadingStamp(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast.error("Only admins and owners can modify quotation settings.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/quotations/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save settings");
      }
      toast.success("Quotation & Billing settings saved successfully!");
      if (data.settings) {
        setFormData(data.settings);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="Quotations & Billing"
        description="Configure default issuing company details, GSTIN, bank information, authorized signatures, and official seals for quotations and invoices."
      />

      <form onSubmit={handleSave} className="space-y-6">
        {/* Company Details */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <CardTitle>Default Issuing Company Details</CardTitle>
            </div>
            <CardDescription>
              These details appear on the header of client quotations. You can also customize the issuing company per quotation when serving other client entities.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="company_name">Company Legal Name</Label>
              <Input
                id="company_name"
                disabled={!canEdit}
                value={formData.company_name || ""}
                onChange={(e) => handleChange("company_name", e.target.value)}
                placeholder="Deccan Filings Private Limited"
                required
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="company_address">Registered Address</Label>
              <Textarea
                id="company_address"
                disabled={!canEdit}
                value={formData.company_address || ""}
                onChange={(e) => handleChange("company_address", e.target.value)}
                placeholder="Suite 402, Signature Towers, Hyderabad, Telangana - 500081"
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company_phone">Official Contact Phone</Label>
              <Input
                id="company_phone"
                disabled={!canEdit}
                value={formData.company_phone || ""}
                onChange={(e) => handleChange("company_phone", e.target.value)}
                placeholder="+91 99999 99999"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company_email">Official Billing Email</Label>
              <Input
                id="company_email"
                type="email"
                disabled={!canEdit}
                value={formData.company_email || ""}
                onChange={(e) => handleChange("company_email", e.target.value)}
                placeholder="billing@deccanfilings.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company_website">Website URL</Label>
              <Input
                id="company_website"
                disabled={!canEdit}
                value={formData.company_website || ""}
                onChange={(e) => handleChange("company_website", e.target.value)}
                placeholder="https://deccanfilings.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company_logo_url">Company Logo</Label>
              <div className="flex gap-2">
                <Input
                  id="company_logo_url"
                  disabled={!canEdit}
                  value={formData.company_logo_url || ""}
                  onChange={(e) => handleChange("company_logo_url", e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="flex-1 text-xs"
                />
                <input
                  type="file"
                  ref={logoInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload("company_logo_url", f);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canEdit || uploadingLogo}
                  onClick={() => logoInputRef.current?.click()}
                  className="gap-1.5 text-xs shrink-0"
                >
                  {uploadingLogo ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Upload
                </Button>
              </div>
              {formData.company_logo_url && (
                <div className="mt-2 flex items-center gap-3 p-2 border rounded-md bg-muted/20">
                  <img
                    src={formData.company_logo_url}
                    alt="Company Logo Preview"
                    className="h-10 max-w-[120px] object-contain rounded"
                  />
                  <div className="flex-1 text-[11px] text-muted-foreground truncate">
                    Logo Preview Active
                  </div>
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleChange("company_logo_url", "")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Dynamic Signatures & Stamps */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Stamp className="h-5 w-5 text-primary" />
              <CardTitle>Authorized Signature & Official Stamp</CardTitle>
            </div>
            <CardDescription>
              Upload your company&apos;s digital signature and seal. These appear on generated quotation PDFs and web views. Can also be overridden dynamically on any individual quotation.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            {/* Signature Upload */}
            <div className="space-y-3 p-4 border rounded-lg bg-muted/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium text-xs">
                  <PenTool className="h-4 w-4 text-primary" />
                  Authorized Signature
                </div>
                {formData.signature_url && (
                  <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Configured
                  </span>
                )}
              </div>

              <div className="flex gap-2">
                <Input
                  disabled={!canEdit}
                  value={formData.signature_url || ""}
                  onChange={(e) => handleChange("signature_url", e.target.value)}
                  placeholder="https://.../signature.png"
                  className="text-xs flex-1"
                />
                <input
                  type="file"
                  ref={sigInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload("signature_url", f);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canEdit || uploadingSig}
                  onClick={() => sigInputRef.current?.click()}
                  className="gap-1.5 text-xs shrink-0"
                >
                  {uploadingSig ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Upload Image
                </Button>
              </div>

              {formData.signature_url ? (
                <div className="relative border rounded-md p-3 bg-background flex flex-col items-center justify-center">
                  <img
                    src={formData.signature_url}
                    alt="Signature Preview"
                    className="h-16 max-w-[200px] object-contain"
                  />
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute top-1 right-1 h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleChange("signature_url", "")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground italic border border-dashed rounded p-3 text-center">
                  No signature uploaded. A standard signature underline placeholder will be shown.
                </div>
              )}
            </div>

            {/* Stamp Upload */}
            <div className="space-y-3 p-4 border rounded-lg bg-muted/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium text-xs">
                  <Stamp className="h-4 w-4 text-primary" />
                  Official Seal / Stamp
                </div>
                {formData.stamp_url && (
                  <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Configured
                  </span>
                )}
              </div>

              <div className="flex gap-2">
                <Input
                  disabled={!canEdit}
                  value={formData.stamp_url || ""}
                  onChange={(e) => handleChange("stamp_url", e.target.value)}
                  placeholder="https://.../official-stamp.png"
                  className="text-xs flex-1"
                />
                <input
                  type="file"
                  ref={stampInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload("stamp_url", f);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canEdit || uploadingStamp}
                  onClick={() => stampInputRef.current?.click()}
                  className="gap-1.5 text-xs shrink-0"
                >
                  {uploadingStamp ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Upload Image
                </Button>
              </div>

              {formData.stamp_url ? (
                <div className="relative border rounded-md p-3 bg-background flex flex-col items-center justify-center">
                  <img
                    src={formData.stamp_url}
                    alt="Stamp Preview"
                    className="h-16 max-w-[120px] object-contain"
                  />
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute top-1 right-1 h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleChange("stamp_url", "")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground italic border border-dashed rounded p-3 text-center">
                  No official stamp uploaded. Optional.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* GSTIN & Tax */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <CardTitle>Tax & Statutory Registration</CardTitle>
            </div>
            <CardDescription>
              GSTIN and PAN printed on quotations for tax compliance and B2B input credit.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input
                id="gstin"
                disabled={!canEdit}
                value={formData.gstin || ""}
                onChange={(e) => handleChange("gstin", e.target.value)}
                placeholder="36AAAAA0000A1Z5"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pan">PAN</Label>
              <Input
                id="pan"
                disabled={!canEdit}
                value={formData.pan || ""}
                onChange={(e) => handleChange("pan", e.target.value)}
                placeholder="AAAAA0000A"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="default_tax_rate">Default GST Rate (%)</Label>
              <Input
                id="default_tax_rate"
                type="number"
                step="0.01"
                disabled={!canEdit}
                value={formData.default_tax_rate ?? 18}
                onChange={(e) => handleChange("default_tax_rate", e.target.value)}
                placeholder="18"
              />
            </div>
          </CardContent>
        </Card>

        {/* Bank & UPI Payment Information */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-primary" />
              <CardTitle>Bank & UPI Payment Details</CardTitle>
            </div>
            <CardDescription>
              Payment instructions shown at the bottom of the quotation and on the public client web view.
            </CardDescription>
            {!canEditBank && (
              <div className="mt-2.5 flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-400 border border-amber-500/20">
                <Lock className="h-4 w-4 shrink-0" />
                <span>Protected: Only the Account Owner (CEO) can modify official bank account and UPI details.</span>
              </div>
            )}
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bank_name">Bank Name</Label>
              <Input
                id="bank_name"
                disabled={!canEditBank}
                value={formData.bank_name || ""}
                onChange={(e) => handleChange("bank_name", e.target.value)}
                placeholder="HDFC Bank"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bank_beneficiary_name">Beneficiary / Account Name</Label>
              <Input
                id="bank_beneficiary_name"
                disabled={!canEditBank}
                value={formData.bank_beneficiary_name || ""}
                onChange={(e) => handleChange("bank_beneficiary_name", e.target.value)}
                placeholder="Deccan Filings Private Limited"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bank_account_no">Account Number</Label>
              <Input
                id="bank_account_no"
                disabled={!canEditBank}
                value={formData.bank_account_no || ""}
                onChange={(e) => handleChange("bank_account_no", e.target.value)}
                placeholder="50200012345678"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bank_ifsc">IFSC Code</Label>
              <Input
                id="bank_ifsc"
                disabled={!canEditBank}
                value={formData.bank_ifsc || ""}
                onChange={(e) => handleChange("bank_ifsc", e.target.value)}
                placeholder="HDFC0001234"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="upi_id">UPI ID / VPA</Label>
              <Input
                id="upi_id"
                disabled={!canEditBank}
                value={formData.upi_id || ""}
                onChange={(e) => handleChange("upi_id", e.target.value)}
                placeholder="deccanfilings@hdfcbank"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="upi_qr_url">UPI QR Code Image URL (Optional)</Label>
              <Input
                id="upi_qr_url"
                disabled={!canEdit}
                value={formData.upi_qr_url || ""}
                onChange={(e) => handleChange("upi_qr_url", e.target.value)}
                placeholder="https://example.com/upi-qr.png"
              />
            </div>
          </CardContent>
        </Card>

        {/* Numbering & Terms */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" />
              <CardTitle>Numbering & Default Terms</CardTitle>
            </div>
            <CardDescription>
              Automatic quotation reference generator and terms & conditions boilerplate.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="quote_prefix">Quotation Number Prefix</Label>
              <Input
                id="quote_prefix"
                disabled={!canEdit}
                value={formData.quote_prefix || "DF-QT-"}
                onChange={(e) => handleChange("quote_prefix", e.target.value)}
                placeholder="DF-QT-"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="next_quote_number">Next Quotation Sequence Number</Label>
              <Input
                id="next_quote_number"
                type="number"
                disabled={!canEdit}
                value={formData.next_quote_number || 1001}
                onChange={(e) => handleChange("next_quote_number", e.target.value)}
                placeholder="1001"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="default_terms">Default Terms & Conditions</Label>
              <Textarea
                id="default_terms"
                disabled={!canEdit}
                value={formData.default_terms || ""}
                onChange={(e) => handleChange("default_terms", e.target.value)}
                placeholder="1. Quotation valid for 15 days from date of issue.&#10;2. 50% advance before project commencement.&#10;3. Delivery timelines commence post document completion."
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving Settings...
                </>
              ) : (
                "Save Quotation Settings"
              )}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
