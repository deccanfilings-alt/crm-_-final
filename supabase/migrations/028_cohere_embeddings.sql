-- Migration 028: Add Cohere as AI provider + fix embedding dimensions for Cohere

-- 1. Allow 'cohere' as a valid provider
ALTER TABLE ai_providers DROP CONSTRAINT IF EXISTS ai_providers_provider_check;
ALTER TABLE ai_providers ADD CONSTRAINT ai_providers_provider_check
  CHECK (provider IN ('openai', 'openrouter', 'sarvam', 'cohere'));

-- 2. Drop old vector column and recreate as vector(1024) for Cohere compatibility
--    (OpenAI embeddings were 1536 — if you want to go back to OpenAI later,
--     re-run with vector(1536) and re-upload your documents.)
ALTER TABLE public.knowledge_base_embeddings
  DROP COLUMN IF EXISTS embedding;

ALTER TABLE public.knowledge_base_embeddings
  ADD COLUMN embedding vector(1024) NOT NULL;

-- 3. Drop old ivfflat index and recreate for the new dimension
DROP INDEX IF EXISTS idx_kb_embedding_vector;
CREATE INDEX idx_kb_embedding_vector
  ON public.knowledge_base_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 4. Update the match_knowledge RPC for 1024 dimensions
CREATE OR REPLACE FUNCTION public.match_knowledge (
  query_embedding vector(1024),
  target_kb_id uuid,
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  content text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.id,
    e.content,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_base_embeddings e
  JOIN public.knowledge_base_documents d ON e.doc_id = d.id
  WHERE d.kb_id = target_kb_id
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;
