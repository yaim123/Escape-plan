-- Run AFTER 001_foundation.sql, once, in Supabase SQL Editor.
-- No table access is granted to students. RPCs authorize each operation.
begin;
create schema if not exists escape_private;
revoke all on schema escape_private from public, anon, authenticated;

alter table public.escape_sessions drop constraint escape_sessions_status_check;
update public.escape_sessions set status = case status when 'waiting' then 'lobby' when 'running' then 'playing' when 'ended' then 'finished' else status end;
alter table public.escape_sessions alter column status set default 'lobby';
alter table public.escape_sessions add constraint escape_sessions_status_check check (status in ('lobby','playing','paused','finished'));
alter table public.escape_sessions add column lobby_topic text not null default ('lobby:' || gen_random_uuid()::text || gen_random_uuid()::text);
create unique index escape_one_active_session on public.escape_sessions(content_id) where status <> 'finished';
alter table public.escape_participants
  add column recovery_hash text unique,
  add column grade integer check (grade between 1 and 12),
  add column classroom integer check (classroom between 1 and 99),
  add column student_number integer check (student_number between 1 and 999),
  add column display_name text check (length(display_name) between 1 and 40),
  add column last_seen_at timestamptz not null default now(),
  add column left_at timestamptz;
create index escape_participant_roster on public.escape_participants(session_id, left_at, team_number);

-- Internal helpers are never executable by API roles.
create function escape_private.hash_token(p_token text) returns text
language sql immutable strict set search_path = '' as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;
create function escape_private.identity_key(p_grade integer, p_class integer, p_number integer) returns text
language sql immutable strict set search_path = '' as $$
  select escape_private.hash_token(p_grade::text || ':' || p_class::text || ':' || p_number::text);
$$;
create function escape_private.check_identity(p_grade integer, p_class integer, p_number integer, p_name text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_grade is null or p_grade not between 1 and 12 or p_class is null or p_class not between 1 and 99
    or p_number is null or p_number not between 1 and 999 or p_name is null or length(btrim(p_name)) not between 1 and 40 then
    raise exception '학년·반·번호·이름을 올바르게 입력하세요.' using errcode = '22023';
  end if;
end;
$$;
create function escape_private.roster(p_session uuid, p_self uuid default null) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'sessionId', s.id, 'status', s.status, 'startedAt', s.started_at, 'serverNow', now(),
    'title', s.content_snapshot->>'title', 'playMode', s.content_snapshot->>'playMode',
    'teamCount', (s.content_snapshot#>>'{teamSettings,teamCount}')::integer,
    'maxMembers', (s.content_snapshot#>>'{teamSettings,maxMembers}')::integer,
    'topic', s.lobby_topic, 'participantId', p_self,
    'participants', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'grade', p.grade, 'classroom', p.classroom, 'number', p.student_number,
      'name', p.display_name, 'team', p.team_number, 'lastSeenAt', p.last_seen_at
    ) order by p.grade, p.classroom, p.student_number, p.id)
    from public.escape_participants p where p.session_id = s.id and p.left_at is null), '[]'::jsonb)
  ) from public.escape_sessions s where s.id = p_session;
$$;
create function escape_private.notify_lobby() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_topic text;
begin
  if tg_table_name = 'escape_sessions' then
    v_topic := new.lobby_topic;
  else
    -- Heartbeat writes do not fan out unless a disconnected participant returned.
    if tg_op = 'UPDATE' and new.team_number is not distinct from old.team_number
      and new.display_name is not distinct from old.display_name and new.grade is not distinct from old.grade
      and new.classroom is not distinct from old.classroom and new.student_number is not distinct from old.student_number
      and new.left_at is not distinct from old.left_at and old.last_seen_at > now() - interval '75 seconds' then return new; end if;
    select lobby_topic into v_topic from public.escape_sessions where id = coalesce(new.session_id, old.session_id);
  end if;
  if v_topic is not null then
    -- Public channel carries only an empty invalidation signal, NEVER names,
    -- tokens, records, answers, or authoritative state. Clients refetch via RPC.
    perform realtime.send('{}'::jsonb, 'changed', v_topic, false);
  end if;
  return coalesce(new, old);
end;
$$;
create trigger escape_session_broadcast after insert or update on public.escape_sessions for each row execute function escape_private.notify_lobby();
create trigger escape_participant_broadcast after insert or update or delete on public.escape_participants for each row execute function escape_private.notify_lobby();

create function public.escape_teacher_lobby(p_action text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.escape_contents; s public.escape_sessions;
begin
  if auth.uid() is null then raise exception '교사 로그인이 필요합니다.' using errcode = '42501'; end if;
  if p_action = 'open' then
    select * into c from public.escape_contents where id = p_id and owner_id = auth.uid() for update;
    if not found then raise exception '본인 콘텐츠만 열 수 있습니다.' using errcode = '42501'; end if;
    select * into s from public.escape_sessions where content_id = c.id and status <> 'finished' for update;
    if not found then
      if c.document->>'playMode' not in ('individual','team') or c.document->>'playMode' is null
        or coalesce((c.document#>>'{teamSettings,teamCount}')::integer, 0) not between 1 and 20
        or ((c.document#>>'{teamSettings,maxMembers}') is not null and (c.document#>>'{teamSettings,maxMembers}')::integer not between 1 and 20) then
        raise exception '콘텐츠의 팀 설정을 확인하세요.' using errcode = '22023';
      end if;
      insert into public.escape_sessions(content_id, owner_id, content_snapshot) values(c.id, auth.uid(), c.document) returning * into s;
    end if;
  else
    select * into s from public.escape_sessions where id = p_id and owner_id = auth.uid() for update;
    if not found then raise exception '본인 대기실만 관리할 수 있습니다.' using errcode = '42501'; end if;
    if p_action = 'start' then
      if s.status = 'lobby' then
        if not exists(select 1 from public.escape_participants where session_id = s.id and left_at is null) then raise exception '참가 학생이 없습니다.' using errcode = '22023'; end if;
        if s.content_snapshot->>'playMode' = 'team' and exists(select 1 from public.escape_participants where session_id = s.id and left_at is null and team_number is null) then raise exception '모든 학생이 조를 선택해야 시작할 수 있습니다.' using errcode = '22023'; end if;
        update public.escape_sessions set status = 'playing', started_at = now() where id = s.id;
      elsif s.status <> 'playing' then raise exception '대기 상태에서만 시작할 수 있습니다.' using errcode = '22023'; end if;
    elsif p_action = 'close' then
      update public.escape_sessions set status = 'finished', ended_at = coalesce(ended_at, now()) where id = s.id;
    elsif p_action <> 'read' or p_action is null then raise exception '지원하지 않는 작업입니다.' using errcode = '22023'; end if;
  end if;
  return escape_private.roster(s.id);
end;
$$;

create function public.escape_join_lobby(p_code text, p_token text, p_grade integer, p_class integer, p_number integer, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.escape_sessions; p public.escape_participants; v_hash text;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' or p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '방 코드 또는 복구 정보가 올바르지 않습니다.' using errcode = '22023'; end if;
  perform escape_private.check_identity(p_grade, p_class, p_number, p_name);
  v_hash := escape_private.hash_token(p_token);
  -- Serialize admission, team capacity, and start against the same session row.
  select s1.* into s from public.escape_sessions s1 join public.escape_contents c on c.id = s1.content_id
    where c.room_code = p_code and s1.status <> 'finished' for update of s1;
  if not found then raise exception '열려 있는 방이 없습니다. 방 코드를 확인하세요.' using errcode = '22023'; end if;
  select * into p from public.escape_participants where recovery_hash = v_hash;
  if found then
    if p.session_id <> s.id then raise exception '이 복구 정보는 다른 수업에 속합니다.' using errcode = '22023'; end if;
    if p.left_at is not null and s.status <> 'lobby' then raise exception '시작한 수업에는 다시 입장할 수 없습니다.' using errcode = '22023'; end if;
    update public.escape_participants set left_at = null, last_seen_at = now() where id = p.id;
    return escape_private.roster(s.id, p.id);
  end if;
  if s.status <> 'lobby' then raise exception '이미 시작한 방입니다. 신규 입장이 닫혔습니다.' using errcode = '22023'; end if;
  if (select count(*) from public.escape_participants where session_id = s.id) >= 500 then raise exception '이 대기실의 참가 한도에 도달했습니다.' using errcode = '22023'; end if;
  if exists(select 1 from public.escape_participants where session_id = s.id and identity_hash = escape_private.identity_key(p_grade, p_class, p_number)) then
    raise exception '같은 학년·반·번호로 이미 참가했습니다. 기존 브라우저에서 복귀하세요.' using errcode = '22023';
  end if;
  insert into public.escape_participants(session_id, identity_hash, recovery_hash, grade, classroom, student_number, display_name, arrived_at)
    values(s.id, escape_private.identity_key(p_grade, p_class, p_number), v_hash, p_grade, p_class, p_number, btrim(p_name), now()) returning * into p;
  return escape_private.roster(s.id, p.id);
end;
$$;

create function public.escape_student_lobby(p_token text, p_action text default 'read', p_team integer default null,
  p_grade integer default null, p_class integer default null, p_number integer default null, p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.escape_sessions; p public.escape_participants; v_session uuid; v_max integer; v_count integer;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '참가 복구 정보가 필요합니다.' using errcode = '42501'; end if;
  select session_id into v_session from public.escape_participants where recovery_hash = escape_private.hash_token(p_token);
  if not found then raise exception '참가 기록을 찾을 수 없습니다.' using errcode = '42501'; end if;
  select * into s from public.escape_sessions where id = v_session for update;
  select * into p from public.escape_participants where recovery_hash = escape_private.hash_token(p_token) for update;
  if p.left_at is not null then raise exception '퇴장한 참가자입니다. 다시 입장하세요.' using errcode = '42501'; end if;
  if p_action in ('team','profile','leave') and s.status <> 'lobby' then raise exception '게임 시작 후에는 참가 정보를 변경할 수 없습니다.' using errcode = '22023'; end if;
  if p_action = 'team' then
    if s.content_snapshot->>'playMode' <> 'team' or p_team is null or p_team < 1 or p_team > (s.content_snapshot#>>'{teamSettings,teamCount}')::integer then raise exception '선택할 수 없는 조입니다.' using errcode = '22023'; end if;
    v_max := (s.content_snapshot#>>'{teamSettings,maxMembers}')::integer;
    select count(*) into v_count from public.escape_participants where session_id = s.id and team_number = p_team and left_at is null and id <> p.id;
    if v_max is not null and v_count >= v_max then raise exception '정원이 찬 조입니다.' using errcode = '22023'; end if;
    update public.escape_participants set team_number = p_team, last_seen_at = now() where id = p.id;
  elsif p_action = 'profile' then
    perform escape_private.check_identity(p_grade, p_class, p_number, p_name);
    if exists(select 1 from public.escape_participants where session_id = s.id and id <> p.id and identity_hash = escape_private.identity_key(p_grade,p_class,p_number)) then raise exception '같은 학년·반·번호의 학생이 있습니다.' using errcode = '22023'; end if;
    update public.escape_participants set grade = p_grade, classroom = p_class, student_number = p_number, display_name = btrim(p_name), identity_hash = escape_private.identity_key(p_grade,p_class,p_number), last_seen_at = now() where id = p.id;
  elsif p_action = 'leave' then
    update public.escape_participants set left_at = now(), team_number = null where id = p.id;
    return jsonb_build_object('left', true);
  elsif p_action = 'touch' then
    if s.status <> 'finished' then update public.escape_participants set last_seen_at = now() where id = p.id; end if;
  elsif p_action <> 'read' or p_action is null then raise exception '지원하지 않는 작업입니다.' using errcode = '22023'; end if;
  return escape_private.roster(s.id, p.id);
end;
$$;

revoke all on all functions in schema escape_private from public, anon, authenticated;
revoke all on function public.escape_teacher_lobby(text,uuid) from public, anon, authenticated;
revoke all on function public.escape_join_lobby(text,text,integer,integer,integer,text) from public, anon, authenticated;
revoke all on function public.escape_student_lobby(text,text,integer,integer,integer,integer,text) from public, anon, authenticated;
grant execute on function public.escape_teacher_lobby(text,uuid) to authenticated;
grant execute on function public.escape_join_lobby(text,text,integer,integer,integer,text) to anon;
grant execute on function public.escape_student_lobby(text,text,integer,integer,integer,integer,text) to anon;
-- Explicitly retain original RLS and deny direct table reads/writes to clients.
revoke all on public.escape_sessions, public.escape_participants, public.escape_events from anon, authenticated;
notify pgrst, 'reload schema';
commit;
