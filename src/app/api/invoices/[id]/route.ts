import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { calculateQuotationTotals } from '@/lib/quotations/calculations';

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

    const { data: updated, error } = await supabase
      .from('invoices')
      .update(updatePayload)
      .eq('id', id)
      .select('*, items:invoice_items(*)')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ invoice: updated });
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
