import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import OpenAI from 'openai'
import { CohereClient } from 'cohere-ai'

import mammoth from 'mammoth'

// Simple text chunking function
function chunkText(text: string, maxTokens: number = 500): string[] {
  // A rough approximation: 1 token ~ 4 characters
  const chunkSize = maxTokens * 4
  const chunks: string[] = []
  
  // Basic split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/)
  
  let currentChunk = ""
  for (const p of paragraphs) {
    if (currentChunk.length + p.length > chunkSize) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim())
      }
      currentChunk = p
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + p
    }
  }
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim())
  }
  
  return chunks
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  
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

  const { data, error } = await supabase
    .from('knowledge_base_documents')
    .select('id, filename, created_at')
    .eq('kb_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: kb_id } = await params
  
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

  // 1. Get the account_id for this KB
  const { data: kb, error: kbError } = await supabase
    .from('knowledge_bases')
    .select('account_id')
    .eq('id', kb_id)
    .single()
    
  if (kbError || !kb) {
    return NextResponse.json({ error: 'Knowledge Base not found' }, { status: 404 })
  }
  
  // 2. Fetch the best available embedding provider key
  // Priority: Cohere → OpenAI → OpenRouter
  type EmbedProvider = 
    | { type: 'cohere'; apiKey: string }
    | { type: 'openai'; apiKey: string; baseURL?: string }

  let embedProvider: EmbedProvider | null = null

  // Try Cohere first
  const { data: cohereKey } = await supabase
    .from('ai_providers')
    .select('api_key')
    .eq('account_id', kb.account_id)
    .eq('provider', 'cohere')
    .single()
  if (cohereKey?.api_key) {
    embedProvider = { type: 'cohere', apiKey: cohereKey.api_key }
  }

  // Fall back to OpenAI
  if (!embedProvider) {
    const { data: openaiKey } = await supabase
      .from('ai_providers')
      .select('api_key')
      .eq('account_id', kb.account_id)
      .eq('provider', 'openai')
      .single()
    if (openaiKey?.api_key) {
      embedProvider = { type: 'openai', apiKey: openaiKey.api_key }
    }
  }

  // Fall back to OpenRouter (OpenAI-compatible)
  if (!embedProvider) {
    const { data: orKey } = await supabase
      .from('ai_providers')
      .select('api_key')
      .eq('account_id', kb.account_id)
      .eq('provider', 'openrouter')
      .single()
    if (orKey?.api_key) {
      embedProvider = { type: 'openai', apiKey: orKey.api_key, baseURL: 'https://openrouter.ai/api/v1' }
    }
  }

  if (!embedProvider) {
    return NextResponse.json({
      error: 'Please configure a Cohere, OpenAI, or OpenRouter API key in Settings → AI Providers.'
    }, { status: 400 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File
  if (!file) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }
  
  let textContent = ""
  
  try {
    if (file.name.toLowerCase().endsWith('.pdf')) {
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      if (typeof global.DOMMatrix === 'undefined') {
        (global as any).DOMMatrix = class DOMMatrix {};
      }
      const pdfParse = require('pdf-parse')
      const data = await pdfParse(buffer)
      textContent = data.text
    } else if (file.name.toLowerCase().endsWith('.docx')) {
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const result = await mammoth.extractRawText({ buffer })
      textContent = result.value
    } else {
      textContent = await file.text()
    }
  } catch (parseErr: any) {
    console.error("Parse error:", parseErr);
    return NextResponse.json({ error: "Failed to parse document: " + parseErr.message }, { status: 400 })
  }
  
  if (!textContent.trim()) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  }
  
  // 3. Insert document record
  const { data: doc, error: docError } = await supabase
    .from('knowledge_base_documents')
    .insert({
      kb_id,
      filename: file.name,
      content: textContent,
    })
    .select()
    .single()
    
  if (docError || !doc) {
    return NextResponse.json({ error: docError?.message || 'Failed to insert document' }, { status: 500 })
  }

  // 4. Chunk text and create embeddings (optional — doc is always saved even if this fails)
  let embeddingWarning: string | null = null
  const chunks = chunkText(textContent)
  const embeddingsToInsert: any[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    try {
      let vector: number[]

      if (embedProvider.type === 'cohere') {
        // Cohere embed-english-v3.0 → 1024 dimensions
        const cohere = new CohereClient({ token: embedProvider.apiKey })
        const embedResponse = await cohere.v2.embed({
          texts: [chunk],
          model: 'embed-english-v3.0',
          inputType: 'search_document',
          embeddingTypes: ['float'],
        })
        const floats = embedResponse.embeddings?.float
        if (!floats || floats.length === 0) throw new Error('Empty embedding from Cohere')
        vector = floats[0]
      } else {
        // OpenAI / OpenRouter → 1024 or 1536 dimensions
        const openai = new OpenAI({ apiKey: embedProvider.apiKey, baseURL: embedProvider.baseURL })
        const embedResponse = await openai.embeddings.create({
          input: chunk,
          model: 'text-embedding-3-small',
          dimensions: 1024, // request 1024 to match DB column size
        })
        vector = embedResponse.data[0].embedding
      }

      embeddingsToInsert.push({
        doc_id: doc.id,
        chunk_index: i,
        content: chunk,
        embedding: vector,
      })
    } catch (err: any) {
      console.error(`Embedding error on chunk ${i}:`, err?.message)
      embeddingWarning = err?.message || 'Embedding generation failed'
      break
    }
  }

  if (embeddingsToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('knowledge_base_embeddings')
      .insert(embeddingsToInsert)
    if (insertError) {
      console.error('Insert embedding error:', insertError)
      embeddingWarning = insertError.message
    }
  } else if (!embeddingWarning) {
    embeddingWarning = 'No chunks could be embedded'
  }

  // Return the doc (always succeeds), plus an optional warning if embeddings failed
  return NextResponse.json({
    ...doc,
    embedding_warning: embeddingWarning ?? undefined,
  })
}
