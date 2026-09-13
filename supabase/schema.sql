-- FinOps MVP schema (run in Supabase SQL Editor)
-- After this file, run supabase/members.sql for multi-company memberships.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trial_ends_at timestamptz not null,
  subscription_status text not null default 'trialing',
  stripe_customer_id text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.workspaces add column if not exists created_by uuid default auth.uid();

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text,
  role text not null default 'cfo',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists role text not null default 'cfo';

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'developer',
  invited_by uuid references auth.users(id),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create unique index if not exists workspace_invites_workspace_email_idx
  on public.workspace_invites (workspace_id, lower(email));

create table if not exists public.workspace_credentials (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  openrouter_api_key text,
  updated_at timestamptz not null default now()
);

create table if not exists public.proxy_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now()
);

alter table public.ai_requests add column if not exists workspace_id uuid;
alter table public.ai_requests add column if not exists requested_model text;
alter table public.ai_requests add column if not exists mode_applied text;
alter table public.ai_requests add column if not exists routed boolean default false;
alter table public.ai_requests add column if not exists stop_loss_triggered boolean default false;
alter table public.ai_requests add column if not exists routing_reason text;
alter table public.ai_requests add column if not exists estimated_cost_usd numeric;
alter table public.ai_requests add column if not exists cost_without_proxy numeric;
alter table public.ai_requests add column if not exists cost_with_proxy numeric;
alter table public.ai_requests add column if not exists savings_usd numeric;
alter table public.ai_requests add column if not exists complexity text;
alter table public.ai_requests add column if not exists department text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
  invite_ws uuid;
begin
  select workspace_id into invite_ws
  from public.workspace_invites
  where lower(email) = lower(new.email)
    and status = 'pending'
    and role = 'developer'
  order by created_at desc
  limit 1;

  if invite_ws is not null then
    insert into public.profiles (id, workspace_id, email, role)
    values (new.id, invite_ws, new.email, 'developer');

    update public.workspace_invites
    set status = 'accepted'
    where workspace_id = invite_ws
      and lower(email) = lower(new.email)
      and status = 'pending';

    return new;
  end if;

  insert into public.workspaces (name, trial_ends_at, subscription_status, created_by)
  values (coalesce(new.email, 'workspace'), now() + interval '3 days', 'trialing', new.id)
  returning id into ws_id;

  insert into public.profiles (id, workspace_id, email, role)
  values (new.id, ws_id, new.email, 'cfo');

  insert into public.workspace_credentials (workspace_id)
  values (ws_id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.claim_developer_invite()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  user_email text;
  invite_ws uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select email into user_email from auth.users where id = uid;

  select workspace_id into invite_ws
  from public.workspace_invites
  where lower(email) = lower(user_email)
    and status = 'pending'
    and role = 'developer'
  order by created_at desc
  limit 1;

  if invite_ws is null then
    return null;
  end if;

  insert into public.profiles (id, workspace_id, email, role)
  values (uid, invite_ws, user_email, 'developer')
  on conflict (id) do update
    set workspace_id = excluded.workspace_id,
        email = excluded.email,
        role = 'developer';

  update public.workspace_invites
  set status = 'accepted'
  where workspace_id = invite_ws
    and lower(email) = lower(user_email)
    and status = 'pending';

  return invite_ws;
end;
$$;

grant execute on function public.claim_developer_invite() to authenticated;

create or replace function public.ensure_own_workspace()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
  uid uuid := auth.uid();
  user_email text;
  claimed uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  claimed := public.claim_developer_invite();
  if claimed is not null then
    return claimed;
  end if;

  if public.developer_access_state() = 'revoked' then
    raise exception 'developer_revoked';
  end if;

  select workspace_id into ws_id from public.profiles where id = uid;
  if ws_id is not null then
    return ws_id;
  end if;

  select email into user_email from auth.users where id = uid;

  insert into public.workspaces (name, trial_ends_at, subscription_status, created_by)
  values (coalesce(user_email, 'workspace'), now() + interval '3 days', 'trialing', uid)
  returning id into ws_id;

  insert into public.profiles (id, workspace_id, email, role)
  values (uid, ws_id, user_email, 'cfo');

  insert into public.workspace_credentials (workspace_id)
  values (ws_id)
  on conflict (workspace_id) do nothing;

  return ws_id;
end;
$$;

grant execute on function public.ensure_own_workspace() to authenticated;

create or replace function public.developer_access_state()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  user_email text;
begin
  if uid is null then
    return 'none';
  end if;

  select email into user_email from auth.users where id = uid;

  if exists (
    select 1 from public.workspace_invites
    where lower(email) = lower(user_email)
      and status in ('pending', 'accepted')
  ) then
    return 'invited';
  end if;

  if exists (
    select 1 from public.workspace_invites
    where lower(email) = lower(user_email)
      and status = 'revoked'
  ) then
    return 'revoked';
  end if;

  return 'none';
end;
$$;

grant execute on function public.developer_access_state() to authenticated;

create or replace function public.revoke_developer(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ws_id uuid;
  target text := lower(trim(p_email));
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select workspace_id into ws_id
  from public.profiles
  where id = uid and role = 'cfo';

  if ws_id is null then
    raise exception 'not a cfo';
  end if;

  update public.workspace_invites
  set status = 'revoked'
  where workspace_id = ws_id
    and lower(email) = target;

  delete from public.profiles
  where workspace_id = ws_id
    and role = 'developer'
    and lower(email) = target;
end;
$$;

grant execute on function public.revoke_developer(text) to authenticated;

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

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.workspace_credentials enable row level security;
alter table public.proxy_api_keys enable row level security;
alter table public.ai_requests enable row level security;
alter table public.workspace_invites enable row level security;

create policy "profiles self" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "workspaces member" on public.workspaces
  for select using (
    id in (select workspace_id from public.profiles where id = auth.uid())
  );

create policy "workspaces creator" on public.workspaces
  for select using (created_by = auth.uid());

create policy "workspaces insert auth" on public.workspaces
  for insert with check (auth.uid() is not null);

create policy "credentials member" on public.workspace_credentials
  for all using (
    workspace_id in (select workspace_id from public.profiles where id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from public.profiles where id = auth.uid())
  );

create policy "proxy keys member" on public.proxy_api_keys
  for all using (
    workspace_id in (select workspace_id from public.profiles where id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from public.profiles where id = auth.uid())
  );

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

create policy "invites cfo" on public.workspace_invites
  for all using (
    workspace_id in (
      select workspace_id from public.profiles where id = auth.uid() and role = 'cfo'
    )
  ) with check (
    workspace_id in (
      select workspace_id from public.profiles where id = auth.uid() and role = 'cfo'
    )
  );
