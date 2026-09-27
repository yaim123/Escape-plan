-- Apply once after 013. Existing snapshots remain compatible; chat is opt-in.
begin;
alter table public.escape_events add column retired_at timestamptz;
alter table public.escape_qr_scans add column retired_at timestamptz;
drop index public.escape_completion_event_once;
create unique index escape_completion_event_once on public.escape_events(participant_id,block_id,event_type,event_team,event_member) nulls not distinct where event_type in ('complete','button','approved') and retired_at is null;
alter table public.escape_qr_scans drop constraint escape_qr_scans_session_id_subject_key_qr_id_key;
create unique index escape_current_qr_claim on public.escape_qr_scans(session_id,subject_key,qr_id) where retired_at is null;
create table escape_private.block_replays(
 participant_id uuid references public.escape_participants(id) on delete cascade,block_id uuid,event_floor bigint not null,scope text not null,created_at timestamptz not null default now(),primary key(participant_id,block_id)
);
create or replace function escape_private.play_context_v6(p_actor uuid) returns jsonb language sql stable set search_path='' as $$
  with actor as (select p.*,s.content_snapshot->>'playMode' mode from public.escape_participants p join public.escape_sessions s on s.id=p.session_id where p.id=p_actor),
  members as (select p.id,p.member_number,p.role_name from public.escape_participants p,actor a where p.session_id=a.session_id and p.left_at is null and
    ((a.mode='individual' and p.id=a.id) or(a.mode='team' and p.team_number=a.team_number))),
  events as (
    select e.block_id,e.event_type,e.event_member member,e.event_role role from public.escape_events e,actor a
    where e.retired_at is null and not exists(select 1 from jsonb_array_elements(escape_private.qr_state(a.id)) qs join jsonb_array_elements((select content_snapshot->'qrMissions' from public.escape_sessions where id=a.session_id)) qm on qm->>'id'=qs->>'id' where qm->>'blockId'=e.block_id::text and qm->>'mode'='UNIQUE_MEMBER' and qm->>'scope'='team' and not (qs->>'done')::boolean) and e.id>coalesce((select r.event_floor from escape_private.block_replays r where r.participant_id=a.id and r.block_id=e.block_id),0) and e.session_id=a.session_id and (a.progress_reset_at is null or e.created_at>=a.progress_reset_at) and
      ((a.mode='individual' and e.participant_id=a.id) or(a.mode='team' and e.event_team=a.team_number))
    union all
    select o.block_id,'complete',p.member_number,p.role_name from public.escape_progress_overrides o
      join public.escape_participants p on p.id=o.participant_id cross join actor a
    where (o.participant_id=a.id or not exists(select 1 from escape_private.block_replays r where r.participant_id=a.id and r.block_id=o.block_id)) and p.session_id=a.session_id and o.action in ('complete','skip') and (a.progress_reset_at is null or o.created_at>=a.progress_reset_at)
      and (o.participant_id=a.id and o.scope='student' or o.scope='team' and o.team_number=a.team_number and p.team_number=a.team_number)
  )
  select jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'member',member_number,'role',role_name) order by member_number) from members),'[]'),
    'events',coalesce((select jsonb_agg(jsonb_build_object('blockId',block_id,'type',event_type,'member',member,'role',role)) from events),'[]'));
$$;

create or replace function escape_private.qr_state(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;m jsonb;v jsonb;scans jsonb;members jsonb;done boolean;total integer;found integer;out jsonb:='[]';
begin
 select * into p from public.escape_participants where id=p_actor;
 select * into s from public.escape_sessions where id=p.session_id;
 for m in select value from jsonb_array_elements(coalesce(s.content_snapshot->'qrMissions','[]')) where (value->>'active')::boolean loop
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'member',a.member_number,'role',a.role_name)),'[]') into members from public.escape_participants a
  where a.session_id=s.id and a.left_at is null and (case when s.content_snapshot->>'playMode'='team' and m->>'scope'='team' then a.team_number=p.team_number else a.id=p.id end);
  select coalesce(jsonb_agg(jsonb_build_object('qrId',q.qr_id,'actorId',q.participant_id,'member',q.event_member,'role',q.event_role)),'[]') into scans
  from public.escape_qr_scans q where q.retired_at is null and q.session_id=s.id and q.mission_id=(m->>'id')::uuid
   and q.subject_key=case when m->>'blockId' is not null and m->>'scope'='student' then 'p:'||p.id else escape_private.result_key(p.id) end and (p.progress_reset_at is null or q.created_at>=p.progress_reset_at)
   and (m->>'scope'='team' or q.participant_id=p.id)
   and exists(select 1 from jsonb_array_elements(m->'codes') c where c->>'id'=q.qr_id::text and (c->>'active')::boolean);
  select count(*) into total from jsonb_array_elements(m->'codes') c where (c->>'active')::boolean;
  found:=jsonb_array_length(scans);
  done:=total>0 and case m->>'mode' when 'ANY' then found>=1 when 'ALL' then found>=total when 'N_OF_M' then found>=(m->>'count')::integer
    when 'UNIQUE_MEMBER' then jsonb_array_length(members)>0 and not exists(select 1 from jsonb_array_elements(members) a where not exists(select 1 from jsonb_array_elements(scans) q where q->>'actorId'=a->>'id')) else false end;
  if m->>'mode'='UNIQUE_MEMBER' then select count(*) into found from jsonb_array_elements(members) a where exists(select 1 from jsonb_array_elements(scans) q where q->>'actorId'=a->>'id');end if;
  out:=out||jsonb_build_array(jsonb_build_object('id',m->>'id','name',m->>'name','mode',m->>'mode','scope',m->>'scope','found',found,'total',total,'done',done,'scans',scans,'required',case m->>'mode' when 'UNIQUE_MEMBER' then jsonb_array_length(members) when 'N_OF_M' then (m->>'count')::integer when 'ALL' then total else 1 end,'selfDone',exists(select 1 from jsonb_array_elements(scans) q where q->>'actorId'=p.id::text),'insufficient',m->>'mode'='UNIQUE_MEMBER' and total<jsonb_array_length(members)));
 end loop;return out;
end; $$;




create function escape_private.unique_qr_claim() returns trigger language plpgsql set search_path='' as $$
declare m jsonb;s public.escape_sessions;
begin
 select * into s from public.escape_sessions where id=new.session_id for update;
 select value into m from jsonb_array_elements(s.content_snapshot->'qrMissions') where value->>'id'=new.mission_id::text;
 if m->>'mode'='UNIQUE_MEMBER' and m->>'scope'='team' and s.content_snapshot->>'playMode'='team' then
  if exists(select 1 from public.escape_qr_scans where session_id=new.session_id and subject_key=new.subject_key and mission_id=new.mission_id and participant_id=new.participant_id and retired_at is null) then raise exception '이미 QR을 찾았습니다. 다른 팀원을 기다려주세요.' using errcode='22023';end if;
  if exists(select 1 from public.escape_qr_scans where session_id=new.session_id and subject_key=new.subject_key and qr_id=new.qr_id and retired_at is null) then raise exception '다른 팀원이 이미 찾은 QR입니다. 다른 QR을 찾아보세요.' using errcode='22023';end if;
 end if;return new;
end;$$;
create trigger escape_unique_qr_claim before insert on public.escape_qr_scans for each row execute function escape_private.unique_qr_claim();
-- The old duplicate probe must ignore retired claims; the authoritative INSERT still enforces uniqueness.
create or replace function escape_private.scan_current_qr_v9(p_token text,p_qr text,p_block uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;b jsonb;m jsonb;q jsonb;v jsonb;state jsonb;done boolean;duplicate boolean;key text;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '먼저 방 코드로 입장하세요.' using errcode='42501';end if;
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 if not found then raise exception '참가 기록을 찾을 수 없습니다.' using errcode='42501';end if;
 select * into s from public.escape_sessions where id=p.session_id for update;
 select * into p from public.escape_participants where id=p.id and left_at is null;
 if p.id is null or s.id is null then raise exception '초기화된 수업입니다.' using errcode='42501';end if;
 if s.status<>'playing' or s.play_version<>1 then raise exception '게임 진행 중에만 QR을 사용할 수 있습니다.' using errcode='22023';end if;
 state:=escape_private.play_state(p.id);
 select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=state->>'currentBlockId';
 if b is null or b->>'type'<>'question' or b->>'questionType'<>'qr' or p_block is not null and b->>'id'<>p_block::text or not(state->'availableIds' ? (b->>'id')) then raise exception '아직 사용할 수 없는 QR입니다.' using errcode='22023';end if;
 select mission,code into m,q from jsonb_array_elements(coalesce(s.content_snapshot->'qrMissions','[]')) mission cross join lateral jsonb_array_elements(mission->'codes') code
 where code->>'token'=p_qr and (mission->>'id'=b->>'qrMissionId' or b->>'qrMissionId' is null and code->>'id'=b->>'qrId');
 if m is null or q is null then raise exception '이 문제의 QR코드가 아닙니다.' using errcode='22023';end if;
 key:=case when m->>'blockId' is not null and m->>'scope'='student' then 'p:'||p.id else escape_private.result_key(p.id) end;
 select exists(select 1 from public.escape_qr_scans where retired_at is null and session_id=s.id and subject_key=key and qr_id=(q->>'id')::uuid) into duplicate;
 v:=escape_private.scan_qr_v7(p_token,p_qr);
 -- 007's team claim remains canonical for team-wide blocks. For scanner-only blocks,
 -- move its validated claim to the participant namespace under the same session lock.
 if key<>escape_private.result_key(p.id) then
  insert into public.escape_qr_scans(session_id,participant_id,mission_id,qr_id,subject_key,event_team,event_member,event_role)
  values(s.id,p.id,(m->>'id')::uuid,(q->>'id')::uuid,key,p.team_number,p.member_number,p.role_name) on conflict do nothing;
  delete from public.escape_qr_scans where retired_at is null and session_id=s.id and subject_key=escape_private.result_key(p.id) and qr_id=(q->>'id')::uuid;
 end if;
 select coalesce((value->>'done')::boolean,false) into done from jsonb_array_elements(escape_private.qr_state(p.id)) where value->>'id'=m->>'id';
 if b->>'qrMissionId' is null then done:=true;end if;
 if done then perform escape_private.complete_block(p.id,b,'student');end if;
 perform escape_private.sync_play(s.id);
 update public.escape_sessions set progress_revision=progress_revision+1 where id=s.id;
 return jsonb_build_object('duplicate',duplicate,'completed',done,'message',case when done then 'QR 문제를 완료했습니다.' when duplicate then '이미 찾은 QR입니다. 다른 QR을 찾아보세요.' else 'QR 단서를 발견했습니다. 다음 QR을 찾아보세요.' end,'game',escape_private.student_projection(p.id));
end; $$;

alter function escape_private.play_context(uuid) rename to play_context_v13;
create function escape_private.play_context(p_actor uuid) returns jsonb language sql stable set search_path='' as $$
 select escape_private.play_context_v13(p_actor)||jsonb_build_object('uniqueBlocks',(select coalesce(jsonb_agg(m->>'blockId'),'[]') from public.escape_participants p join public.escape_sessions s on s.id=p.session_id,jsonb_array_elements(coalesce(s.content_snapshot->'qrMissions','[]')) m where p.id=p_actor and m->>'mode'='UNIQUE_MEMBER' and m->>'scope'='team'),'replayPersonal',coalesce((select jsonb_agg(block_id::text) from escape_private.block_replays where participant_id=p_actor and scope='student'),'[]'));
$$;
alter function escape_private.completed(jsonb,jsonb,integer,boolean) rename to completed_v13;
create function escape_private.completed(p_block jsonb,p_context jsonb,p_index integer,p_individual boolean) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if p_context->'uniqueBlocks' ? (p_block->>'id') then return exists(select 1 from jsonb_array_elements(p_context->'events') e where e->>'blockId'=p_block->>'qrMissionId' and e->>'type'='qr_complete');end if;
 if p_context->'replayPersonal' ? (p_block->>'id') then return exists(select 1 from jsonb_array_elements(p_context->'events') e where e->>'blockId'=p_block->>'id' and e->>'type'='complete' and e->>'member'=p_context->>'actorMember');end if;
 return escape_private.completed_v13(p_block,p_context,p_index,p_individual);
end;$$;
-- Existing role array: assign A/B/C/D by member number; the final configured role repeats.
create function escape_private.assign_current_role() returns trigger language plpgsql set search_path='' as $$
declare doc jsonb;
begin
 select content_snapshot into doc from public.escape_sessions where id=new.session_id;
 if new.member_number is not null and coalesce((doc#>>'{teamSettings,rolesEnabled}')::boolean,false) then new.role_name:=coalesce(doc#>>array['teamSettings','roles',least(new.member_number-1,jsonb_array_length(doc#>'{teamSettings,roles}')-1)::text],'조원');end if;return new;
end;$$;
create trigger escape_assign_current_role before update of member_number,team_number on public.escape_participants for each row execute function escape_private.assign_current_role();
create function escape_private.qr_capacity() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='playing' and old.status='lobby' and new.content_snapshot->>'playMode'='team' and exists(
 select 1 from jsonb_array_elements(coalesce(new.content_snapshot->'qrMissions','[]')) m where m->>'mode'='UNIQUE_MEMBER' and m->>'scope'='team' and (m->>'active')::boolean and
 (select count(*) from jsonb_array_elements(m->'codes') q where (q->>'active')::boolean)<(select coalesce(max(n),0) from(select count(*) n from public.escape_participants where session_id=new.id and left_at is null group by team_number) t)) then
 raise exception '팀원별 서로 다른 QR을 사용하려면 팀원 수 이상의 활성 QR이 필요합니다.' using errcode='22023';end if;return new;
end;$$;
create trigger escape_qr_capacity before update of status on public.escape_sessions for each row execute function escape_private.qr_capacity();
create function escape_private.sync_membership() returns trigger language plpgsql set search_path='' as $$
declare p record;b jsonb;
begin
 if (old.left_at,old.team_number) is distinct from(new.left_at,new.team_number) and exists(select 1 from public.escape_sessions where id=new.session_id and status in ('playing','paused')) then
 update public.escape_qr_scans q set retired_at=now() from public.escape_sessions s,jsonb_array_elements(s.content_snapshot->'qrMissions') m
 where s.id=new.session_id and q.session_id=s.id and q.participant_id=new.id and q.retired_at is null and q.mission_id=(m->>'id')::uuid and m->>'mode'='UNIQUE_MEMBER' and m->>'scope'='team';
 for p in select id from public.escape_participants where session_id=new.session_id and left_at is null loop
 for b in select block from public.escape_sessions s,jsonb_array_elements(s.content_snapshot->'content') block,jsonb_array_elements(escape_private.qr_state(p.id)) qs where s.id=new.session_id and block->>'qrMissionId'=qs->>'id' and qs->>'mode'='UNIQUE_MEMBER' and (qs->>'done')::boolean loop
 perform escape_private.complete_block(p.id,b,'student');end loop;end loop;
 perform escape_private.sync_play(new.session_id);update public.escape_sessions set progress_revision=progress_revision+1 where id=new.session_id;end if;return new;
end;$$;
create trigger escape_sync_membership after update of left_at,team_number on public.escape_participants for each row execute function escape_private.sync_membership();

alter function escape_private.scan_current_qr(text,text,uuid) rename to scan_current_qr_v13;
create function escape_private.scan_current_qr(p_token text,p_qr text,p_block uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare v jsonb;begin v:=escape_private.scan_current_qr_v13(p_token,p_qr,p_block);if v#>>'{qrScan,mode}'='UNIQUE_MEMBER' then v:=jsonb_set(v,'{qrScan,selfDone}','true');end if;return v;end;$$;

-- Explicit departure changes membership; a disconnect/heartbeat never does.
alter function public.escape_student_lobby(text,text,integer,integer,integer,integer,text) set schema escape_private;
alter function escape_private.escape_student_lobby(text,text,integer,integer,integer,integer,text) rename to student_lobby_v13;
create function public.escape_student_lobby(p_token text,p_action text default 'read',p_team integer default null,p_grade integer default null,p_class integer default null,p_number integer default null,p_name text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;
begin
 if p_action='leave' and p_token ~ '^[a-f0-9]{64}$' then
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 select * into s from public.escape_sessions where id=p.session_id for update;
 if s.status='playing' and not exists(select 1 from public.escape_results where session_id=s.id and subject_key=escape_private.result_key(p.id)) then update public.escape_participants set left_at=now(),team_number=null where id=p.id;return jsonb_build_object('left',true);end if;
 end if;
 return escape_private.student_lobby_v13(p_token,p_action,p_team,p_grade,p_class,p_number,p_name);
end;$$;
revoke all on function public.escape_student_lobby(text,text,integer,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.escape_student_lobby(text,text,integer,integer,integer,integer,text) to anon;

-- Retain historical events for audit, but remove them from current-play predicates and unique claims.
alter function public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) set schema escape_private;
alter function escape_private.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) rename to teacher_control_v13;
create function public.escape_teacher_control(p_session uuid,p_action text,p_scope text default 'student',p_participant uuid default null,p_team integer default null,
 p_block uuid default null,p_stage text default null,p_new_team integer default null,p_revision bigint default null,p_request uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.escape_sessions;p public.escape_participants;v jsonb;b jsonb;target_id uuid;target_ord bigint;current_ord bigint;affected uuid[];floor_id bigint;rewound jsonb:='[]';
begin
 select * into s from public.escape_sessions where id=p_session and owner_id=auth.uid() for update;
 if not found then raise exception '본인 수업만 관리할 수 있습니다.' using errcode='42501';end if;
 if exists(select 1 from public.escape_teacher_actions where session_id=s.id and request_id=p_request) then return public.escape_teacher_progress(s.id);end if;
 if p_request is null or p_revision is null or p_revision<>s.progress_revision or s.status not in ('playing','paused') then
 return escape_private.teacher_control_v13(p_session,p_action,p_scope,p_participant,p_team,p_block,p_stage,p_new_team,p_revision,p_request);end if;
 if p_action in ('reset','team') then delete from escape_private.block_replays r using public.escape_participants actor where actor.id=r.participant_id and actor.session_id=s.id and (p_scope='student' and actor.id=p_participant or p_scope='team' and actor.team_number=p_team);end if;
 if p_action in ('move','stage') then
  select (value->>'id')::uuid,ord into target_id,target_ord from jsonb_array_elements(s.content_snapshot->'content') with ordinality x(value,ord)
   where p_action='move' and value->>'id'=p_block::text or p_action='stage' and value->>'stage'=p_stage order by ord limit 1;
  select coalesce(max(id),0) into floor_id from public.escape_events where session_id=s.id;
  for p in select * from public.escape_participants where session_id=s.id and left_at is null and (p_scope='student' and id=p_participant or p_scope='team' and team_number=p_team) loop
   select ord into current_ord from jsonb_array_elements(s.content_snapshot->'content') with ordinality x(value,ord) where value->>'id'=p.progress->>'currentBlockId';
   if current_ord is null and (p.progress->>'completedCount')::integer=(p.progress->>'totalCount')::integer then current_ord:=jsonb_array_length(s.content_snapshot->'content')+1;end if;
   if target_ord<current_ord then
    for b in select value from jsonb_array_elements(s.content_snapshot->'content') with ordinality x(value,ord) where ord>=target_ord loop
     if b->>'questionType'='qr' and b->>'qrMissionId' is null then
      select b||jsonb_build_object('qrMissionId',mission->>'id') into b from jsonb_array_elements(s.content_snapshot->'qrMissions') mission where exists(select 1 from jsonb_array_elements(mission->'codes') code where code->>'id'=b->>'qrId');
     end if;
     affected:=array[p.id];
     if s.content_snapshot->>'playMode'='team' and b->>'questionType'='qr' and b->>'qrScope'='team' then
      select array_agg(id) into affected from public.escape_participants where session_id=s.id and left_at is null and team_number=p.team_number;
     elsif p_scope='student' and s.content_snapshot->>'playMode'='team' then
      -- Other students retain their already-completed personal view when only this student's events retire.
      insert into public.escape_progress_overrides(participant_id,block_id,action,scope,team_number)
       select id,(b->>'id')::uuid,'complete','student',team_number from public.escape_participants where session_id=s.id and team_number=p.team_number and id<>p.id and left_at is null and progress->'completedIds' ? (b->>'id') on conflict do nothing;
     end if;
     insert into escape_private.block_replays(participant_id,block_id,event_floor,scope)
      select a,(b->>'id')::uuid,floor_id,case when cardinality(affected)>1 or p_scope='team' then 'team' else 'student' end from unnest(affected) a
      on conflict(participant_id,block_id) do update set event_floor=excluded.event_floor,scope=excluded.scope,created_at=now();
     update public.escape_events set retired_at=now() where session_id=s.id and participant_id=any(affected) and block_id=(b->>'id')::uuid and retired_at is null;
     update public.escape_qr_scans set retired_at=now() where session_id=s.id and retired_at is null and mission_id=(b->>'qrMissionId')::uuid and
      (b->>'qrScope'='team' and s.content_snapshot->>'playMode'='team' and subject_key='t:'||p.team_number or participant_id=any(affected));
     delete from public.escape_progress_overrides where participant_id=any(affected) and block_id=(b->>'id')::uuid;
     delete from public.escape_submission_receipts where participant_id=any(affected) and block_id=(b->>'id')::uuid;
     update public.escape_block_progress set completed_at=null where participant_id=any(affected) and block_id=(b->>'id')::uuid;
     update escape_private.question_timing set timing_known=false,completed=false,active=false,elapsed_ms=0 where session_id=s.id and block_id=(b->>'id')::uuid and subject_key in(select escape_private.result_key(a) from unnest(affected) a);
     rewound:=rewound||jsonb_build_array(jsonb_build_object('blockId',b->>'id','participants',to_jsonb(affected)));
    end loop;
   end if;
  end loop;
 end if;
 v:=escape_private.teacher_control_v13(p_session,p_action,p_scope,p_participant,p_team,p_block,p_stage,p_new_team,p_revision,p_request);
 if jsonb_array_length(rewound)>0 then update public.escape_teacher_actions set details=details||jsonb_build_object('rewound',rewound) where session_id=s.id and request_id=p_request;end if;
 return public.escape_teacher_progress(s.id);
end;$$;

alter function escape_private.public_block(jsonb) rename to public_block_v13;
create function escape_private.public_block(p_block jsonb) returns jsonb language sql immutable set search_path='' as $$
 select escape_private.public_block_v13(p_block)||jsonb_build_object('chatEnabled',coalesce((p_block->>'chatEnabled')::boolean,false));
$$;
create table public.escape_chat_rooms(
 id uuid primary key default gen_random_uuid(),session_id uuid not null references public.escape_sessions(id) on delete cascade,team_number integer not null,
 source_id uuid not null,name text not null,topic text not null default('chat:'||gen_random_uuid()::text||gen_random_uuid()::text),created_at timestamptz not null default now(),unique(session_id,team_number,source_id)
);
create table public.escape_chat_messages(
 id bigint generated always as identity primary key,room_id uuid not null references public.escape_chat_rooms(id) on delete cascade,
 participant_id uuid not null references public.escape_participants(id) on delete cascade,request_id uuid not null,display_name text not null,
 message text not null check(length(btrim(message)) between 1 and 1000 and message ~ '[^[:space:]]'),created_at timestamptz not null default now(),unique(room_id,participant_id,request_id)
);
create index escape_chat_history on public.escape_chat_messages(room_id,id desc);
alter table public.escape_chat_rooms enable row level security;alter table public.escape_chat_messages enable row level security;
revoke all on public.escape_chat_rooms,public.escape_chat_messages from public,anon,authenticated;
revoke all on sequence public.escape_chat_messages_id_seq from public,anon,authenticated;
create function escape_private.chat_allowed(p_actor uuid,p_source uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.escape_participants p join public.escape_sessions s on s.id=p.session_id,
 jsonb_array_elements(coalesce(s.content_snapshot->'chatRooms','[]')) c,jsonb_array_elements(s.content_snapshot->'content') b
 where p.id=p_actor and p.left_at is null and p.team_number is not null and s.content_snapshot->>'playMode'='team' and s.status in ('playing','paused')
 and b->>'id'=(escape_private.play_state(p.id)->>'currentBlockId') and coalesce((b->>'chatEnabled')::boolean,false) and b->'chatRoomIds' ? p_source::text
 and c->>'id'=p_source::text and (c->>'scope'='team' or c->>'scope'='roles' and c->'roles' ? p.role_name));
$$;
create function public.escape_chat(p_token text,p_action text default 'list',p_room uuid default null,p_text text default null,p_request uuid default null,p_before bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;c jsonb;r public.escape_chat_rooms;v jsonb;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '참가 확인이 필요합니다.' using errcode='42501';end if;
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 if not found then raise exception '참가 기록을 찾을 수 없습니다.' using errcode='42501';end if;
 select * into s from public.escape_sessions where id=p.session_id for update;
 select * into p from public.escape_participants where id=p.id and left_at is null;
 if p.id is null or s.id is null or s.status not in ('playing','paused') or s.content_snapshot->>'playMode'<>'team' then raise exception '이 수업에서 채팅을 사용할 수 없습니다.' using errcode='42501';end if;
 if p_action='list' then
  for c in select value from jsonb_array_elements(coalesce(s.content_snapshot->'chatRooms','[]')) loop
   if escape_private.chat_allowed(p.id,(c->>'id')::uuid) then insert into public.escape_chat_rooms(session_id,team_number,source_id,name) values(s.id,p.team_number,(c->>'id')::uuid,c->>'name') on conflict do nothing;end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id',cr.id,'name',cr.name,'topic',cr.topic,'count',(select count(*) from public.escape_chat_messages m where m.room_id=cr.id)) order by cr.created_at,cr.id),'[]') into v from public.escape_chat_rooms cr where cr.session_id=s.id and cr.team_number=p.team_number and escape_private.chat_allowed(p.id,cr.source_id);
  return jsonb_build_object('sessionId',s.id,'participantId',p.id,'rooms',v);
 end if;
 select * into r from public.escape_chat_rooms where id=p_room and session_id=s.id and team_number=p.team_number;
 if r.id is null or not escape_private.chat_allowed(p.id,r.source_id) then raise exception '참여할 수 없는 채팅방입니다.' using errcode='42501';end if;
 if p_action='send' then
  if s.status<>'playing' then raise exception '일시정지 중에는 메시지를 보낼 수 없습니다.' using errcode='22023';end if;
  if p_request is null or p_text is null or p_text !~ '[^[:space:]]' or length(btrim(p_text)) not between 1 and 1000 then raise exception '메시지는 1~1000자로 입력하세요.' using errcode='22023';end if;
  if not exists(select 1 from public.escape_chat_messages where room_id=r.id and participant_id=p.id and request_id=p_request) then
   if (select count(*) from public.escape_chat_messages where participant_id=p.id and created_at>now()-interval '5 seconds')>=10 then raise exception '잠시 기다린 뒤 전송하세요.' using errcode='22023';end if;
   insert into public.escape_chat_messages(room_id,participant_id,request_id,display_name,message) values(r.id,p.id,p_request,case when coalesce((s.content_snapshot#>>'{teamSettings,rolesEnabled}')::boolean,false) then p.role_name else p.display_name end,btrim(p_text));
   perform realtime.send('{}'::jsonb,'changed',r.topic,false);
  end if;
 elsif p_action<>'read' or p_action is null then raise exception '지원하지 않는 채팅 작업입니다.' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'mine',m.participant_id=p.id,'name',m.display_name,'text',m.message,'at',m.created_at) order by m.id),'[]') into v
 from(select * from public.escape_chat_messages where room_id=r.id and (p_before is null or id<p_before) order by id desc limit 100)m;
 return jsonb_build_object('roomId',r.id,'messages',v,'count',(select count(*) from public.escape_chat_messages where room_id=r.id));
end;$$;
create function escape_private.clear_session_chat() returns trigger language plpgsql set search_path='' as $$
begin if new.status='finished' and old.status<>'finished' then delete from public.escape_chat_rooms where session_id=new.id;end if;return new;end;$$;
create trigger escape_clear_session_chat after update of status on public.escape_sessions for each row execute function escape_private.clear_session_chat();
alter function escape_private.assert_runnable(jsonb) rename to assert_runnable_v13;
create function escape_private.assert_runnable(doc jsonb) returns void language plpgsql set search_path='' as $$
declare c jsonb;b jsonb;ids text[]:='{}';
begin
 perform escape_private.assert_runnable_v13(doc);
 if jsonb_typeof(coalesce(doc->'chatRooms','[]'))<>'array' or jsonb_array_length(coalesce(doc->'chatRooms','[]'))>32 then raise exception '채팅방 설정을 확인하세요.' using errcode='22023';end if;
 for c in select value from jsonb_array_elements(coalesce(doc->'chatRooms','[]')) loop
  if c->>'id' is null or c->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or c->>'id'=any(ids) or length(btrim(coalesce(c->>'name',''))) not between 1 and 80 or c->>'scope' is null or c->>'scope' not in ('team','roles') or jsonb_typeof(c->'roles') is distinct from 'array' then raise exception '채팅방 이름·참여 범위를 확인하세요.' using errcode='22023';end if;
  ids:=array_append(ids,c->>'id');
  if c->>'scope'='roles' and (not coalesce((doc#>>'{teamSettings,rolesEnabled}')::boolean,false) or jsonb_array_length(c->'roles')=0 or exists(select 1 from jsonb_array_elements_text(c->'roles') r where not(doc#>'{teamSettings,roles}' ? r))) then raise exception '채팅 참여 역할을 확인하세요.' using errcode='22023';end if;
 end loop;
 for b in select value from jsonb_array_elements(doc->'content') loop
  if coalesce((b->>'chatEnabled')::boolean,false) and (jsonb_typeof(b->'chatRoomIds') is distinct from 'array' or jsonb_array_length(b->'chatRoomIds')=0 or exists(select 1 from jsonb_array_elements_text(b->'chatRoomIds') r where not(r=any(ids)))) then raise exception '블록에 채팅방을 연결하세요.' using errcode='22023';end if;
 end loop;
end;$$;
-- Old versions permitted multiple claims per member. Keep the earliest active contribution,
-- retaining surplus/departed claims as retired history instead of consuming another member's QR.
with ranked as (
 select q.id,row_number() over(partition by q.session_id,q.subject_key,q.mission_id,q.participant_id order by q.id) n,
 p.left_at is not null or q.subject_key<>'t:'||p.team_number stale
 from public.escape_qr_scans q join public.escape_participants p on p.id=q.participant_id join public.escape_sessions s on s.id=q.session_id,
 jsonb_array_elements(s.content_snapshot->'qrMissions') m where q.mission_id=(m->>'id')::uuid and m->>'mode'='UNIQUE_MEMBER' and m->>'scope'='team' and q.retired_at is null and s.status<>'finished'
) update public.escape_qr_scans q set retired_at=now() from ranked r where r.id=q.id and (r.n>1 or r.stale);
revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on escape_private.block_replays from public,anon,authenticated;
revoke all on function public.escape_chat(text,text,uuid,text,uuid,bigint),public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) from public,anon,authenticated;
grant execute on function public.escape_chat(text,text,uuid,text,uuid,bigint) to anon;
grant execute on function public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
