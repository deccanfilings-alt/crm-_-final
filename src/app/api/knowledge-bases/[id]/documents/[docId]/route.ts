import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id: kb_id, docId } = await params

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )

  // Verify this document belongs to the KB (and RLS will check account access)
  const { data: doc, error: fetchError } = await supabase
    .from('knowledge_base_documents')
    .select('id')
    .eq('id', docId)
    .eq('kb_id', kb_id)
    .single()

  if (fetchError || !doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Embeddings cascade-delete automatically (ON DELETE CASCADE)
  const { error } = await supabase
    .from('knowledge_base_documents')
    .delete()
    .eq('id', docId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
