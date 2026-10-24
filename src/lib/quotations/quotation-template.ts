import type { Quotation, QuotationSettings } from '@/types';

export function renderQuotationHtml(quote: Quotation, settings: QuotationSettings): string {
  const items = quote.items || [];
  
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

  const billDate = formatDateDMY(quote.issue_date);
  const currencyCode = quote.currency || 'INR';

  function formatMoney(amount: number): string {
    const val = Number(amount) || 0;
    return `${currencyCode} ${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const cgstAmount = Math.round(((quote.tax_amount || 0) / 2 + Number.EPSILON) * 100) / 100;
  const sgstAmount = Math.round(((quote.tax_amount || 0) - cgstAmount + Number.EPSILON) * 100) / 100;

  // UPI QR Code URL
  const upiId = settings.upi_id || '';
  const upiQr = settings.upi_qr_url || (upiId ? `https://quickchart.io/qr?text=${encodeURIComponent(`upi://pay?pa=${upiId}&pn=${settings.company_name}&am=${quote.total_amount}&cu=${currencyCode}`)}&size=130` : null);

  const tableRows = items.map((item, idx) => {
    const gstRateStr = quote.tax_type === 'none' ? '0 %' : `${item.tax_rate || quote.tax_rate || 18} %`;
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
  <title>QUOTATION - ${escapeHtml(quote.quote_number)}</title>
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
      WebLedger Standard Quotation (${escapeHtml(quote.quote_number)})
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
          <h1 style="font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0; color: #111827; letter-spacing: 0.05em;">
            QUOTATION
          </h1>
          <table style="width: auto; font-size: 13px;">
            <tr>
              <td style="padding: 2px 0; font-weight: 600; color: #374151; width: 75px;">Bill No:</td>
              <td style="padding: 2px 0; font-weight: 700; color: #111827;">${escapeHtml(quote.quote_number)}</td>
            </tr>
            <tr>
              <td style="padding: 2px 0; font-weight: 600; color: #374151;">Bill Date:</td>
              <td style="padding: 2px 0; color: #111827;">${billDate}</td>
            </tr>
          </table>
        </td>
        <td style="width: 30%; vertical-align: top; text-align: right;">
          ${settings.company_logo_url ? `
            <img src="${escapeHtml(settings.company_logo_url)}" alt="Logo" style="max-height: 52px; object-fit: contain;" />
          ` : `
            <div style="font-weight: 800; font-size: 15px; color: #111827; line-height: 1.2;">
              ${escapeHtml(settings.company_name)}
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
              <td style="font-weight: 600; color: #111827; vertical-align: top;">${escapeHtml(settings.company_name)}</td>
            </tr>
            ${settings.company_address ? `
            <tr>
              <td style="font-weight: 700; color: #374151; vertical-align: top;">Address:</td>
              <td style="color: #374151; vertical-align: top;">${escapeHtml(settings.company_address)}</td>
            </tr>
            ` : ''}
            ${settings.company_phone ? `
            <tr>
              <td style="font-weight: 700; color: #374151;">Phone :</td>
              <td style="color: #374151;">${escapeHtml(settings.company_phone)}</td>
            </tr>
            ` : ''}
            ${settings.company_email ? `
            <tr>
              <td style="font-weight: 700; color: #374151;">Email Id :</td>
              <td style="color: #374151;">${escapeHtml(settings.company_email)}</td>
            </tr>
            ` : ''}
            ${settings.gstin ? `
            <tr>
              <td style="font-weight: 700; color: #111827;">GST IN :</td>
              <td style="font-weight: 600; color: #111827;">${escapeHtml(settings.gstin)}</td>
            </tr>
            ` : ''}
            ${settings.pan ? `
            <tr>
              <td style="font-weight: 700; color: #111827;">PAN :</td>
              <td style="font-weight: 600; color: #111827;">${escapeHtml(settings.pan)}</td>
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
                ${escapeHtml(quote.client_company || quote.client_name)}
              </td>
            </tr>
            ${quote.client_phone ? `
            <tr>
              <td style="font-weight: 700; color: #374151;">Phone:</td>
              <td style="color: #374151;">${escapeHtml(quote.client_phone)}</td>
            </tr>
            ` : ''}
            ${quote.client_address ? `
            <tr>
              <td style="font-weight: 700; color: #374151; vertical-align: top;">Address:</td>
              <td style="color: #374151; vertical-align: top;">${escapeHtml(quote.client_address)}</td>
            </tr>
            ` : ''}
            ${quote.client_gstin ? `
            <tr>
              <td style="font-weight: 700; color: #111827;">GST IN :</td>
              <td style="font-weight: 600; color: #111827;">${escapeHtml(quote.client_gstin)}</td>
            </tr>
            ` : ''}
          </table>
        </td>
      </tr>
    </table>

    <!-- Line Items Table (WebLedger Black Header) -->
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

    <!-- Bottom Section: Payment Info on Left & Totals Summary on Right -->
    <table style="margin-bottom: 50px;">
      <tr>
        <!-- Left: Bank Details & QR Code -->
        <td style="width: 58%; vertical-align: top; padding-right: 20px;">
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
                <div><strong>Name :</strong> ${escapeHtml(settings.bank_beneficiary_name || settings.company_name)}</div>
                ${settings.bank_name ? `<div><strong>Bank Name :</strong> ${escapeHtml(settings.bank_name)},</div>` : ''}
                ${settings.bank_account_no ? `<div><strong>Bank Account No :</strong> ${escapeHtml(settings.bank_account_no)}</div>` : ''}
                ${settings.bank_ifsc ? `<div><strong>Bank/IFSC Code :</strong> ${escapeHtml(settings.bank_ifsc)}</div>` : ''}
              </td>
            </tr>
          </table>
        </td>

        <!-- Right: Totals Box -->
        <td style="width: 42%; vertical-align: top;">
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px 16px;">
            <table style="font-size: 12px; line-height: 1.8;">
              <tr>
                <td style="color: #374151; font-weight: 500;">Sub-Total :</td>
                <td style="text-align: right; font-weight: 500; color: #111827;">${formatMoney(quote.subtotal)}</td>
              </tr>
              ${quote.tax_amount > 0 ? `
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
                <td style="text-align: right; color: #111827;">${formatMoney(quote.discount_amount || 0)}</td>
              </tr>
              <tr>
                <td style="color: #374151;">Round Off :</td>
                <td style="text-align: right; color: #111827;">${currencyCode} 0.00</td>
              </tr>
              <tr style="border-top: 1px solid #d1d5db;">
                <td style="font-size: 13px; font-weight: 700; color: #111827; padding-top: 6px;">Grand Total :</td>
                <td style="text-align: right; font-size: 14px; font-weight: 800; color: #000000; padding-top: 6px;">${formatMoney(quote.total_amount)}</td>
              </tr>
            </table>
          </div>
        </td>
      </tr>
    </table>

    <!-- Authorized Signature Section (Bottom Right) -->
    <div style="display: flex; justify-content: flex-end; margin-top: 40px; page-break-inside: avoid;">
      <div style="text-align: center; min-width: 200px;">
        <div style="font-size: 12px; font-weight: 700; color: #111827; text-transform: uppercase;">
          ${escapeHtml(settings.company_name)}
        </div>
        
        <!-- Stamp & Signature Placeholders -->
        <div style="height: 60px; margin: 8px 0; display: flex; align-items: center; justify-content: center; position: relative;">
          <!-- Circular seal/stamp placeholder -->
          <div style="width: 50px; height: 50px; border: 2px dashed #9ca3af; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 8px; color: #9ca3af; text-transform: uppercase; margin-right: 15px;">
            SEAL
          </div>
          <!-- Signature cursive placeholder -->
          <div style="font-family: 'Brush Script MT', cursive, sans-serif; font-size: 24px; color: #1f2937; transform: rotate(-5deg);">
            Authorized
          </div>
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
