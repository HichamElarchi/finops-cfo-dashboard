-- Semantic cache: store Q/A embeddings per workspace for 30 days.
-- Run in the Supabase SQL editor after members.sql.

create extension if not exists vector;

create table if not exists public.semantic_cache (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  question text not null,
  question_norm text not null,
  answer text not null,
  embedding vector(1536),
  requested_model text,
  served_model text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists semantic_cache_workspace_norm_idx
  on public.semantic_cache (workspace_id, question_norm);

create index if not exists semantic_cache_expires_idx
  on public.semantic_cache (expires_at);

do $$
begin
  create index if not exists semantic_cache_embedding_idx
    on public.semantic_cache
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 10);
exception
  when others then
    raise notice 'semantic_cache embedding index skipped: %', sqlerrm;
end
$$;

alter table public.semantic_cache enable row level security;

drop policy if exists "semantic cache cfo read" on public.semantic_cache;
create policy "semantic cache cfo read" on public.semantic_cache
  for select using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role = 'cfo'
    )
  );

create or replace function public.match_semantic_cache(
  p_workspace_id uuid,
  p_embedding vector(1536),
  p_threshold double precision default 0.92,
  p_limit integer default 1
)
returns table (
  id uuid,
  question text,
  answer text,
  requested_model text,
  served_model text,
  prompt_tokens integer,
  completion_tokens integer,
  similarity double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.question,
    c.answer,
    c.requested_model,
    c.served_model,
    c.prompt_tokens,
    c.completion_tokens,
    (1 - (c.embedding <=> p_embedding))::double precision as similarity
  from public.semantic_cache c
  where c.workspace_id = p_workspace_id
    and c.expires_at > now()
    and c.embedding is not null
    and 1 - (c.embedding <=> p_embedding) >= p_threshold
  order by c.embedding <=> p_embedding
  limit greatest(p_limit, 1);
$$;

grant execute on function public.match_semantic_cache(uuid, vector, double precision, integer) to service_role;
grant execute on function public.match_semantic_cache(uuid, vector, double precision, integer) to authenticated;

create or replace function public.cleanup_semantic_cache()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  delete from public.semantic_cache where expires_at <= now();
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

grant execute on function public.cleanup_semantic_cache() to service_role;
