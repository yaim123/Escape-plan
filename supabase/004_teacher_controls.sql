-- Apply once after 003. Existing sessions and answers are preserved.
begin;
alter table public.escape_sessions add column paused_at timestamptz;
alter table public.escape_sessions add column paused_ms bigint not null default 0 check(paused_ms>=0);
alter table public.escape_participants add column progress_reset_at timestamptz;
alter table public.escape_participants add column completed_elapsed_ms bigint;
alter table public.escape_events add column event_team integer;
alter table public.escape_events add column event_member integer;
alter table public.escape_events add column event_role text;
update public.escape_events e set event_team=p.team_number,event_member=p.member_number,event_role=p.role_name from public.escape_participants p where p.id=e.participant_id;
update public.escape_sessions set paused_at=now() where status='paused';

create table public.escape_progress_overrides (
  participant_id uuid not null references public.escape_participants(id) on delete cascade,
  block_id uuid not null,
  action text not null check(action in ('complete','skip','open')),
  scope text not null check(scope in ('student','team')),
  team_number integer,
  created_at timestamptz not null default now(),
  primary key(participant_id,block_id)
);
create table public.escape_teacher_actions (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.escape_sessions(id) on delete cascade,
  teacher_id uuid not null references auth.users(id),
  request_id uuid not null,
  action text not null,
  scope text not null,
  target_ids uuid[] not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(session_id,request_id)
);
alter table public.escape_progress_overrides enable row level security;
alter table public.escape_teacher_actions enable row level security;
revoke all on public.escape_progress_overrides,public.escape_teacher_actions from anon,authenticated;
revoke all on sequence public.escape_teacher_actions_id_seq from anon,authenticated;

create function escape_private.pause_clock() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='paused' and old.status='playing' then new.paused_at:=now();
  elsif old.status='paused' and new.status in ('playing','finished') then
    new.paused_ms:=old.paused_ms+greatest(0,floor(extract(epoch from(now()-old.paused_at))*1000))::bigint;
    new.paused_at:=null;
  end if;
  return new;
end; $$;
create trigger escape_pause_clock before update of status on public.escape_sessions for each row execute function escape_private.pause_clock();
create function escape_private.play_timing(p_session uuid) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('serverNow',now(),'pausedAt',s.paused_at,'pausedMs',s.paused_ms,
    'elapsedMs',case when s.started_at is null then 0 else greatest(0,floor(extract(epoch from(coalesce(s.ended_at,s.paused_at,now())-s.started_at))*1000)-s.paused_ms)::bigint end)
  from public.escape_sessions s where id=p_session;
$$;
create function escape_private.event_identity() returns trigger language plpgsql set search_path='' as $$
begin
  select team_number,member_number,role_name into new.event_team,new.event_member,new.event_role from public.escape_participants where id=new.participant_id;
  return new;
end; $$;
create trigger escape_event_identity before insert on public.escape_events for each row execute function escape_private.event_identity();

-- Historical events keep their original team/member identity after a teacher move.
create or replace function escape_private.play_context(p_actor uuid) returns jsonb language sql stable set search_path='' as $$
  with actor as (select p.*,s.content_snapshot->>'playMode' mode from public.escape_participants p join public.escape_sessions s on s.id=p.session_id where p.id=p_actor),
  members as (select p.id,p.member_number,p.role_name from public.escape_participants p,actor a where p.session_id=a.session_id and p.left_at is null and
    ((a.mode='individual' and p.id=a.id) or(a.mode='team' and p.team_number=a.team_number))),
  events as (
    select e.block_id,e.event_type,e.event_member member,e.event_role role from public.escape_events e,actor a
    where e.session_id=a.session_id and (a.progress_reset_at is null or e.created_at>=a.progress_reset_at) and
      ((a.mode='individual' and e.participant_id=a.id) or(a.mode='team' and e.event_team=a.team_number))
    union all
    select o.block_id,'complete',p.member_number,p.role_name from public.escape_progress_overrides o
      join public.escape_participants p on p.id=o.participant_id cross join actor a
    where p.session_id=a.session_id and o.action in ('complete','skip') and (a.progress_reset_at is null or o.created_at>=a.progress_reset_at)
      and (o.participant_id=a.id and o.scope='student' or o.scope='team' and o.team_number=a.team_number and p.team_number=a.team_number)
  )
  select jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'member',member_number,'role',role_name) order by member_number) from members),'[]'),
    'events',coalesce((select jsonb_agg(jsonb_build_object('blockId',block_id,'type',event_type,'member',member,'role',role)) from events),'[]'));
$$;

create or replace function escape_private.play_state(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.escape_participants; s public.escape_sessions; ctx jsonb; m jsonb; b jsonb; i integer:=0; prior_done boolean:=true;
  complete boolean; mine boolean; available boolean; forced text; done_ids jsonb:='[]'; mine_ids jsonb:='[]'; open_ids jsonb:='[]'; current_id text; wrongs jsonb;
begin
  select * into p from public.escape_participants where id=p_actor;
  select * into s from public.escape_sessions where id=p.session_id;
  ctx:=escape_private.play_context(p_actor);
  select value into m from jsonb_array_elements(ctx->'members') where value->>'id'=p_actor::text;
  for b in select value from jsonb_array_elements(s.content_snapshot->'content') loop
    select action into forced from public.escape_progress_overrides where participant_id=p_actor and block_id=(b->>'id')::uuid and (scope='student' or team_number=p.team_number);
    complete:=coalesce(forced in ('complete','skip'),false) or escape_private.completed(b,ctx,i,s.content_snapshot->>'playMode'='individual');
    mine:=exists(select 1 from jsonb_array_elements(ctx->'events') e where e->>'blockId'=b->>'id' and e->>'type'='complete' and e->>'member'=p.member_number::text);
    available:=coalesce(forced='open',false) or (not complete and not mine and (s.content_snapshot->>'playMode'='individual' or escape_private.assigned(b,m,ctx->'members',i)) and
      (case when jsonb_array_length(b#>'{unlock,conditions}')>0 then escape_private.unlocked(b->'unlock',ctx->'events') else prior_done end));
    if complete then done_ids:=done_ids||jsonb_build_array(b->>'id'); end if;
    if mine then mine_ids:=mine_ids||jsonb_build_array(b->>'id'); end if;
    if available then open_ids:=open_ids||jsonb_build_array(b->>'id'); end if;
    prior_done:=prior_done and complete; i:=i+1;
  end loop;
  current_id:=p.progress->>'currentBlockId';
  if current_id is null or not open_ids ? current_id then current_id:=open_ids->>0; end if;
  select coalesce(jsonb_object_agg(block_id::text,wrong_count),'{}') into wrongs from public.escape_block_progress where participant_id=p_actor and wrong_count>0;
  return jsonb_build_object('currentBlockId',current_id,'completedIds',done_ids,'personalCompletedIds',mine_ids,'availableIds',open_ids,
    'completedCount',jsonb_array_length(done_ids),'totalCount',i,'wrongCounts',wrongs,'memberNumber',p.member_number,'role',p.role_name);
end; $$;
create or replace function escape_private.complete_block(p_actor uuid,p_block jsonb,p_source text) returns void
language plpgsql set search_path = '' as $$
declare sid uuid;
begin
  delete from public.escape_progress_overrides where participant_id=p_actor and block_id=(p_block->>'id')::uuid and action='open';
  select session_id into sid from public.escape_participants where id=p_actor;
  insert into public.escape_block_progress(participant_id,block_id,completed_at) values(p_actor,(p_block->>'id')::uuid,now())
    on conflict(participant_id,block_id) do update set completed_at=coalesce(escape_block_progress.completed_at,excluded.completed_at);
  if p_source='teacher' and p_block->>'questionType'='approval' then
    insert into public.escape_events(session_id,participant_id,block_id,event_type,source) values(sid,p_actor,(p_block->>'id')::uuid,'approved',p_source) on conflict do nothing;
  end if;
  if p_block->>'type'<>'question' or p_block->>'questionType'='switch' then
    insert into public.escape_events(session_id,participant_id,block_id,event_type,source) values(sid,p_actor,(p_block->>'id')::uuid,'button',p_source) on conflict do nothing;
  end if;
  insert into public.escape_events(session_id,participant_id,block_id,event_type,source) values(sid,p_actor,(p_block->>'id')::uuid,'complete',p_source) on conflict do nothing;
end;
$$;

create function escape_private.capture_completion_time() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.progress->>'totalCount')::integer>0 and new.progress->>'completedCount'=new.progress->>'totalCount' and jsonb_array_length(new.progress->'availableIds')=0 then
    new.completed_elapsed_ms:=coalesce(old.completed_elapsed_ms,(escape_private.play_timing(new.session_id)->>'elapsedMs')::bigint);
  else new.completed_elapsed_ms:=null; end if;
  return new;
end; $$;
create trigger escape_completion_time before update of progress on public.escape_participants for each row execute function escape_private.capture_completion_time();

alter function escape_private.student_projection(uuid) rename to student_projection_v3;
create function escape_private.student_projection(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.escape_participants; result jsonb;
begin
  select * into p from public.escape_participants where id=p_actor;
  result:=escape_private.student_projection_v3(p_actor)||jsonb_build_object('timing',escape_private.play_timing(p.session_id),'completedElapsedMs',p.completed_elapsed_ms);
  if result->>'status'='paused' then result:=result||jsonb_build_object('current',null,'available','[]'::jsonb); end if;
  return result;
end; $$;
alter function public.escape_teacher_progress(uuid,text,uuid,uuid) set schema escape_private;
alter function escape_private.escape_teacher_progress(uuid,text,uuid,uuid) rename to teacher_progress_v3;
create function public.escape_teacher_progress(p_session uuid,p_action text default 'read',p_participant uuid default null,p_block uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; s public.escape_sessions; students jsonb;
begin
  result:=escape_private.teacher_progress_v3(p_session,p_action,p_participant,p_block);
  select * into s from public.escape_sessions where id=p_session;
  select coalesce(jsonb_agg(x.value||jsonb_build_object('lastSeenAt',p.last_seen_at,'completedElapsedMs',p.completed_elapsed_ms) order by p.team_number,p.member_number),'[]') into students
    from jsonb_array_elements(result->'participants') x(value) join public.escape_participants p on p.id=(x.value->>'id')::uuid;
  return result||jsonb_build_object('participants',students,'timing',escape_private.play_timing(p_session),
    'teamCount',s.content_snapshot#>'{teamSettings,teamCount}',
    'contents',(select coalesce(jsonb_agg(jsonb_build_object('id',value->'id','title',value->'title','stage',value->'stage') order by ord),'[]') from jsonb_array_elements(s.content_snapshot->'content') with ordinality x(value,ord)),
    'actions',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id desc),'[]') from (select id,action,scope,target_ids,details,created_at from public.escape_teacher_actions where session_id=p_session order by id desc limit 30) a));
end; $$;

create function public.escape_teacher_control(p_session uuid,p_action text,p_scope text default 'student',p_participant uuid default null,p_team integer default null,
  p_block uuid default null,p_stage text default null,p_new_team integer default null,p_revision bigint default null,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.escape_sessions; p public.escape_participants; ids uuid[]; target uuid; v_block uuid; details jsonb:='[]'; before_state jsonb; max_members integer; next_member integer;
begin
  if auth.uid() is null then raise exception '교사 로그인이 필요합니다.' using errcode='42501'; end if;
  select * into s from public.escape_sessions where id=p_session and owner_id=auth.uid() for update;
  if not found then raise exception '본인 수업만 관리할 수 있습니다.' using errcode='42501'; end if;
  if p_request is null then raise exception '관리 요청 ID가 필요합니다.' using errcode='22023'; end if;
  if exists(select 1 from public.escape_teacher_actions where session_id=s.id and request_id=p_request) then return public.escape_teacher_progress(s.id); end if;
  if p_revision is null or p_revision<>s.progress_revision then raise exception '진행 상태가 바뀌었습니다. 최신 상태를 확인한 뒤 다시 실행하세요.' using errcode='40001'; end if;
  if s.status not in ('playing','paused') or s.play_version<>1 then raise exception '시작된 수업에서만 관리할 수 있습니다.' using errcode='22023'; end if;
  if p_action in ('pause','resume') then
    if p_scope<>'session' then raise exception '전체 수업을 대상으로 선택하세요.' using errcode='22023'; end if;
    if p_action='pause' and s.status<>'playing' or p_action='resume' and s.status<>'paused' then raise exception '현재 상태에서는 실행할 수 없습니다.' using errcode='22023'; end if;
    update public.escape_sessions set status=case when p_action='pause' then 'paused' else 'playing' end where id=s.id;
    ids:='{}';
  else
    if p_action not in ('complete','skip','move','stage','unlock','reset','team') or p_action is null then raise exception '지원하지 않는 관리 작업입니다.' using errcode='22023'; end if;
    if p_scope='student' then
      select array_agg(id) into ids from public.escape_participants where id=p_participant and session_id=s.id and left_at is null;
    elsif p_scope='team' and s.content_snapshot->>'playMode'='team' then
      select array_agg(id order by member_number) into ids from public.escape_participants where team_number=p_team and session_id=s.id and left_at is null;
    else raise exception '학생 또는 팀 대상을 확인하세요.' using errcode='22023'; end if;
    if coalesce(cardinality(ids),0)=0 then raise exception '관리할 참가자가 없습니다.' using errcode='22023'; end if;
    if p_action='team' then
      if s.content_snapshot->>'playMode'<>'team' or p_new_team is null or p_new_team<1 or p_new_team>(s.content_snapshot#>>'{teamSettings,teamCount}')::integer then raise exception '이동할 조를 확인하세요.' using errcode='22023'; end if;
      max_members:=(s.content_snapshot#>>'{teamSettings,maxMembers}')::integer;
      if max_members is not null and (select count(*) from public.escape_participants where session_id=s.id and left_at is null and (team_number=p_new_team or id=any(ids)))>max_members then raise exception '이동할 조의 정원을 초과합니다.' using errcode='22023'; end if;
    end if;
    foreach target in array ids loop
      select * into p from public.escape_participants where id=target for update;
      before_state:=jsonb_build_object('participantId',p.id,'name',p.display_name,'team',p.team_number,'current',p.progress->'currentBlockId');
      v_block:=null;
      if p_action in ('complete','skip') then v_block:=(p.progress->>'currentBlockId')::uuid;
      elsif p_action in ('move','unlock') then v_block:=p_block;
      elsif p_action='stage' then select (value->>'id')::uuid into v_block from jsonb_array_elements(s.content_snapshot->'content') with ordinality x(value,ord) where value->>'stage'=p_stage order by ord limit 1; end if;
      if p_action in ('complete','skip','move','stage','unlock') then
        if v_block is null or not exists(select 1 from jsonb_array_elements(s.content_snapshot->'content') b where b->>'id'=v_block::text) then raise exception '대상의 현재 콘텐츠 또는 이동할 콘텐츠가 없습니다.' using errcode='22023'; end if;
        insert into public.escape_progress_overrides(participant_id,block_id,action,scope,team_number) values(p.id,v_block,case when p_action in ('complete','skip') then p_action else 'open' end,p_scope,p.team_number)
          on conflict(participant_id,block_id) do update set action=excluded.action,scope=excluded.scope,team_number=excluded.team_number,created_at=now();
        if p_action in ('move','stage') then update public.escape_participants set progress=jsonb_set(progress,'{currentBlockId}',to_jsonb(v_block::text)) where id=p.id; end if;
      elsif p_action='reset' then
        delete from public.escape_events where participant_id=p.id;
        delete from public.escape_block_progress where participant_id=p.id;
        delete from public.escape_submission_receipts where participant_id=p.id;
        delete from public.escape_progress_overrides where participant_id=p.id;
        update public.escape_participants set progress='{}',progress_reset_at=now(),completed_elapsed_ms=null where id=p.id;
      elsif p_action='team' and p.team_number<>p_new_team then
        select coalesce(max(member_number),0)+1 into next_member from public.escape_participants where session_id=s.id and team_number=p_new_team;
        -- Do not renumber existing members or reinterpret their historical events.
        update public.escape_participants set team_number=p_new_team,member_number=next_member,role_name=case when coalesce((s.content_snapshot#>>'{teamSettings,rolesEnabled}')::boolean,false) then coalesce(s.content_snapshot#>>array['teamSettings','roles',case when next_member=1 then '0' else '1' end],'조원') else '조원' end,progress='{}',completed_elapsed_ms=null where id=p.id;
      end if;
      details:=details||jsonb_build_array(before_state||jsonb_build_object('block',v_block,'newTeam',p_new_team,'stage',p_stage));
    end loop;
    perform escape_private.sync_play(s.id);
  end if;
  insert into public.escape_teacher_actions(session_id,teacher_id,request_id,action,scope,target_ids,details) values(s.id,auth.uid(),p_request,p_action,p_scope,ids,jsonb_build_object('targets',details));
  update public.escape_sessions set progress_revision=progress_revision+1 where id=s.id;
  return public.escape_teacher_progress(s.id);
end; $$;

revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_teacher_progress(uuid,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) from public,anon,authenticated;
grant execute on function public.escape_teacher_progress(uuid,text,uuid,uuid) to authenticated;
grant execute on function public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
