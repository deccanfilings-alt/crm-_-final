import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { calculateQuotationTotals } from '@/lib/quotations/calculations';
import { invoiceStatusFor, isCommercialChange, recordRevision, round2, shouldBumpRevision } from '@/lib/billing/revisions';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*, items:invoice_items(*)')
      .eq('id', id)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (Array.isArray(invoice.items)) {
      invoice.items.sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
    }

    return NextResponse.json({ invoice });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Profile not linked to an account' }, { status: 403 });
    }
    if (profile.account_role === 'viewer') {
      return NextResponse.json({ error: 'Your role is read-only' }, { status: 403 });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from('invoices')
      .select('*, items:invoice_items(*)')
      .eq('id', id)
      .eq('account_id', profile.account_id)
      .single();
    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const updatePayload: any = {
      updated_at: new Date().toISOString(),
    };

    const allowed = [
      'title', 'status', 'issue_date', 'due_date', 'notes', 'terms', 'custom_message',
      'client_name', 'client_phone', 'client_email', 'client_company', 'client_address', 'client_gstin',
      'company_name', 'company_logo_url', 'company_address', 'company_phone', 'company_email',
      'company_website', 'gstin', 'pan', 'signature_url', 'stamp_url',
      'payment_method', 'payment_reference', 'payment_notes', 'paid_amount', 'balance_amount', 'paid_at'
    ];

    for (const key of allowed) {
      if (body[key] !== undefined) {
        updatePayload[key] = body[key];
      }
    }

    // Editing line items / discount / tax (client asked for changes):
    // recalculate totals, then keep the balance and payment status
    // consistent with what has already been paid.
    const { items, discount_type, discount_value, tax_type, tax_rate, revision_reason } = body;
    const commercial = isCommercialChange(existing, { items, discount_type, discount_value, tax_type, tax_rate });

    if (Array.isArray(items)) {
      if (items.length === 0) {
        return NextResponse.json({ error: 'An invoice needs at least one line item' }, { status: 400 });
      }
      if (items.some((it: any) => !String(it?.title ?? '').trim())) {
        return NextResponse.json({ error: 'Every line item needs a title' }, { status: 400 });
      }

      const totals = calculateQuotationTotals({
        items,
        discountType: discount_type !== undefined ? discount_type : existing.discount_type,
        discountValue: discount_value !== undefined ? discount_value : existing.discount_value,
        taxType: tax_type !== undefined ? tax_type : existing.tax_type,
        taxRate: tax_rate !== undefined ? tax_rate : existing.tax_rate,
      });

      const paid = Number(existing.paid_amount || 0);
      if (paid > totals.totalAmount + 0.005) {
        return NextResponse.json(
          {
            error: `The new total (₹${totals.totalAmount.toFixed(2)}) is less than the ₹${paid.toFixed(2)} already paid. Refund or adjust the payment first.`,
          },
          { status: 400 },
        );
      }

      updatePayload.subtotal = totals.subtotal;
      updatePayload.discount_amount = totals.discountAmount;
      updatePayload.tax_amount = totals.taxAmount;
      updatePayload.total_amount = totals.totalAmount;
      if (discount_type !== undefined) updatePayload.discount_type = discount_type;
      if (discount_value !== undefined) updatePayload.discount_value = discount_value;
      if (tax_type !== undefined) updatePayload.tax_type = tax_type;
      if (tax_rate !== undefined) updatePayload.tax_rate = tax_rate;
      updatePayload.balance_amount = round2(Math.max(0, totals.totalAmount - paid));
      updatePayload.status = invoiceStatusFor(
        body.status ?? existing.status,
        totals.totalAmount,
        paid,
      );

      const { error: delErr } = await supabase.from('invoice_items').delete().eq('invoice_id', id);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
      const itemRows = items.map((it: any, idx: number) => ({
        invoice_id: id,
        position: idx,
        title: String(it.title).trim(),
        description: it.description?.trim() || null,
        quantity: Math.max(0, Number(it.quantity) || 1),
        unit_price: Math.max(0, Number(it.unit_price) || 0),
        tax_rate: it.tax_rate !== undefined ? it.tax_rate : 0,
        total: totals.itemTotals[idx] || 0,
      }));
      const { error: insErr } = await supabase.from('invoice_items').insert(itemRows);
      if (insErr) {
        // Put the old items back so the invoice is never left empty.
        await supabase.from('invoice_items').insert(
          (existing.items || []).map(({ id: _id, created_at: _c, ...rest }: any) => rest),
        );
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    const { data: updated, error } = await supabase
      .from('invoices')
      .update(updatePayload)
      .eq('id', id)
      .eq('account_id', profile.account_id)
      .select('*, items:invoice_items(*)')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Record a revision when the content of an issued invoice changes
    // (payment-only updates such as recording a payment don't count).
    const contentKeys = Object.keys(body).filter(
      (k) => !['status', 'payment_method', 'payment_reference', 'payment_notes', 'paid_amount', 'balance_amount', 'paid_at', 'revision_reason'].includes(k),
    );
    let revision: number | null = null;
    if (contentKeys.length > 0 && shouldBumpRevision(existing.status, existing.sent_at)) {
      revision = await recordRevision(supabase, {
        table: 'invoices',
        documentType: existing.invoice_type === 'tax_invoice' ? 'tax_invoice' : 'proforma',
        before: existing,
        userId: user.id,
        reason: typeof revision_reason === 'string' ? revision_reason : null,
      });
      if (revision !== null && updated) updated.revision = revision;
    }

    return NextResponse.json({ invoice: updated, revision, amounts_changed: commercial });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
