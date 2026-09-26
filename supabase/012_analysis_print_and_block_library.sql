-- Apply once after 011. Never rewrite earlier migrations or running content snapshots.
begin;

create table public.escape_block_library (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(title)<=200),type text not null check(type in ('story','guide','question')),
 tags text[] not null default '{}' check(cardinality(tags)<=30),payload jsonb not null,
 created_at timestamptz not null default now(),
 check(coalesce(octet_length(payload::text)<=1000000 and payload->>'version'='1' and jsonb_typeof(payload->'block')='object' and jsonb_typeof(payload->'qrMissions')='array' and payload#>>'{block,type}'=type,false))
);
create index escape_block_library_owner on public.escape_block_library(owner_id,created_at desc);
alter table public.escape_block_library enable row level security;
revoke all on public.escape_block_library from public,anon,authenticated;
grant select,insert,update,delete on public.escape_block_library to authenticated;
create policy escape_library_owner on public.escape_block_library to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());

alter function escape_private.media_referenced(text) rename to media_referenced_v11;
create function escape_private.media_referenced(p_path text) returns boolean language sql volatile security definer set search_path='' as $$
 select escape_private.media_referenced_v11(p_path) or exists(select 1 from public.escape_block_library where p_path in(select escape_private.media_paths(payload)));
$$;
create function escape_private.protect_library_media() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(711011);
 if exists(select 1 from escape_private.media_retired where path in(select escape_private.media_paths(new.payload))) then raise exception '이미 삭제된 업로드 파일입니다. 자료를 다시 업로드하세요.' using errcode='22023';end if;
 return new;
end;$$;
create trigger escape_library_media_refs before insert or update of payload on public.escape_block_library for each row execute function escape_private.protect_library_media();

-- Previous running classes have no reliable question-entry timestamps. Do not invent them.
alter table public.escape_sessions add column analysis_enabled boolean not null default false;
alter table public.escape_sessions alter column analysis_enabled set default true;
create table escape_private.question_timing (
 session_id uuid not null references public.escape_sessions(id) on delete cascade,
 subject_key text not null,block_id uuid not null,
 active boolean not null default false,active_since_ms bigint,elapsed_ms bigint not null default 0,
 last_activity_ms bigint not null,completed boolean not null default false,timing_known boolean not null default true,
 primary key(session_id,subject_key,block_id)
);
revoke all on escape_private.question_timing from public,anon,authenticated;
create function escape_private.analysis_start() returns trigger language plpgsql set search_path='' as $$
begin if old.status='lobby' and new.status='playing' then new.analysis_enabled:=true;end if;return new;end;$$;
create trigger escape_analysis_start before update of status on public.escape_sessions for each row execute function escape_private.analysis_start();

create function escape_private.sync_question_timing(p_session uuid) returns void language plpgsql set search_path='' as $$
declare s public.escape_sessions;r record;t escape_private.question_timing;ms bigint;is_active boolean;
begin
 select * into s from public.escape_sessions where id=p_session;if not s.analysis_enabled or s.started_at is null then return;end if;
 ms:=(escape_private.play_timing(s.id)->>'elapsedMs')::bigint;
 for r in select g.subject_key,(b->>'id')::uuid block_id,
  exists(select 1 from public.escape_participants p where p.id=any(g.member_ids) and p.progress->>'currentBlockId'=b->>'id' and not(coalesce(p.progress->'completedIds','[]') ? (b->>'id'))) current,
  not exists(select 1 from public.escape_participants p where p.id=any(g.member_ids) and not(coalesce(p.progress->'completedIds','[]') ? (b->>'id'))) done,
  exists(select 1 from public.escape_progress_overrides o where o.participant_id=any(g.member_ids) and o.block_id=(b->>'id')::uuid and o.action in ('complete','skip')) forced
  from escape_private.result_groups(s.id) g cross join jsonb_array_elements(s.content_snapshot->'content') b where b->>'type'='question'
 loop
  is_active:=r.current and not r.done and s.status in ('playing','paused');
  select * into t from escape_private.question_timing where session_id=s.id and subject_key=r.subject_key and block_id=r.block_id;
  if not found then
   if is_active or r.done then insert into escape_private.question_timing(session_id,subject_key,block_id,active,active_since_ms,last_activity_ms,completed,timing_known)
    values(s.id,r.subject_key,r.block_id,is_active,case when is_active then ms end,ms,r.done,is_active and not r.forced);end if;
  elsif t.active is distinct from is_active or t.completed is distinct from r.done or r.forced and t.timing_known then
   update escape_private.question_timing set
    elapsed_ms=case when t.completed and not r.done then 0 else t.elapsed_ms+case when t.active and not is_active then greatest(0,ms-t.active_since_ms) else 0 end end,
    active_since_ms=case when is_active then case when t.active then t.active_since_ms else ms end end,
    last_activity_ms=case when is_active and not t.active then ms else t.last_activity_ms end,
    active=is_active,completed=r.done,timing_known=t.timing_known and not r.forced and not(t.completed and not r.done)
   where session_id=s.id and subject_key=r.subject_key and block_id=r.block_id;
  end if;
 end loop;
 -- Departed subjects stop accumulating time and cannot appear in delay warnings.
 update escape_private.question_timing q set elapsed_ms=q.elapsed_ms+greatest(0,ms-q.active_since_ms),active=false,active_since_ms=null
 where q.session_id=s.id and q.active and not exists(select 1 from escape_private.result_groups(s.id) g where g.subject_key=q.subject_key);
end;$$;
create function escape_private.question_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin perform escape_private.sync_question_timing(new.id);return new;end;$$;
create trigger zz_escape_question_revision after update of progress_revision,status on public.escape_sessions for each row execute function escape_private.question_revision();

-- Only new accepted attempts/hints/scans count as activity. Reads, reconnects and retries do not.
create function escape_private.question_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;bid uuid;
begin
 select * into p from public.escape_participants where id=new.participant_id;select * into s from public.escape_sessions where id=p.session_id;
 if not s.analysis_enabled or s.status<>'playing' then return new;end if;
 if tg_table_name='escape_qr_scans' then select (b->>'blockId')::uuid into bid from jsonb_array_elements(s.content_snapshot->'qrMissions') b where b->>'id'=new.mission_id::text;
 else bid:=new.block_id;end if;
 update escape_private.question_timing set last_activity_ms=(escape_private.play_timing(s.id)->>'elapsedMs')::bigint where session_id=s.id and subject_key=escape_private.result_key(p.id) and block_id=bid and not completed;
 return new;
end;$$;
create trigger escape_question_attempt after insert on public.escape_submission_receipts for each row execute function escape_private.question_activity();
create trigger escape_question_hint after insert on public.escape_hint_uses for each row execute function escape_private.question_activity();
create trigger escape_question_scan after insert on public.escape_qr_scans for each row execute function escape_private.question_activity();

-- A teacher reset/team move invalidates exact historical timing for affected groups only.
create function escape_private.question_reassignment() returns trigger language plpgsql security definer set search_path='' as $$
declare mode text;ms bigint;
begin
 if new.team_number is not distinct from old.team_number and new.progress_reset_at is not distinct from old.progress_reset_at then return new;end if;
 select content_snapshot->>'playMode' into mode from public.escape_sessions where id=new.session_id;
 ms:=(escape_private.play_timing(new.session_id)->>'elapsedMs')::bigint;
 update escape_private.question_timing set timing_known=false,active=false,active_since_ms=null,elapsed_ms=0,completed=false,last_activity_ms=ms
 where session_id=new.session_id and (mode='individual' and subject_key='p:'||new.id or mode='team' and subject_key in ('t:'||old.team_number,'t:'||new.team_number));
 return new;
end;$$;
create trigger escape_question_reassignment after update of team_number,progress_reset_at on public.escape_participants for each row execute function escape_private.question_reassignment();

create function escape_private.question_analysis(p_session uuid) returns jsonb language sql stable set search_path='' as $$
 with s as(select * from public.escape_sessions where id=p_session),groups as(select g.* from s cross join lateral escape_private.result_groups(s.id) g),
 questions as(select b,n from s cross join jsonb_array_elements(s.content_snapshot->'content') with ordinality x(b,n) where b->>'type'='question'),
 stats as(select b,n,g.subject_key,
  not exists(select 1 from public.escape_participants p where p.id=any(g.member_ids) and not(coalesce(p.progress->'completedIds','[]') ? (b->>'id'))) done,
  (select coalesce(sum(wrong_count),0) from public.escape_block_progress where participant_id=any(g.member_ids) and block_id=(b->>'id')::uuid) wrongs,
  (select count(*) from public.escape_hint_uses where participant_id=any(g.member_ids) and block_id=(b->>'id')::uuid) hints,
  case when t.completed and t.timing_known then t.elapsed_ms end elapsed
  from questions cross join groups g left join escape_private.question_timing t on t.session_id=p_session and t.subject_key=g.subject_key and t.block_id=(b->>'id')::uuid),
 rows as(select q.b,q.n,count(a.subject_key) total,count(a.subject_key) filter(where a.done) completed,coalesce(sum(a.wrongs),0) wrongs,
  case when count(a.subject_key)>0 then round(avg(a.wrongs),2) end average_wrong,coalesce(sum(a.hints),0) hints,round(avg(a.elapsed) filter(where a.done)) average_ms,count(a.elapsed) filter(where a.done) timed
  from questions q left join stats a on a.b->>'id'=q.b->>'id' group by q.b,q.n)
 select jsonb_build_object('unit',case when (select content_snapshot->>'playMode' from s)='team' then 'team' else 'student' end,
 'timingTracked',coalesce((select analysis_enabled from s),false),'questions',coalesce(jsonb_agg(jsonb_build_object('blockId',b->>'id','title',b->>'title','total',total,'completed',completed,'wrongTotal',wrongs,'wrongAverage',average_wrong,'hintTotal',hints,'averageSolveMs',average_ms,'timedCount',timed) order by n),'[]')) from rows;
$$;
create function escape_private.question_delays(p_session uuid) returns jsonb language sql stable set search_path='' as $$
 with s as(select *,coalesce((content_snapshot#>>'{rules,delayMinutes}')::integer,3)*60000 threshold from public.escape_sessions where id=p_session),
 rows as(select distinct on(q.subject_key) q.subject_key,g.label,q.block_id,b->>'title' title,q.last_activity_ms
 from s join escape_private.question_timing q on q.session_id=s.id cross join lateral escape_private.result_groups(s.id) g cross join jsonb_array_elements(s.content_snapshot->'content') b
 where s.status='playing' and s.threshold>0 and q.active and not q.completed and q.subject_key=g.subject_key and b->>'type'='question' and b->>'id'=q.block_id::text order by q.subject_key,q.last_activity_ms,q.block_id)
 select jsonb_build_object('thresholdMs',(select threshold from s),'elapsedMs',escape_private.play_timing(p_session)->'elapsedMs',
 'rows',coalesce(jsonb_agg(jsonb_build_object('subject',subject_key,'label',label,'blockId',block_id,'title',title,'lastActivityMs',last_activity_ms)),'[]')) from rows;
$$;

alter function public.escape_teacher_progress(uuid,text,uuid,uuid) set schema escape_private;
alter function escape_private.escape_teacher_progress(uuid,text,uuid,uuid) rename to teacher_progress_v11;
create function public.escape_teacher_progress(p_session uuid,p_action text default 'read',p_participant uuid default null,p_block uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;begin
 v:=escape_private.teacher_progress_v11(p_session,p_action,p_participant,p_block);
 return v||jsonb_build_object('questionAnalysis',escape_private.question_analysis(p_session),'delayState',escape_private.question_delays(p_session));
end;$$;
create function escape_private.archive_question_analysis() returns trigger language plpgsql security definer set search_path='' as $$
begin new.summary:=new.summary||jsonb_build_object('questionAnalysis',escape_private.question_analysis(new.source_session));return new;end;$$;
create trigger escape_archive_question_analysis before insert on public.escape_result_archives for each row execute function escape_private.archive_question_analysis();

alter function escape_private.assert_runnable(jsonb) rename to assert_runnable_v11;
create function escape_private.assert_runnable(doc jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform escape_private.assert_runnable_v11(doc);
 if doc#>'{rules,delayMinutes}' is not null and (jsonb_typeof(doc#>'{rules,delayMinutes}')<>'number' or (doc#>>'{rules,delayMinutes}')::numeric not between 0 and 10 or (doc#>>'{rules,delayMinutes}')::numeric<>trunc((doc#>>'{rules,delayMinutes}')::numeric)) then raise exception '진행 지연 기준은 0(OFF) 또는 1~10분입니다.' using errcode='22023';end if;
end;$$;
revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_teacher_progress(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.escape_teacher_progress(uuid,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
