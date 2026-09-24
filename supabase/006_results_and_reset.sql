-- Apply once after 001..005. No public table writes or answer access are added.
begin;
create table public.escape_hint_uses (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.escape_sessions(id) on delete cascade,
  participant_id uuid not null references public.escape_participants(id) on delete cascade,
  subject_key text not null,block_id uuid not null,stage text not null,hint_index integer not null,
  request_id uuid not null,created_at timestamptz not null default now(),
  unique(session_id,subject_key,block_id,hint_index),unique(participant_id,request_id)
);
create table public.escape_results (
  session_id uuid not null references public.escape_sessions(id) on delete cascade,
  subject_key text not null,member_ids uuid[] not null,label text not null,
  started_at timestamptz not null,arrived_at timestamptz not null,
  elapsed_ms bigint not null,paused_ms bigint not null,wall_ms bigint not null,
  wrong_count integer not null,hint_count integer not null,base_score numeric not null,final_score numeric not null,
  wrong_penalty_ms bigint not null,hint_penalty_ms bigint not null,
  primary key(session_id,subject_key)
);
create table public.escape_result_archives (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.escape_contents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_session uuid not null unique,created_at timestamptz not null default now(),summary jsonb not null
);
create table public.escape_reset_receipts (
  request_id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references public.escape_contents(id) on delete cascade,
  old_session uuid not null,new_session uuid not null,created_at timestamptz not null default now()
);
alter table public.escape_hint_uses enable row level security;
alter table public.escape_results enable row level security;
alter table public.escape_result_archives enable row level security;
alter table public.escape_reset_receipts enable row level security;
revoke all on public.escape_hint_uses,public.escape_results,public.escape_result_archives,public.escape_reset_receipts from public,anon,authenticated;
revoke all on sequence public.escape_hint_uses_id_seq from public,anon,authenticated;

create function escape_private.result_rules(p_document jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('ranking','none','rankVisibility','end','scoreEnabled',false,'finishMode','all','hints','unlimited','hintLimit',3,
 'hintPenalty',0,'wrongPenalty',0,'hintPenaltyType','time','wrongPenaltyType','time')||coalesce(p_document->'rules','{}');
$$;
create function escape_private.result_key(p_actor uuid) returns text language sql stable set search_path='' as $$
 select case when s.content_snapshot->>'playMode'='team' then 't:'||p.team_number else 'p:'||p.id end
 from public.escape_participants p join public.escape_sessions s on s.id=p.session_id where p.id=p_actor;
$$;
create function escape_private.hint_key(p_actor uuid) returns text language sql stable set search_path='' as $$
 select case when s.content_snapshot->>'playMode'='team' and s.content_snapshot#>>'{rules,hints}'='team' then 't:'||p.team_number else 'p:'||p.id end
 from public.escape_participants p join public.escape_sessions s on s.id=p.session_id where p.id=p_actor;
$$;
create function escape_private.result_groups(p_session uuid) returns table(subject_key text,label text,member_ids uuid[],done boolean,wrong_count integer,hint_count integer,base_score numeric)
language sql stable set search_path='' as $$
 with config as (select content_snapshot doc,escape_private.result_rules(content_snapshot) rules from public.escape_sessions where id=p_session),
 groups as (select escape_private.result_key(p.id) key,
 case when c.doc->>'playMode'='team' then p.team_number||'조' else p.grade||'-'||p.classroom||'-'||p.student_number||' '||p.display_name end name,
 array_agg(p.id order by p.id) ids,
 bool_and(case when c.rules->>'finishMode'='final' then p.progress->'completedIds' ? (c.rules->>'finalBlockId') and not(p.progress->'availableIds' ? (c.rules->>'finalBlockId')) else
 (p.progress->>'totalCount')::integer>0 and p.progress->>'completedCount'=p.progress->>'totalCount' and jsonb_array_length(p.progress->'availableIds')=0 end) finished
 from public.escape_participants p cross join config c where p.session_id=p_session and p.left_at is null
 group by key,name),
 scored as (select g.*,(select coalesce(sum(greatest(0,(b->>'points')::numeric)),0) from config c,jsonb_array_elements(c.doc->'content') b
 where b->>'type'='question' and not exists(select 1 from public.escape_participants p where p.id=any(g.ids) and not(p.progress->'completedIds' ? (b->>'id')))) points from groups g)
 select key,name,ids,coalesce(finished,false),
 (select coalesce(sum(wrong_count),0)::integer from public.escape_block_progress where participant_id=any(ids)),
 (select count(*)::integer from public.escape_hint_uses where participant_id=any(ids)),points from scored;
$$;
create function escape_private.capture_results(p_session uuid) returns void language plpgsql set search_path='' as $$
declare s public.escape_sessions; r jsonb; g record; timing jsonb; wp bigint; hp bigint; score numeric;
begin
 select * into s from public.escape_sessions where id=p_session;
 if s.started_at is null or s.play_version<>1 then return; end if;
 r:=escape_private.result_rules(s.content_snapshot);timing:=escape_private.play_timing(s.id);
 for g in select * from escape_private.result_groups(s.id) where done loop
  wp:=case when r->>'wrongPenaltyType'='time' then g.wrong_count*(r->>'wrongPenalty')::numeric*1000 else 0 end;
  hp:=case when r->>'hintPenaltyType'='time' then g.hint_count*(r->>'hintPenalty')::numeric*1000 else 0 end;
  score:=greatest(0,g.base_score-case when r->>'wrongPenaltyType'='score' then g.wrong_count*(r->>'wrongPenalty')::numeric else 0 end-case when r->>'hintPenaltyType'='score' then g.hint_count*(r->>'hintPenalty')::numeric else 0 end);
  insert into public.escape_results(session_id,subject_key,member_ids,label,started_at,arrived_at,elapsed_ms,paused_ms,wall_ms,wrong_count,hint_count,base_score,final_score,wrong_penalty_ms,hint_penalty_ms)
  values(s.id,g.subject_key,g.member_ids,g.label,s.started_at,now(),(timing->>'elapsedMs')::bigint,
    greatest(0,floor(extract(epoch from(now()-s.started_at))*1000)::bigint-(timing->>'elapsedMs')::bigint),
    greatest(0,floor(extract(epoch from(now()-s.started_at))*1000)::bigint),g.wrong_count,g.hint_count,g.base_score,score,wp,hp) on conflict do nothing;
 end loop;
end; $$;
create function escape_private.results_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin perform escape_private.capture_results(new.id);return new;end; $$;
create trigger escape_capture_results after update of progress_revision,status on public.escape_sessions for each row
 when(new.status in ('playing','paused','finished')) execute function escape_private.results_changed();

create function escape_private.result_board(p_session uuid) returns jsonb language sql stable set search_path='' as $$
 with config as (select escape_private.result_rules(content_snapshot) rules from public.escape_sessions where id=p_session),
 ranked as (select r.*,case when c.rules->>'ranking'='time_wrong' then elapsed_ms+wrong_penalty_ms
 when c.rules->>'ranking'='time_hint' then elapsed_ms+hint_penalty_ms when c.rules->>'ranking'='combined' then elapsed_ms+wrong_penalty_ms+hint_penalty_ms else elapsed_ms end rank_ms,c.rules
 from public.escape_results r cross join config c where session_id=p_session),
 numbered as (select *,row_number() over(order by case when rules->>'ranking'='score' then final_score end desc,case when rules->>'ranking'<>'score' then rank_ms end,elapsed_ms,arrived_at,subject_key) position from ranked)
 select coalesce(jsonb_agg(jsonb_build_object('subject',subject_key,'label',label,'memberIds',member_ids,'startedAt',started_at,'arrivedAt',arrived_at,
 'elapsedMs',elapsed_ms,'pausedMs',paused_ms,'wallMs',wall_ms,'wrongCount',wrong_count,'hintCount',hint_count,'baseScore',base_score,
 'score',case when coalesce((rules->>'scoreEnabled')::boolean,false) or rules->>'ranking'='score' then final_score else null end,
 'penaltyMs',wrong_penalty_ms+hint_penalty_ms,'rankTimeMs',rank_ms,'rank',case when rules->>'ranking'<>'none' then position else null end) order by position),'[]') from numbered;
$$;
create function escape_private.results_summary(p_session uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('results',escape_private.result_board(s.id),'total',count(g.subject_key),'completed',count(r.subject_key),
 'allComplete',count(g.subject_key)>0 and count(g.subject_key)=count(r.subject_key),
 'unfinished',coalesce(jsonb_agg(jsonb_build_object('subject',g.subject_key,'label',g.label,'wrongCount',g.wrong_count,'hintCount',g.hint_count)) filter(where r.subject_key is null and g.subject_key is not null),'[]'))
 from public.escape_sessions s left join lateral escape_private.result_groups(s.id) g on true
 left join public.escape_results r on r.session_id=s.id and r.subject_key=g.subject_key where s.id=p_session group by s.id;
$$;
alter function escape_private.student_projection(uuid) rename to student_projection_v5;
create function escape_private.student_projection(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;r jsonb;v jsonb;own jsonb;board jsonb;hints jsonb; b jsonb;summary jsonb;visible boolean;used integer;
begin
 select * into p from public.escape_participants where id=p_actor; select * into s from public.escape_sessions where id=p.session_id;
 r:=escape_private.result_rules(s.content_snapshot);v:=escape_private.student_projection_v5(p_actor);board:=escape_private.result_board(s.id);summary:=escape_private.results_summary(s.id);
 select value into own from jsonb_array_elements(board) where value->>'subject'=escape_private.result_key(p_actor);
 visible:=r->>'ranking'<>'none' and (r->>'rankVisibility'='live' or r->>'rankVisibility'='end' and s.status='finished');
 if own is not null then
  own:=own-'memberIds';if not visible then own:=own-'rank';end if;
  v:=v||jsonb_build_object('current',null,'available','[]'::jsonb);
 end if;
 select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=v#>>'{current,id}';
 select coalesce(jsonb_agg(b->'hints'->h.hint_index order by h.hint_index),'[]') into hints from public.escape_hint_uses h where h.session_id=s.id and h.subject_key=escape_private.hint_key(p_actor) and h.block_id=(b->>'id')::uuid;
 select count(*) into used from public.escape_hint_uses h join public.escape_participants actor on actor.id=h.participant_id where h.session_id=s.id and
 case r->>'hints' when 'individual' then h.participant_id=p.id when 'team' then case when s.content_snapshot->>'playMode'='individual' then h.participant_id=p.id else actor.team_number is not distinct from p.team_number end when 'stage' then h.stage=b->>'stage' else true end;
 return v||jsonb_build_object('title',s.content_snapshot->>'title','playMode',s.content_snapshot->>'playMode','result',own,
 'successMessage',s.content_snapshot->>'successMessage','allComplete',summary->'allComplete','rankVisible',visible,
 'leaderboard',case when visible then (select coalesce(jsonb_agg(jsonb_build_object('label',x->'label','rank',x->'rank','elapsedMs',x->'elapsedMs','rankTimeMs',x->'rankTimeMs','score',x->'score')),'[]') from jsonb_array_elements(board) x) else '[]'::jsonb end,
 'revealedHints',hints,'hasMoreHints',b is not null and jsonb_array_length(coalesce(b->'hints','[]'))>jsonb_array_length(hints) and (r->>'hints'='unlimited' or used<(r->>'hintLimit')::integer));
end; $$;

alter function public.escape_student_play(text,text,uuid,jsonb,uuid) set schema escape_private;
alter function escape_private.escape_student_play(text,text,uuid,jsonb,uuid) rename to student_play_v3;
create function public.escape_student_play(p_token text,p_action text default 'read',p_block uuid default null,p_input jsonb default null,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;b jsonb;r jsonb;used integer;idx integer;key text;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '참가 복구 정보가 필요합니다.' using errcode='42501';end if;
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 if not found then raise exception '참가 기록을 찾을 수 없습니다.' using errcode='42501';end if;
 select * into s from public.escape_sessions where id=p.session_id for update;
 -- Refresh actor after waiting for the shared session lock.
 select * into p from public.escape_participants where id=p.id;
 if p_action='submit' and exists(select 1 from public.escape_submission_receipts where participant_id=p.id and request_id=p_request and block_id=p_block) then
  return jsonb_build_object('outcome',(select outcome from public.escape_submission_receipts where participant_id=p.id and request_id=p_request),'duplicate',true,'game',escape_private.student_projection(p.id));
 end if;
 if p_action<>'read' and exists(select 1 from public.escape_results where session_id=s.id and subject_key=escape_private.result_key(p.id)) then
  raise exception '이미 탈출을 완료했습니다. 추가 제출은 할 수 없습니다.' using errcode='22023';
 end if;
 if p_action='hint' then
  if s.status<>'playing' then raise exception '진행 중인 수업에서만 힌트를 사용할 수 있습니다.' using errcode='22023';end if;
  if p_request is null then raise exception '요청 ID가 필요합니다.' using errcode='22023';end if;
  if exists(select 1 from public.escape_hint_uses where participant_id=p.id and request_id=p_request) then return escape_private.student_projection(p.id);end if;
  if not(p.progress->'availableIds' ? p_block::text) then raise exception '공개된 콘텐츠에서만 힌트를 사용할 수 있습니다.' using errcode='42501';end if;
  select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=p_block::text;
  r:=escape_private.result_rules(s.content_snapshot);key:=escape_private.hint_key(p.id);
  select min(n) into idx from generate_series(0,jsonb_array_length(coalesce(b->'hints','[]'))-1) n where not exists(select 1 from public.escape_hint_uses where session_id=s.id and subject_key=key and block_id=p_block and hint_index=n);
  if idx is null then raise exception '모든 힌트를 확인했습니다.' using errcode='22023';end if;
  select count(*) into used from public.escape_hint_uses h join public.escape_participants actor on actor.id=h.participant_id where h.session_id=s.id and
    case r->>'hints' when 'individual' then h.participant_id=p.id when 'team' then case when s.content_snapshot->>'playMode'='individual' then h.participant_id=p.id else actor.team_number is not distinct from p.team_number end when 'stage' then h.stage=b->>'stage' else true end;
  if r->>'hints'<>'unlimited' and used>=(r->>'hintLimit')::integer then raise exception '사용할 수 있는 힌트를 모두 사용했습니다.' using errcode='22023';end if;
  insert into public.escape_hint_uses(session_id,participant_id,subject_key,block_id,stage,hint_index,request_id) values(s.id,p.id,key,p_block,b->>'stage',idx,p_request);
  update public.escape_sessions set progress_revision=progress_revision+1 where id=s.id;
  return escape_private.student_projection(p.id);
 end if;
 return escape_private.student_play_v3(p_token,p_action,p_block,p_input,p_request);
end; $$;

alter function public.escape_teacher_progress(uuid,text,uuid,uuid) set schema escape_private;
alter function escape_private.escape_teacher_progress(uuid,text,uuid,uuid) rename to teacher_progress_v5;
create function public.escape_teacher_progress(p_session uuid,p_action text default 'read',p_participant uuid default null,p_block uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin v:=escape_private.teacher_progress_v5(p_session,p_action,p_participant,p_block);return v||jsonb_build_object('summary',escape_private.results_summary(p_session));end; $$;

-- Existing teacher operations remain available. Deliberate re-opening invalidates the affected current result, never an archived result.
alter function public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) set schema escape_private;
alter function escape_private.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) rename to teacher_control_v5;
create function public.escape_teacher_control(p_session uuid,p_action text,p_scope text default 'student',p_participant uuid default null,p_team integer default null,
 p_block uuid default null,p_stage text default null,p_new_team integer default null,p_revision bigint default null,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.escape_sessions;ids uuid[];keys text[];v jsonb;
begin
 select * into s from public.escape_sessions where id=p_session and owner_id=auth.uid() for update;
 if not found then raise exception '본인 수업만 관리할 수 있습니다.' using errcode='42501';end if;
 if not exists(select 1 from public.escape_teacher_actions where session_id=s.id and request_id=p_request) then
  select array_agg(id),array_agg(escape_private.result_key(id)) into ids,keys from public.escape_participants where session_id=s.id and left_at is null and (p_scope='student' and id=p_participant or p_scope='team' and team_number=p_team);
  if p_action in ('move','stage','unlock','reset','team') then
   delete from public.escape_results where session_id=s.id and (subject_key=any(keys) or p_action='team' and subject_key='t:'||p_new_team);
  end if;
  if p_action='reset' then delete from public.escape_hint_uses where participant_id=any(ids);end if;
 end if;
 v:=escape_private.teacher_control_v5(p_session,p_action,p_scope,p_participant,p_team,p_block,p_stage,p_new_team,p_revision,p_request);
 return public.escape_teacher_progress(s.id);
end; $$;

alter function public.escape_teacher_lobby(text,uuid) set schema escape_private;
alter function escape_private.escape_teacher_lobby(text,uuid) rename to teacher_lobby_v2;
create function public.escape_teacher_lobby(p_action text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 if p_action='open' then
  select s.id into sid from public.escape_sessions s join public.escape_contents c on c.id=s.content_id where c.id=p_id and c.owner_id=auth.uid()
  order by (s.status<>'finished') desc,s.created_at desc limit 1;
  if sid is not null then return escape_private.roster(sid);end if;
 end if;
 return escape_private.teacher_lobby_v2(p_action,p_id);
end; $$;

create function public.escape_finish_reset(p_session uuid,p_action text,p_keep boolean default true,p_request uuid default null,p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.escape_sessions;c public.escape_contents;rec public.escape_reset_receipts;new_id uuid;summary jsonb;
begin
 if auth.uid() is null then raise exception '교사 로그인이 필요합니다.' using errcode='42501';end if;
 if p_action not in ('finish','reset') or p_action is null or not p_confirm then raise exception '종료 또는 초기화 확인이 필요합니다.' using errcode='22023';end if;
 if p_action='reset' then
  if p_request is null or p_keep is null then raise exception '초기화 요청과 보관 방식을 확인하세요.' using errcode='22023';end if;
  select * into rec from public.escape_reset_receipts where request_id=p_request and owner_id=auth.uid() and old_session=p_session;
  if found then return escape_private.roster(rec.new_session);end if;
 end if;
 select c1.* into c from public.escape_contents c1 join public.escape_sessions s1 on s1.content_id=c1.id where s1.id=p_session and s1.owner_id=auth.uid() for update of c1;
 if not found then raise exception '본인 수업만 종료할 수 있습니다.' using errcode='42501';end if;
 select * into s from public.escape_sessions where id=p_session for update;
 if not found then raise exception '이미 초기화된 수업입니다.' using errcode='22023';end if;
 if s.status<>'finished' then update public.escape_sessions set status='finished',ended_at=now(),progress_revision=progress_revision+1 where id=s.id returning * into s;end if;
 if p_action='finish' then return public.escape_teacher_progress(s.id);end if;
 summary:=escape_private.results_summary(s.id)||jsonb_build_object('title',s.content_snapshot->>'title','playMode',s.content_snapshot->>'playMode',
 'startedAt',s.started_at,'endedAt',s.ended_at,'participantCount',(select count(*) from public.escape_participants where session_id=s.id and left_at is null),
 'ranking',escape_private.result_rules(s.content_snapshot)->>'ranking','timing',escape_private.play_timing(s.id));
 if p_keep then insert into public.escape_result_archives(content_id,owner_id,source_session,summary) values(c.id,auth.uid(),s.id,summary);end if;
 delete from public.escape_sessions where id=s.id;
 insert into public.escape_sessions(content_id,owner_id,content_snapshot) values(c.id,auth.uid(),c.document) returning id into new_id;
 insert into public.escape_reset_receipts(request_id,owner_id,content_id,old_session,new_session) values(p_request,auth.uid(),c.id,s.id,new_id);
 return escape_private.roster(new_id);
end; $$;
create function public.escape_result_history(p_content uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.escape_contents where id=p_content and owner_id=auth.uid()) then raise exception '본인 결과 기록만 볼 수 있습니다.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'savedAt',created_at,'summary',summary) order by created_at desc),'[]') from public.escape_result_archives where content_id=p_content and owner_id=auth.uid());
end; $$;

revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_student_play(text,text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.escape_student_play(text,text,uuid,jsonb,uuid) to anon;
revoke all on function public.escape_teacher_progress(uuid,text,uuid,uuid),public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid),public.escape_teacher_lobby(text,uuid),public.escape_finish_reset(uuid,text,boolean,uuid,boolean),public.escape_result_history(uuid) from public,anon,authenticated;
grant execute on function public.escape_teacher_progress(uuid,text,uuid,uuid),public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid),public.escape_teacher_lobby(text,uuid),public.escape_finish_reset(uuid,text,boolean,uuid,boolean),public.escape_result_history(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
