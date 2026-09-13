-- Enable RLS on every public table (fixes rls_disabled_in_public).
-- Service role (FastAPI) bypasses RLS. Anon/authenticated need policies.

do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end
$$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table if exists public.logs enable row level security;
alter table if exists public.ai_requests enable row level security;
alter table if exists public.workspaces enable row level security;
alter table if exists public.profiles enable row level security;
alter table if exists public.workspace_credentials enable row level security;
alter table if exists public.proxy_api_keys enable row level security;
alter table if exists public.workspace_invites enable row level security;

drop policy if exists "ai_requests cfo read" on public.ai_requests;
create policy "ai_requests cfo read" on public.ai_requests
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role = 'cfo'
        and (
          workspace_id = ai_requests.workspace_id
          or ai_requests.workspace_id is null
        )
    )
  );
