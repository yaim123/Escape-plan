-- Apply in a NEW Supabase project using the SQL editor.
-- Phase 1: teacher-owned content only. No anonymous student access is granted.
begin;
create table public.escape_contents (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  room_code text not null unique check (room_code ~ '^[0-9]{6}$'),
  title text not null check (length(title) between 1 and 200),
  document jsonb not null check (jsonb_typeof(document) = 'object' and document->>'schemaVersion' = '1'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index escape_contents_owner_updated on public.escape_contents (owner_id, updated_at desc);
alter table public.escape_contents enable row level security;
revoke all on public.escape_contents from anon;
grant select, insert, update, delete on public.escape_contents to authenticated;
create policy "teacher_read_own" on public.escape_contents for select to authenticated using ((select auth.uid()) = owner_id);
create policy "teacher_create_own" on public.escape_contents for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "teacher_update_own" on public.escape_contents for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "teacher_delete_own" on public.escape_contents for delete to authenticated using ((select auth.uid()) = owner_id);
create function public.escape_content_timestamp() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  new.created_at = old.created_at;
  if new.room_code <> old.room_code then raise exception 'The room code is permanent.'; end if;
  if new.owner_id <> old.owner_id then raise exception 'Content ownership cannot be transferred.'; end if;
  return new;
end;
$$;
create trigger escape_content_before_update before update on public.escape_contents for each row execute function public.escape_content_timestamp();

-- Separate future live-session records from content. These tables intentionally
-- have no client grants or policies until server-authoritative gameplay exists.
create table public.escape_sessions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.escape_contents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','running','paused','ended')),
  content_snapshot jsonb not null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.escape_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.escape_sessions(id) on delete cascade,
  team_number integer,
  member_number integer,
  role_name text,
  identity_hash text not null,
  progress jsonb not null default '{}',
  arrived_at timestamptz,
  unique (session_id, identity_hash)
);
create table public.escape_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.escape_sessions(id) on delete cascade,
  participant_id uuid references public.escape_participants(id) on delete cascade,
  block_id uuid not null,
  event_type text not null,
  source text not null check (source in ('student','teacher','system')),
  created_at timestamptz not null default now()
  -- No student-submitted answer strings are stored.
);
alter table public.escape_sessions enable row level security;
alter table public.escape_participants enable row level security;
alter table public.escape_events enable row level security;
revoke all on public.escape_sessions, public.escape_participants, public.escape_events from anon, authenticated;
revoke all on sequence public.escape_events_id_seq from anon, authenticated;
commit;
