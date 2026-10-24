"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Receipt, Loader2, Building2, Landmark, QrCode, FileText } from "lucide-react";
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
import type { QuotationSettings } from "@/types";

export function QuotationSettingsPanel() {
  const { accountRole } = useAuth();
  const canEdit = accountRole === "owner" || accountRole === "admin";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        description="Configure company details, GSTIN, bank information, and quote numbering for PDF generation and WhatsApp delivery."
      />

      <form onSubmit={handleSave} className="space-y-6">
        {/* Company Details */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <CardTitle>Company Details</CardTitle>
            </div>
            <CardDescription>
              These details appear on the header of all client-facing quotations and PDFs.
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
              <Label htmlFor="company_logo_url">Company Logo URL (Optional)</Label>
              <Input
                id="company_logo_url"
                disabled={!canEdit}
                value={formData.company_logo_url || ""}
                onChange={(e) => handleChange("company_logo_url", e.target.value)}
                placeholder="https://example.com/logo.png"
              />
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
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bank_name">Bank Name</Label>
              <Input
                id="bank_name"
                disabled={!canEdit}
                value={formData.bank_name || ""}
                onChange={(e) => handleChange("bank_name", e.target.value)}
                placeholder="HDFC Bank"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bank_beneficiary_name">Beneficiary / Account Name</Label>
              <Input
                id="bank_beneficiary_name"
                disabled={!canEdit}
                value={formData.bank_beneficiary_name || ""}
                onChange={(e) => handleChange("bank_beneficiary_name", e.target.value)}
                placeholder="Deccan Filings Private Limited"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bank_account_no">Account Number</Label>
              <Input
                id="bank_account_no"
                disabled={!canEdit}
                value={formData.bank_account_no || ""}
                onChange={(e) => handleChange("bank_account_no", e.target.value)}
                placeholder="50200012345678"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bank_ifsc">IFSC Code</Label>
              <Input
                id="bank_ifsc"
                disabled={!canEdit}
                value={formData.bank_ifsc || ""}
                onChange={(e) => handleChange("bank_ifsc", e.target.value)}
                placeholder="HDFC0001234"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="upi_id">UPI ID / VPA</Label>
              <Input
                id="upi_id"
                disabled={!canEdit}
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
                placeholder="1. Quotation valid for 15 days from date of issue.&#10;2. 50% advance before project commencement.&#10;3. Government statutory fees subject to actual receipts."
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
