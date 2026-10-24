import type { Quotation, QuotationSettings } from '@/types';
import { numberToWordsINR } from './amount-in-words';

export function renderQuotationHtml(quote: Quotation, settings: QuotationSettings): string {
  const items = quote.items || [];
  const currencySymbol = quote.currency === 'INR' ? '₹' : (quote.currency || '₹');
  const amountWords = quote.currency === 'INR' ? numberToWordsINR(quote.total_amount) : '';

  const issueDateFormatted = quote.issue_date
    ? new Date(quote.issue_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const validUntilFormatted = quote.valid_until
    ? new Date(quote.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '15 Days from issue';

  const rows = items
    .map(
      (it, idx) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center; color: #64748b; font-size: 13px;">${idx + 1}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">
          <div style="font-weight: 600; color: #0f172a; font-size: 14px;">${escapeHtml(it.title)}</div>
          ${it.description ? `<div style="color: #64748b; font-size: 12px; margin-top: 2px;">${escapeHtml(it.description)}</div>` : ''}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center; font-size: 13px; color: #334155;">${it.quantity}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 13px; color: #334155;">${currencySymbol}${it.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; font-size: 14px; color: #0f172a;">${currencySymbol}${it.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      </tr>
    `
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Quotation ${escapeHtml(quote.quote_number)} - ${escapeHtml(settings.company_name)}</title>
  <style>
    @page {
      size: A4;
      margin: 12mm 15mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-accepted { background: #dcfce7; color: #15803d; }
    .badge-sent { background: #e0f2fe; color: #0369a1; }
    .badge-draft { background: #f1f5f9; color: #475569; }
  </style>
</head>
<body>
  <!-- Print Action Bar -->
  <div class="no-print" style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 12px 18px; border-radius: 8px; border: 1px solid #e2e8f0;">
    <div>
      <span style="font-weight: 600; color: #1e293b;">Quotation Preview</span>
      <span style="color: #64748b; margin-left: 8px;">${escapeHtml(quote.quote_number)}</span>
    </div>
    <button onclick="window.print()" style="background: #0284c7; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer;">
      Print / Save as PDF
    </button>
  </div>

  <div style="max-width: 800px; margin: 0 auto; background: white;">
    <!-- Header -->
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
      <tr>
        <td style="vertical-align: top; width: 60%;">
          ${settings.company_logo_url ? `<img src="${escapeHtml(settings.company_logo_url)}" alt="Logo" style="max-height: 48px; margin-bottom: 8px;" />` : ''}
          <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">${escapeHtml(settings.company_name)}</div>
          ${settings.company_address ? `<div style="color: #475569; font-size: 13px; margin-top: 4px; white-space: pre-line;">${escapeHtml(settings.company_address)}</div>` : ''}
          <div style="color: #64748b; font-size: 13px; margin-top: 4px;">
            ${settings.company_phone ? `Phone: ${escapeHtml(settings.company_phone)} | ` : ''}
            ${settings.company_email ? `Email: ${escapeHtml(settings.company_email)}` : ''}
          </div>
          ${settings.gstin ? `<div style="color: #0369a1; font-size: 13px; font-weight: 600; margin-top: 4px;">GSTIN: ${escapeHtml(settings.gstin)}</div>` : ''}
        </td>
        <td style="vertical-align: top; text-align: right; width: 40%;">
          <div style="font-size: 24px; font-weight: 800; color: #0284c7; letter-spacing: 0.05em; text-transform: uppercase;">QUOTATION</div>
          <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 4px;">${escapeHtml(quote.quote_number)}</div>
          <div style="margin-top: 6px;">
            <span class="badge ${quote.status === 'accepted' ? 'badge-accepted' : quote.status === 'sent' ? 'badge-sent' : 'badge-draft'}">${escapeHtml(quote.status)}</span>
          </div>
          <div style="font-size: 13px; color: #475569; margin-top: 8px;">
            <div><strong>Date:</strong> ${issueDateFormatted}</div>
            <div><strong>Valid Until:</strong> ${validUntilFormatted}</div>
          </div>
        </td>
      </tr>
    </table>

    <!-- Quotation For / Subject -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="vertical-align: top; width: 50%;">
            <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">QUOTATION FOR</div>
            <div style="font-size: 15px; font-weight: 700; color: #0f172a;">${escapeHtml(quote.client_name)}</div>
            ${quote.client_company ? `<div style="font-size: 13px; color: #334155; font-weight: 500;">${escapeHtml(quote.client_company)}</div>` : ''}
            ${quote.client_phone ? `<div style="font-size: 13px; color: #64748b;">Phone: ${escapeHtml(quote.client_phone)}</div>` : ''}
            ${quote.client_email ? `<div style="font-size: 13px; color: #64748b;">Email: ${escapeHtml(quote.client_email)}</div>` : ''}
            ${quote.client_gstin ? `<div style="font-size: 13px; color: #0284c7; font-weight: 600;">GSTIN: ${escapeHtml(quote.client_gstin)}</div>` : ''}
          </td>
          <td style="vertical-align: top; width: 50%;">
            <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">SERVICE / SCOPE</div>
            <div style="font-size: 14px; font-weight: 600; color: #0f172a;">${escapeHtml(quote.title)}</div>
            ${quote.notes ? `<div style="font-size: 12px; color: #64748b; margin-top: 4px; white-space: pre-line;">${escapeHtml(quote.notes)}</div>` : ''}
          </td>
        </tr>
      </table>
    </div>

    <!-- Items Table -->
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <thead>
        <tr style="background: #0f172a; color: white;">
          <th style="padding: 10px 12px; text-align: center; font-size: 12px; font-weight: 600; width: 5%;">#</th>
          <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; width: 50%;">ITEM & DESCRIPTION</th>
          <th style="padding: 10px 12px; text-align: center; font-size: 12px; font-weight: 600; width: 10%;">QTY</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 600; width: 15%;">RATE</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 600; width: 20%;">TOTAL</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <!-- Totals & Payment Summary -->
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
      <tr>
        <td style="vertical-align: top; width: 55%; padding-right: 20px;">
          ${amountWords ? `
            <div style="background: #f1f5f9; padding: 12px 14px; border-radius: 6px; font-size: 13px; color: #334155; margin-bottom: 16px;">
              <strong style="color: #0f172a;">Amount in Words:</strong><br />${escapeHtml(amountWords)}
            </div>
          ` : ''}

          <!-- Bank / UPI Details -->
          ${(settings.bank_name || settings.upi_id) ? `
            <div style="border: 1px dashed #cbd5e1; border-radius: 6px; padding: 14px; font-size: 12px; color: #475569;">
              <div style="font-weight: 700; color: #0f172a; text-transform: uppercase; font-size: 11px; margin-bottom: 6px;">Payment Information</div>
              ${settings.bank_name ? `<div><strong>Bank:</strong> ${escapeHtml(settings.bank_name)} | <strong>A/C:</strong> ${escapeHtml(settings.bank_account_no || '')}</div>` : ''}
              ${settings.bank_ifsc ? `<div><strong>IFSC:</strong> ${escapeHtml(settings.bank_ifsc)} | <strong>Beneficiary:</strong> ${escapeHtml(settings.bank_beneficiary_name || settings.company_name)}</div>` : ''}
              ${settings.upi_id ? `<div style="margin-top: 4px; color: #0284c7; font-weight: 600;">UPI ID: ${escapeHtml(settings.upi_id)}</div>` : ''}
            </div>
          ` : ''}
        </td>

        <td style="vertical-align: top; width: 45%;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Subtotal:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 500; color: #0f172a;">${currencySymbol}${quote.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            ${quote.discount_amount > 0 ? `
              <tr>
                <td style="padding: 6px 0; color: #16a34a;">Discount ${quote.discount_type === 'percentage' ? `(${quote.discount_value}%)` : ''}:</td>
                <td style="padding: 6px 0; text-align: right; font-weight: 500; color: #16a34a;">-${currencySymbol}${quote.discount_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
            ` : ''}
            ${quote.tax_amount > 0 ? `
              <tr>
                <td style="padding: 6px 0; color: #64748b;">CGST (${(quote.tax_rate / 2).toFixed(1)}%):</td>
                <td style="padding: 6px 0; text-align: right; color: #334155;">${currencySymbol}${(quote.tax_amount / 2).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;">SGST (${(quote.tax_rate / 2).toFixed(1)}%):</td>
                <td style="padding: 6px 0; text-align: right; color: #334155;">${currencySymbol}${(quote.tax_amount / 2).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
            ` : ''}
            <tr style="border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a;">
              <td style="padding: 10px 0; font-size: 16px; font-weight: 800; color: #0f172a;">Grand Total:</td>
              <td style="padding: 10px 0; text-align: right; font-size: 18px; font-weight: 800; color: #0284c7;">${currencySymbol}${quote.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Terms & Signature -->
    <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
      <tr>
        <td style="vertical-align: top; width: 60%; font-size: 12px; color: #64748b;">
          ${quote.terms ? `
            <div style="font-weight: 700; color: #334155; margin-bottom: 4px; text-transform: uppercase; font-size: 11px;">Terms & Conditions</div>
            <div style="white-space: pre-line; line-height: 1.6;">${escapeHtml(quote.terms)}</div>
          ` : ''}
        </td>
        <td style="vertical-align: bottom; width: 40%; text-align: right; font-size: 12px; color: #64748b;">
          <div style="height: 50px;"></div>
          <div style="border-top: 1px solid #cbd5e1; display: inline-block; padding-top: 6px; min-width: 180px; text-align: center;">
            <div style="font-weight: 600; color: #0f172a;">For ${escapeHtml(settings.company_name)}</div>
            <div style="color: #64748b; font-size: 11px;">Authorized Signatory</div>
          </div>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
