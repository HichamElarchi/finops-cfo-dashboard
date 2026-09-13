-- Membership model: one workspace = one company.
-- A CFO can have many developers. A developer can belong to many CFOs.
-- Run this in the Supabase SQL editor (after schema.sql / roles.sql).

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('cfo', 'developer')),
  created_at timestamptz not null default now()
);

update public.workspace_members set email = lower(email) where email is distinct from lower(email);

create unique index if not exists workspace_members_workspace_email_idx
  on public.workspace_members (workspace_id, lower(email));

create unique index if not exists workspace_members_user_workspace_idx
  on public.workspace_members (user_id, workspace_id)
  where user_id is not null;

insert into public.workspace_members (workspace_id, user_id, email, role)
select p.workspace_id, p.id, lower(coalesce(p.email, '')),
       case when p.role = 'developer' then 'developer' else 'cfo' end
from public.profiles p
where coalesce(p.email, '') <> ''
  and not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p.workspace_id
      and lower(m.email) = lower(p.email)
  );

insert into public.workspace_members (workspace_id, user_id, email, role)
select i.workspace_id, p.id, lower(i.email), 'developer'
from public.workspace_invites i
left join public.profiles p on lower(p.email) = lower(i.email)
where i.role = 'developer'
  and i.status = 'accepted'
  and not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = i.workspace_id
      and lower(m.email) = lower(i.email)
  );

create or replace function public.my_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid();
$$;

grant execute on function public.my_workspace_ids() to authenticated;

create or replace function public.upsert_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_email text,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text := lower(trim(p_email));
begin
  update public.workspace_members
  set user_id = coalesce(p_user_id, user_id),
      role = p_role
  where workspace_id = p_workspace_id
    and lower(email) = normalized;

  if found then
    return;
  end if;

  insert into public.workspace_members (workspace_id, user_id, email, role)
  values (p_workspace_id, p_user_id, normalized, p_role);
exception
  when unique_violation then
    update public.workspace_members
    set user_id = coalesce(p_user_id, user_id),
        role = p_role
    where workspace_id = p_workspace_id
      and lower(email) = normalized;
end;
$$;

grant execute on function public.upsert_workspace_member(uuid, uuid, text, text) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
  invite_row record;
  claimed boolean := false;
  first_ws uuid;
begin
  for invite_row in
    select workspace_id
    from public.workspace_invites
    where lower(email) = lower(new.email)
      and status = 'pending'
      and role = 'developer'
    order by created_at
  loop
    claimed := true;
    if first_ws is null then
      first_ws := invite_row.workspace_id;
    end if;

    perform public.upsert_workspace_member(invite_row.workspace_id, new.id, new.email, 'developer');

    update public.workspace_invites
    set status = 'accepted'
    where workspace_id = invite_row.workspace_id
      and lower(email) = lower(new.email)
      and status = 'pending';
  end loop;

  if claimed then
    insert into public.profiles (id, workspace_id, email, role)
    values (new.id, first_ws, new.email, 'developer')
    on conflict (id) do nothing;
    return new;
  end if;

  insert into public.workspaces (name, trial_ends_at, subscription_status, created_by)
  values (coalesce(new.email, 'workspace'), now() + interval '3 days', 'trialing', new.id)
  returning id into ws_id;

  insert into public.profiles (id, workspace_id, email, role)
  values (new.id, ws_id, new.email, 'cfo')
  on conflict (id) do nothing;

  perform public.upsert_workspace_member(ws_id, new.id, coalesce(new.email, ''), 'cfo');

  insert into public.workspace_credentials (workspace_id)
  values (ws_id)
  on conflict (workspace_id) do nothing;

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
  invite_row record;
  first_ws uuid;
  has_cfo boolean := false;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select email into user_email from auth.users where id = uid;

  select exists (
    select 1 from public.workspace_members
    where user_id = uid and role = 'cfo'
  ) into has_cfo;

  for invite_row in
    select workspace_id
    from public.workspace_invites
    where lower(email) = lower(user_email)
      and status = 'pending'
      and role = 'developer'
    order by created_at
  loop
    if first_ws is null then
      first_ws := invite_row.workspace_id;
    end if;

    perform public.upsert_workspace_member(invite_row.workspace_id, uid, user_email, 'developer');

    update public.workspace_invites
    set status = 'accepted'
    where workspace_id = invite_row.workspace_id
      and lower(email) = lower(user_email)
      and status = 'pending';
  end loop;

  if first_ws is null then
    select workspace_id into first_ws
    from public.workspace_members
    where user_id = uid and role = 'developer'
    order by created_at
    limit 1;
  end if;

  if first_ws is not null and not has_cfo then
    insert into public.profiles (id, workspace_id, email, role)
    values (uid, first_ws, user_email, 'developer')
    on conflict (id) do update
      set workspace_id = excluded.workspace_id,
          email = excluded.email,
          role = 'developer';
  elsif first_ws is not null and has_cfo then
    update public.profiles
    set email = coalesce(user_email, email)
    where id = uid;
  end if;

  return first_ws;
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
  has_dev boolean := false;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  claimed := public.claim_developer_invite();

  select exists (
    select 1 from public.workspace_members
    where user_id = uid and role = 'developer'
  ) into has_dev;

  select workspace_id into ws_id
  from public.workspace_members
  where user_id = uid and role = 'cfo'
  order by created_at
  limit 1;
  if ws_id is not null then
    return ws_id;
  end if;

  if has_dev or claimed is not null then
    return coalesce(claimed, (
      select workspace_id from public.workspace_members
      where user_id = uid and role = 'developer'
      order by created_at limit 1
    ));
  end if;

  if exists (
    select 1 from public.workspace_invites
    where lower(email) = lower((select email from auth.users where id = uid))
      and status = 'revoked'
      and role = 'developer'
  ) and not exists (
    select 1 from public.workspace_members where user_id = uid
  ) then
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
  values (uid, ws_id, user_email, 'cfo')
  on conflict (id) do update
    set workspace_id = excluded.workspace_id,
        email = excluded.email,
        role = 'cfo';

  perform public.upsert_workspace_member(ws_id, uid, coalesce(user_email, ''), 'cfo');

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
    select 1 from public.workspace_members
    where user_id = uid and role = 'developer'
  ) then
    return 'invited';
  end if;

  if exists (
    select 1 from public.workspace_invites
    where lower(email) = lower(user_email)
      and status in ('pending', 'accepted')
      and role = 'developer'
  ) then
    return 'invited';
  end if;

  if exists (
    select 1 from public.workspace_invites
    where lower(email) = lower(user_email)
      and status = 'revoked'
      and role = 'developer'
  ) and not exists (
    select 1 from public.workspace_members
    where user_id = uid
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
  from public.workspace_members
  where user_id = uid and role = 'cfo'
  order by created_at
  limit 1;

  if ws_id is null then
    select workspace_id into ws_id
    from public.profiles
    where id = uid and role = 'cfo';
  end if;

  if ws_id is null then
    raise exception 'not a cfo';
  end if;

  update public.workspace_invites
  set status = 'revoked'
  where workspace_id = ws_id
    and lower(email) = target;

  delete from public.workspace_members
  where workspace_id = ws_id
    and role = 'developer'
    and lower(email) = target;

  update public.profiles p
  set workspace_id = coalesce((
        select m.workspace_id from public.workspace_members m
        where m.user_id = p.id
        order by case when m.role = 'cfo' then 0 else 1 end, m.created_at
        limit 1
      ), p.workspace_id),
      role = coalesce((
        select m.role from public.workspace_members m
        where m.user_id = p.id
        order by case when m.role = 'cfo' then 0 else 1 end, m.created_at
        limit 1
      ), p.role)
  where lower(p.email) = target
    and p.workspace_id = ws_id
    and p.role = 'developer';
end;
$$;

grant execute on function public.revoke_developer(text) to authenticated;

alter table public.workspace_members enable row level security;

drop policy if exists "members visible in my workspaces" on public.workspace_members;
create policy "members visible in my workspaces" on public.workspace_members
  for select using (
    workspace_id in (select public.my_workspace_ids())
    or user_id = auth.uid()
  );

drop policy if exists "workspaces member" on public.workspaces;
create policy "workspaces member" on public.workspaces
  for select using (
    id in (select public.my_workspace_ids())
    or id in (select workspace_id from public.profiles where id = auth.uid())
  );

drop policy if exists "credentials member" on public.workspace_credentials;
create policy "credentials member" on public.workspace_credentials
  for all using (
    workspace_id in (select public.my_workspace_ids())
  ) with check (
    workspace_id in (select public.my_workspace_ids())
  );

drop policy if exists "proxy keys member" on public.proxy_api_keys;
create policy "proxy keys member" on public.proxy_api_keys
  for all using (
    workspace_id in (select public.my_workspace_ids())
  ) with check (
    workspace_id in (select public.my_workspace_ids())
  );

drop policy if exists "invites cfo" on public.workspace_invites;
create policy "invites cfo" on public.workspace_invites
  for all using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role = 'cfo'
    )
  ) with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role = 'cfo'
    )
  );

drop policy if exists "ai_requests cfo read" on public.ai_requests;
create policy "ai_requests cfo read" on public.ai_requests
  for select using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role = 'cfo'
    )
  );

grant select, insert, update, delete on public.workspace_members to authenticated;

-- Reattach usage from abandoned workspaces (no CFO left) to the company
-- where that workspace's original email is now a developer.
update public.ai_requests r
set workspace_id = dest.workspace_id,
    client_id = dest.workspace_id::text
from public.workspaces w
join public.workspace_members dest
  on dest.role = 'developer'
 and lower(dest.email) = lower(w.name)
where r.workspace_id = w.id
  and not exists (
    select 1 from public.workspace_members c
    where c.workspace_id = w.id and c.role = 'cfo'
  );

