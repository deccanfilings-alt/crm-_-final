import type { Invoice, QuotationSettings } from '@/types';

export function renderInvoiceHtml(invoice: Invoice, settings: QuotationSettings): string {
  const items = invoice.items || [];
  const isTaxInvoice = invoice.invoice_type === 'tax_invoice';
  const isPaid = invoice.status === 'paid';
  
  const docTitle = isTaxInvoice ? 'TAX INVOICE' : 'PROFORMA INVOICE';
  
  // Effective company details
  const effectiveCompanyName = invoice.company_name || settings.company_name || 'Company';
  const effectiveCompanyLogo = invoice.company_logo_url || settings.company_logo_url;
  const effectiveCompanyAddress = invoice.company_address || settings.company_address;
  const effectiveCompanyPhone = invoice.company_phone || settings.company_phone;
  const effectiveCompanyEmail = invoice.company_email || settings.company_email;
  const effectiveGstin = invoice.gstin || settings.gstin;
  const effectivePan = invoice.pan || settings.pan;
  const effectiveStamp = invoice.stamp_url || settings.stamp_url;
  const effectiveSignature = invoice.signature_url || settings.signature_url;

  // Format Date as DD-MM-YYYY
  function formatDateDMY(dStr?: string | null): string {
    if (!dStr) return '';
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  }

  const billDate = formatDateDMY(invoice.issue_date);
  const dueDate = formatDateDMY(invoice.due_date);
  const paidDate = formatDateDMY(invoice.paid_at);
  const currencyCode = invoice.currency || 'INR';

  function formatMoney(amount: number): string {
    const val = Number(amount) || 0;
    return `${currencyCode} ${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const cgstAmount = Math.round(((invoice.tax_amount || 0) / 2 + Number.EPSILON) * 100) / 100;
  const sgstAmount = Math.round(((invoice.tax_amount || 0) - cgstAmount + Number.EPSILON) * 100) / 100;

  // UPI QR Code URL (shown if unpaid/proforma)
  const upiId = invoice.upi_id || settings.upi_id || '';
  const upiQr = invoice.upi_qr_url || settings.upi_qr_url || (upiId && !isPaid ? `https://quickchart.io/qr?text=${encodeURIComponent(`upi://pay?pa=${upiId}&pn=${effectiveCompanyName}&am=${invoice.balance_amount || invoice.total_amount}&cu=${currencyCode}`)}&size=130` : null);

  const tableRows = items.map((item, idx) => {
    const gstRateStr = invoice.tax_type === 'none' ? '0 %' : `${item.tax_rate || invoice.tax_rate || 18} %`;
    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 10px 12px; text-align: center; color: #374151; font-size: 13px;">${idx + 1}</td>
        <td style="padding: 10px 12px; color: #111827; font-size: 13px; font-weight: 500;">
          ${escapeHtml(item.title)}
        </td>
        <td style="padding: 10px 12px; color: #4b5563; font-size: 13px;">
          ${item.description ? escapeHtml(item.description) : ''}
        </td>
        <td style="padding: 10px 12px; text-align: right; color: #111827; font-size: 13px;">
          ${formatMoney(item.unit_price * item.quantity)}
        </td>
        <td style="padding: 10px 12px; text-align: center; color: #374151; font-size: 13px;">
          ${gstRateStr}
        </td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 600; color: #111827; font-size: 13px;">
          ${formatMoney(item.total)}
        </td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${docTitle} - ${escapeHtml(invoice.invoice_number)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm 15mm 20mm 15mm;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #111827;
      background: #ffffff;
      margin: 0;
      padding: 30px;
      line-height: 1.45;
    }
    @media print {
      body {
        padding: 0;
      }
      .no-print {
        display: none !important;
      }
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
  </style>
</head>
<body>
  <!-- Print Controls -->
  <div class="no-print" style="max-width: 800px; margin: 0 auto 20px auto; display: flex; justify-content: space-between; align-items: center; background: #f3f4f6; padding: 12px 18px; border-radius: 6px; border: 1px solid #d1d5db;">
    <div style="font-weight: 600; font-size: 14px; color: #1f2937;">
      ${docTitle} (${escapeHtml(invoice.invoice_number)})
    </div>
    <button onclick="window.print()" style="background: #111827; color: white; border: none; padding: 8px 18px; border-radius: 5px; font-weight: 600; font-size: 13px; cursor: pointer;">
      Print / Save PDF
    </button>
  </div>

  <div style="max-width: 800px; margin: 0 auto; background: #ffffff;">
    <!-- Top Header -->
    <table style="margin-bottom: 15px;">
      <tr>
        <td style="width: 70%; vertical-align: top;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
            <h1 style="font-size: 24px; font-weight: 700; margin: 0; color: #111827; letter-spacing: 0.05em;">
              ${docTitle}
            </h1>
            ${isPaid ? `
              <span style="border: 2px solid #059669; color: #059669; background: #ecfdf5; font-size: 12px; font-weight: 800; padding: 2px 10px; border-radius: 4px; letter-spacing: 0.1em;">
                PAID
              </span>
            ` : ''}
          </div>
          <table style="width: auto; font-size: 13px;">
            <tr>
              <td style="padding: 2px 0; font-weight: 600; color: #374151; width: 95px;">Invoice No:</td>
              <td style="padding: 2px 0; font-weight: 700; color: #111827;">${escapeHtml(invoice.invoice_number)}</td>
            </tr>
            <tr>
              <td style="padding: 2px 0; font-weight: 600; color: #374151;">Invoice Date:</td>
              <td style="padding: 2px 0; color: #111827;">${billDate}</td>
            </tr>
            ${dueDate ? `
            <tr>
              <td style="padding: 2px 0; font-weight: 600; color: #374151;">Due Date:</td>
              <td style="padding: 2px 0; color: #111827;">${dueDate}</td>
            </tr>
            ` : ''}
          </table>
        </td>
        <td style="width: 30%; vertical-align: top; text-align: right;">
          ${effectiveCompanyLogo ? `
            <img src="${escapeHtml(effectiveCompanyLogo)}" alt="Logo" style="max-height: 52px; object-fit: contain;" />
          ` : `
            <div style="font-weight: 800; font-size: 15px; color: #111827; line-height: 1.2;">
              ${escapeHtml(effectiveCompanyName)}
            </div>
            <div style="font-size: 9px; color: #6b7280; text-transform: uppercase; margin-top: 2px;">
              One Stop For All Business Solutions
            </div>
          `}
        </td>
      </tr>
    </table>

    <!-- Black divider line -->
    <div style="border-top: 2px solid #000000; margin-bottom: 16px;"></div>

    <!-- ISSUED BY & BILLED TO Columns -->
    <table style="margin-bottom: 24px;">
      <tr>
        <!-- ISSUED BY -->
        <td style="width: 50%; vertical-align: top; padding-right: 25px;">
          <div style="font-weight: 700; font-size: 13px; text-transform: uppercase; color: #000000; border-bottom: 2px solid #000000; padding-bottom: 3px; margin-bottom: 8px;">
            ISSUED BY
          </div>
          <table style="font-size: 12px; line-height: 1.5;">
            <tr>
              <td style="font-weight: 700; color: #111827; width: 85px; vertical-align: top;">Billed From:</td>
              <td style="font-weight: 600; color: #111827; vertical-align: top;">${escapeHtml(effectiveCompanyName)}</td>
            </tr>
            ${effectiveCompanyAddress ? `
            <tr>
              <td style="font-weight: 700; color: #374151; vertical-align: top;">Address:</td>
              <td style="color: #374151; vertical-align: top;">${escapeHtml(effectiveCompanyAddress)}</td>
            </tr>
            ` : ''}
            ${effectiveCompanyPhone ? `
            <tr>
              <td style="font-weight: 700; color: #374151;">Phone :</td>
              <td style="color: #374151;">${escapeHtml(effectiveCompanyPhone)}</td>
            </tr>
            ` : ''}
            ${effectiveCompanyEmail ? `
            <tr>
              <td style="font-weight: 700; color: #374151;">Email Id :</td>
              <td style="color: #374151;">${escapeHtml(effectiveCompanyEmail)}</td>
            </tr>
            ` : ''}
            ${effectiveGstin ? `
            <tr>
              <td style="font-weight: 700; color: #111827;">GST IN :</td>
              <td style="font-weight: 600; color: #111827;">${escapeHtml(effectiveGstin)}</td>
            </tr>
            ` : ''}
            ${effectivePan ? `
            <tr>
              <td style="font-weight: 700; color: #111827;">PAN :</td>
              <td style="font-weight: 600; color: #111827;">${escapeHtml(effectivePan)}</td>
            </tr>
            ` : ''}
          </table>
        </td>

        <!-- BILLED TO -->
        <td style="width: 50%; vertical-align: top; padding-left: 25px;">
          <div style="font-weight: 700; font-size: 13px; text-transform: uppercase; color: #000000; border-bottom: 2px solid #000000; padding-bottom: 3px; margin-bottom: 8px;">
            BILLED TO
          </div>
          <table style="font-size: 12px; line-height: 1.5;">
            <tr>
              <td style="font-weight: 700; color: #111827; width: 75px; vertical-align: top;">Billed To :</td>
              <td style="font-weight: 600; color: #111827; vertical-align: top;">
                ${escapeHtml(invoice.client_company || invoice.client_name)}
              </td>
            </tr>
            ${invoice.client_phone ? `
            <tr>
              <td style="font-weight: 700; color: #374151;">Phone:</td>
              <td style="color: #374151;">${escapeHtml(invoice.client_phone)}</td>
            </tr>
            ` : ''}
            ${invoice.client_address ? `
            <tr>
              <td style="font-weight: 700; color: #374151; vertical-align: top;">Address:</td>
              <td style="color: #374151; vertical-align: top;">${escapeHtml(invoice.client_address)}</td>
            </tr>
            ` : ''}
            ${invoice.client_gstin ? `
            <tr>
              <td style="font-weight: 700; color: #111827;">GST IN :</td>
              <td style="font-weight: 600; color: #111827;">${escapeHtml(invoice.client_gstin)}</td>
            </tr>
            ` : ''}
          </table>
        </td>
      </tr>
    </table>

    <!-- Line Items Table -->
    <table style="margin-bottom: 24px; border: 1px solid #d1d5db;">
      <thead>
        <tr style="background: #000000; color: #ffffff;">
          <th style="padding: 8px 10px; font-size: 12px; font-weight: 700; text-align: center; width: 6%; border-right: 1px solid #374151;">Sr. No.</th>
          <th style="padding: 8px 12px; font-size: 12px; font-weight: 700; text-align: left; width: 28%; border-right: 1px solid #374151;">Particulars</th>
          <th style="padding: 8px 12px; font-size: 12px; font-weight: 700; text-align: left; width: 22%; border-right: 1px solid #374151;">Description</th>
          <th style="padding: 8px 12px; font-size: 12px; font-weight: 700; text-align: right; width: 16%; border-right: 1px solid #374151;">Amount ( ${currencyCode} )</th>
          <th style="padding: 8px 10px; font-size: 12px; font-weight: 700; text-align: center; width: 12%; border-right: 1px solid #374151;">GST Rate</th>
          <th style="padding: 8px 12px; font-size: 12px; font-weight: 700; text-align: right; width: 16%;">Total ( ${currencyCode} )</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>

    <!-- Bottom Section: Payment Info / Receipt on Left & Totals on Right -->
    <table style="margin-bottom: 35px;">
      <tr>
        <!-- Left Column: Payment Details or Receipt Details -->
        <td style="width: 58%; vertical-align: top; padding-right: 20px;">
          ${isPaid ? `
            <!-- Payment Receipt Box -->
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 14px 16px;">
              <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #a7f3d0; padding-bottom: 6px; margin-bottom: 10px;">
                <span style="font-weight: 700; font-size: 12px; color: #065f46; text-transform: uppercase;">
                  Payment Receipt Acknowledgement
                </span>
                <span style="font-weight: 800; font-size: 11px; background: #059669; color: white; padding: 2px 8px; border-radius: 3px;">
                  100% PAID
                </span>
              </div>
              <table style="font-size: 12px; line-height: 1.7; width: 100%;">
                ${invoice.payment_reference ? `
                <tr>
                  <td style="color: #047857; font-weight: 600; width: 120px;">UTR / Ref ID :</td>
                  <td style="color: #064e3b; font-weight: 700; font-family: monospace;">${escapeHtml(invoice.payment_reference)}</td>
                </tr>
                ` : ''}
                ${invoice.payment_method ? `
                <tr>
                  <td style="color: #047857; font-weight: 600;">Payment Mode :</td>
                  <td style="color: #064e3b; font-weight: 600; text-transform: uppercase;">${escapeHtml(invoice.payment_method.replace('_', ' '))}</td>
                </tr>
                ` : ''}
                ${paidDate ? `
                <tr>
                  <td style="color: #047857; font-weight: 600;">Date of Payment :</td>
                  <td style="color: #064e3b;">${paidDate}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="color: #047857; font-weight: 600;">Amount Received :</td>
                  <td style="color: #064e3b; font-weight: 700;">${formatMoney(invoice.paid_amount || invoice.total_amount)}</td>
                </tr>
                <tr>
                  <td style="color: #047857; font-weight: 600;">Balance Due :</td>
                  <td style="color: #064e3b; font-weight: 800;">${currencyCode} 0.00</td>
                </tr>
              </table>
            </div>
          ` : `
            <!-- Bank & QR Code for Pre-Payment -->
            <table style="width: 100%;">
              <tr>
                ${upiQr ? `
                  <td style="width: 125px; vertical-align: top; padding-right: 14px;">
                    <img src="${escapeHtml(upiQr)}" alt="UPI QR" style="width: 115px; height: 115px; border: 1px solid #e5e7eb; border-radius: 4px; display: block;" />
                    ${upiId ? `
                      <div style="font-size: 8.5px; color: #4b5563; word-break: break-all; margin-top: 4px; text-align: center; max-width: 115px; font-family: monospace;">
                        ${escapeHtml(upiId)}
                      </div>
                    ` : ''}
                  </td>
                ` : ''}
                <td style="vertical-align: top; font-size: 12px; line-height: 1.6;">
                  <div><strong>Name :</strong> ${escapeHtml(invoice.bank_beneficiary_name || settings.bank_beneficiary_name || effectiveCompanyName)}</div>
                  ${(invoice.bank_name || settings.bank_name) ? `<div><strong>Bank Name :</strong> ${escapeHtml(invoice.bank_name || settings.bank_name)},</div>` : ''}
                  ${(invoice.bank_account_no || settings.bank_account_no) ? `<div><strong>Bank Account No :</strong> ${escapeHtml(invoice.bank_account_no || settings.bank_account_no)}</div>` : ''}
                  ${(invoice.bank_ifsc || settings.bank_ifsc) ? `<div><strong>Bank/IFSC Code :</strong> ${escapeHtml(invoice.bank_ifsc || settings.bank_ifsc)}</div>` : ''}
                </td>
              </tr>
            </table>
          `}
        </td>

        <!-- Right: Totals Box -->
        <td style="width: 42%; vertical-align: top;">
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px 16px;">
            <table style="font-size: 12px; line-height: 1.8;">
              <tr>
                <td style="color: #374151; font-weight: 500;">Sub-Total :</td>
                <td style="text-align: right; font-weight: 500; color: #111827;">${formatMoney(invoice.subtotal)}</td>
              </tr>
              ${invoice.tax_amount > 0 ? `
                <tr>
                  <td style="color: #374151;">CGST :</td>
                  <td style="text-align: right; color: #111827;">${formatMoney(cgstAmount)}</td>
                </tr>
                <tr>
                  <td style="color: #374151;">SGST :</td>
                  <td style="text-align: right; color: #111827;">${formatMoney(sgstAmount)}</td>
                </tr>
              ` : ''}
              <tr>
                <td style="color: #374151;">Discount :</td>
                <td style="text-align: right; color: #111827;">${formatMoney(invoice.discount_amount || 0)}</td>
              </tr>
              <tr style="border-top: 1px solid #d1d5db;">
                <td style="font-size: 13px; font-weight: 700; color: #111827; padding-top: 6px;">Grand Total :</td>
                <td style="text-align: right; font-size: 14px; font-weight: 800; color: #000000; padding-top: 6px;">${formatMoney(invoice.total_amount)}</td>
              </tr>
              ${isPaid ? `
                <tr style="border-top: 1px dashed #d1d5db;">
                  <td style="font-size: 12px; font-weight: 600; color: #059669; padding-top: 4px;">Paid Amount :</td>
                  <td style="text-align: right; font-size: 13px; font-weight: 700; color: #059669; padding-top: 4px;">${formatMoney(invoice.paid_amount || invoice.total_amount)}</td>
                </tr>
                <tr>
                  <td style="font-size: 12px; font-weight: 600; color: #374151;">Balance Due :</td>
                  <td style="text-align: right; font-size: 13px; font-weight: 700; color: #111827;">${currencyCode} 0.00</td>
                </tr>
              ` : ''}
            </table>
          </div>
        </td>
      </tr>
    </table>

    <!-- Statutory Declaration / Terms -->
    <div style="font-size: 11px; color: #4b5563; border-top: 1px solid #e5e7eb; padding-top: 10px; margin-bottom: 25px; line-height: 1.5;">
      ${isTaxInvoice ? `
        <strong>Declaration:</strong> Certified that the particulars given above are true and correct and the amount indicated represents the price actually charged. This is an authentic Tax Invoice for Input Tax Credit (ITC) claiming.
      ` : `
        <strong>Terms:</strong> This Proforma Invoice is issued for advance payment processing. Official Tax Invoice with payment receipt will be issued upon payment confirmation.
      `}
    </div>

    <!-- Authorized Signature Section (Bottom Right) -->
    <div style="display: flex; justify-content: flex-end; margin-top: 20px; page-break-inside: avoid;">
      <div style="text-align: center; min-width: 220px;">
        <div style="font-size: 12px; font-weight: 700; color: #111827; text-transform: uppercase;">
          ${escapeHtml(effectiveCompanyName)}
        </div>
        
        <!-- Stamp & Signature Container -->
        <div style="min-height: 65px; margin: 8px 0; display: flex; align-items: center; justify-content: center; gap: 14px; position: relative;">
          ${effectiveStamp ? `
            <img src="${escapeHtml(effectiveStamp)}" alt="Official Seal" style="max-height: 60px; max-width: 85px; object-fit: contain;" />
          ` : `
            <div style="width: 50px; height: 50px; border: 2px dashed #9ca3af; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 8px; color: #9ca3af; text-transform: uppercase;">
              SEAL
            </div>
          `}
          ${effectiveSignature ? `
            <img src="${escapeHtml(effectiveSignature)}" alt="Authorized Signature" style="max-height: 50px; max-width: 140px; object-fit: contain;" />
          ` : `
            <div style="font-family: 'Brush Script MT', cursive, sans-serif; font-size: 24px; color: #1f2937; transform: rotate(-5deg);">
              Authorized
            </div>
          `}
        </div>

        <div style="border-top: 1px solid #9ca3af; padding-top: 4px; font-size: 12px; color: #374151;">
          Authorized Signature
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str?: string | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
