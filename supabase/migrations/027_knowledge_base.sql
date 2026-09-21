-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Create knowledge_bases table
create table public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Create documents table (to track uploaded files)
create table public.knowledge_base_documents (
  id uuid primary key default gen_random_uuid(),
  kb_id uuid not null references public.knowledge_bases(id) on delete cascade,
  filename text not null,
  content text not null,
  created_at timestamptz not null default now()
);

-- 4. Create embeddings table for the document chunks
create table public.knowledge_base_embeddings (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.knowledge_base_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

-- Indexes for performance
create index idx_kb_account on public.knowledge_bases(account_id);
create index idx_kb_doc on public.knowledge_base_documents(kb_id);
create index idx_kb_embedding on public.knowledge_base_embeddings(doc_id);
create index idx_kb_embedding_vector on public.knowledge_base_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Enable RLS
alter table public.knowledge_bases enable row level security;
alter table public.knowledge_base_documents enable row level security;
alter table public.knowledge_base_embeddings enable row level security;

-- Policies for knowledge_bases
create policy "kb_select" on public.knowledge_bases
  for select using (is_account_member(account_id));

create policy "kb_insert" on public.knowledge_bases
  for insert with check (is_account_member(account_id, 'agent'));

create policy "kb_update" on public.knowledge_bases
  for update using (is_account_member(account_id, 'agent'));

create policy "kb_delete" on public.knowledge_bases
  for delete using (is_account_member(account_id, 'admin'));

-- Policies for documents (inherits access via KB)
create policy "kb_doc_select" on public.knowledge_base_documents
  for select using (
    kb_id in (select id from public.knowledge_bases where is_account_member(account_id))
  );

create policy "kb_doc_insert" on public.knowledge_base_documents
  for insert with check (
    kb_id in (select id from public.knowledge_bases where is_account_member(account_id, 'agent'))
  );

create policy "kb_doc_delete" on public.knowledge_base_documents
  for delete using (
    kb_id in (select id from public.knowledge_bases where is_account_member(account_id, 'agent'))
  );

-- Policies for embeddings (inherits access via Document -> KB)
create policy "kb_embedding_select" on public.knowledge_base_embeddings
  for select using (
    doc_id in (
      select d.id from public.knowledge_base_documents d
      join public.knowledge_bases kb on kb.id = d.kb_id
      where is_account_member(kb.account_id)
    )
  );

create policy "kb_embedding_insert" on public.knowledge_base_embeddings
  for insert with check (
    doc_id in (
      select d.id from public.knowledge_base_documents d
      join public.knowledge_bases kb on kb.id = d.kb_id
      where is_account_member(kb.account_id, 'agent')
    )
  );

-- 5. Create RPC function for vector similarity search
create or replace function public.match_knowledge (
  query_embedding vector(1536),
  target_kb_id uuid,
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    e.id,
    e.content,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.knowledge_base_embeddings e
  join public.knowledge_base_documents d on e.doc_id = d.id
  where d.kb_id = target_kb_id
    and 1 - (e.embedding <=> query_embedding) > match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
