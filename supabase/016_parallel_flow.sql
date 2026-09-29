-- Apply once after 015. Linear rooms take the original 015 path.
begin;
create table escape_private.parallel_closures(
 id uuid primary key default gen_random_uuid(),session_id uuid not null references public.escape_sessions(id) on delete cascade,
 team_number integer not null,group_id uuid not null,lanes jsonb not null,closed_at timestamptz not null default now(),retired_at timestamptz
);
create unique index escape_parallel_closed_once on escape_private.parallel_closures(session_id,team_number,group_id) where retired_at is null;
revoke all on escape_private.parallel_closures from public,anon,authenticated;
create function escape_private.parallel_group(doc jsonb,bid text) returns jsonb language sql immutable set search_path='' as $$
 select g from jsonb_array_elements(coalesce(doc->'parallelGroups','[]')) g where exists(select 1 from jsonb_array_elements(g->'steps') st,jsonb_array_elements(st->'cells') c where c->>'blockId'=bid) limit 1;
$$;
create function escape_private.parallel_block_done(sid uuid,team integer,b jsonb) returns boolean language plpgsql stable set search_path='' as $$
declare doc jsonb;p record;ctx jsonb;idx integer;found_member boolean:=false;forced text;
begin
 select content_snapshot into doc from public.escape_sessions where id=sid;
 select ord-1 into idx from jsonb_array_elements(doc->'content') with ordinality x(v,ord) where v->>'id'=b->>'id';
 for p in select * from public.escape_participants where session_id=sid and team_number=team and left_at is null loop
  ctx:=escape_private.play_context(p.id);
  if not escape_private.role_visible(doc,b,p.role_name) or not escape_private.assigned(b,jsonb_build_object('id',p.id,'member',p.member_number,'role',p.role_name),ctx->'members',idx) then continue;end if;
  found_member:=true;
  select action into forced from public.escape_progress_overrides where participant_id=p.id and block_id=(b->>'id')::uuid and (scope='student' or team_number=team);
  if not (coalesce(forced in ('complete','skip'),false) or escape_private.completed(b,ctx,idx,false)) then return false;end if;
 end loop;
 return found_member;
end;$$;
create function escape_private.parallel_state(actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;g jsonb;st jsonb;c jsonb;b jsonb;first_b jsonb;out jsonb:='[]';lanes jsonb;done_map jsonb;closed boolean;cached jsonb;ok boolean;lane_done boolean;fraction numeric;lane_fraction numeric;ln integer;n integer;prior integer;actor_lane integer;step_no integer;block_id text;held_id text;last_id text;found_count integer;
begin
 select * into p from public.escape_participants where id=actor;select * into s from public.escape_sessions where id=p.session_id;
 for g in select value from jsonb_array_elements(coalesce(s.content_snapshot->'parallelGroups','[]')) loop
  done_map:='{}';lanes:='[]';actor_lane:=-1;block_id:=null;held_id:=null;step_no:=-1;fraction:=case when g->>'mode'='OR' then 0 else 0 end;
  select pc.lanes into cached from escape_private.parallel_closures pc where pc.session_id=s.id and pc.team_number=p.team_number and pc.group_id=(g->>'id')::uuid and pc.retired_at is null;
  for b in select item from jsonb_array_elements(s.content_snapshot->'content') item where escape_private.parallel_group(s.content_snapshot,item->>'id')->>'id'=g->>'id' loop
   done_map:=done_map||jsonb_build_object(b->>'id',escape_private.parallel_block_done(s.id,p.team_number,b));
  end loop;
  for ln in 0..1 loop
   select value into first_b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=g#>>array['steps','0','cells',ln::text,'blockId'];
   if escape_private.audience_roles(first_b) ? p.role_name then actor_lane:=ln;end if;
   lane_done:=true;found_count:=0;last_id:=null;
   for n in 0..jsonb_array_length(g->'steps')-1 loop
    c:=g#>array['steps',n::text,'cells',ln::text];
    if coalesce((c->>'hold')::boolean,false) then
     ok:=true;for prior in 0..n loop
      st:=g#>array['steps',prior::text,'cells',(1-ln)::text];
      if st->>'blockId' is not null and not coalesce((done_map->>(st->>'blockId'))::boolean,false) then ok:=false;end if;
     end loop;
    else ok:=coalesce((done_map->>(c->>'blockId'))::boolean,false);end if;
    if ok then found_count:=found_count+1;end if;
    if actor_lane=ln and lane_done and not ok then step_no:=n;if coalesce((c->>'hold')::boolean,false) then held_id:=last_id;else block_id:=c->>'blockId';end if;end if;
    lane_done:=lane_done and ok;if c->>'blockId' is not null then last_id:=c->>'blockId';end if;
   end loop;
   lane_fraction:=found_count::numeric/jsonb_array_length(g->'steps');fraction:=case when g->>'mode'='OR' then greatest(fraction,lane_fraction) else fraction+lane_fraction/2 end;
   lanes:=lanes||jsonb_build_array(jsonb_build_object('name',g#>>array['lanes',ln::text,'name'],'done',lane_done));
  end loop;
  closed:=cached is not null or case when g->>'mode'='OR' then exists(select 1 from jsonb_array_elements(lanes) item where (item->>'done')::boolean) else not exists(select 1 from jsonb_array_elements(lanes) item where not (item->>'done')::boolean) end;
  out:=out||jsonb_build_array(jsonb_build_object('id',g->>'id','done',closed,'fraction',case when closed then 1 else fraction end,'lanes',coalesce(cached,lanes),'lane',actor_lane,'step',step_no,'blockId',case when closed then null else block_id end,'heldId',case when closed then null else held_id end));
 end loop;return out;
end;$$;
alter function escape_private.play_state(uuid) rename to play_state_v15;
create function escape_private.play_state(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;base jsonb;ctx jsonb;ps jsonb;g jsonb;gs jsonb;b jsonb;m jsonb;seen jsonb:='[]';opens jsonb:='[]';i integer:=0;total integer:=0;done_count integer:=0;partial numeric:=0;prior_done boolean:=true;complete boolean;mine boolean;allowed boolean;forced text;cur text;held text;waiting jsonb;active_group jsonb;
begin
 select * into p from public.escape_participants where id=p_actor;select * into s from public.escape_sessions where id=p.session_id;
 base:=escape_private.play_state_v15(p_actor);if jsonb_array_length(coalesce(s.content_snapshot->'parallelGroups','[]'))=0 then return base;end if;
 ctx:=escape_private.play_context(p_actor);ps:=escape_private.parallel_state(p_actor);select value into m from jsonb_array_elements(ctx->'members') where value->>'id'=p_actor::text;
 for b in select value from jsonb_array_elements(s.content_snapshot->'content') loop
  g:=escape_private.parallel_group(s.content_snapshot,b->>'id');
  if g is not null then
   if seen ? (g->>'id') then i:=i+1;continue;end if;seen:=seen||jsonb_build_array(g->>'id');total:=total+1;
   select value into gs from jsonb_array_elements(ps) where value->>'id'=g->>'id';
   complete:=(gs->>'done')::boolean;partial:=partial+(gs->>'fraction')::numeric;if complete then done_count:=done_count+1;end if;
   if not complete and prior_done then
    active_group:=gs;
    if gs->>'blockId' is not null then
     select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=gs->>'blockId';
     if escape_private.role_visible(s.content_snapshot,b,p.role_name) and escape_private.assigned(b,m,ctx->'members',(select ord-1 from jsonb_array_elements(s.content_snapshot->'content') with ordinality x(v,ord) where v->>'id'=b->>'id')::integer) and not(base->'personalCompletedIds' ? (b->>'id')) and escape_private.unlocked(b->'unlock',ctx->'events') then opens:=opens||jsonb_build_array(b->>'id');end if;
    else held:=gs->>'heldId';end if;
    if jsonb_array_length(opens)=0 then waiting:=jsonb_build_object('unit','lanes','found',(select count(*) from jsonb_array_elements(gs->'lanes') l where (l->>'done')::boolean),'required',2,'lanes',gs->'lanes');end if;
   end if;
   prior_done:=prior_done and complete;i:=i+1;continue;
  end if;
  if not escape_private.role_visible(s.content_snapshot,b,p.role_name) then i:=i+1;continue;end if;
  total:=total+1;complete:=base->'completedIds' ? (b->>'id');mine:=base->'personalCompletedIds' ? (b->>'id');
  select action into forced from public.escape_progress_overrides where participant_id=p_actor and block_id=(b->>'id')::uuid and (scope='student' or team_number=p.team_number);
  allowed:=case when forced in ('complete','skip') then false when forced='open' then true else not complete and not mine and escape_private.assigned(b,m,ctx->'members',i) and (case when jsonb_array_length(b#>'{unlock,conditions}')>0 then escape_private.unlocked(b->'unlock',ctx->'events') else prior_done end) end;
  if allowed then opens:=opens||jsonb_build_array(b->>'id');end if;if complete then done_count:=done_count+1;partial:=partial+1;end if;prior_done:=prior_done and complete;i:=i+1;
 end loop;
 -- An explicit teacher-open can select a later lane step, but never a foreign audience.
 for b in select item from jsonb_array_elements(s.content_snapshot->'content') item join public.escape_progress_overrides o on o.block_id=(item->>'id')::uuid where o.participant_id=p.id and o.action='open' and (o.scope='student' or o.team_number=p.team_number) loop
  if escape_private.role_visible(s.content_snapshot,b,p.role_name) and not(opens ? (b->>'id')) then opens:=opens||jsonb_build_array(b->>'id');end if;
 end loop;
 cur:=p.progress->>'currentBlockId';if cur is null or not(opens ? cur) then cur:=opens->>0;end if;
 if cur is not null then held:=null;waiting:=null;active_group:=null;end if;
 return base||jsonb_build_object('currentBlockId',cur,'availableIds',opens,'completedCount',done_count,'totalCount',total,'progressPercent',case when total=0 then 0 else round(partial/total*100) end,'parallel',ps,'parallelActive',active_group,'heldBlockId',held,'waiting',coalesce(waiting,base->'waiting'));
end;$$;
alter function escape_private.sync_play(uuid,uuid) rename to sync_play_v15;
create function escape_private.sync_play(p_session uuid,p_actor uuid default null) returns void language plpgsql set search_path='' as $$
declare p record;g jsonb;
begin
 for p in select distinct on(team_number) id,team_number from public.escape_participants where session_id=p_session and left_at is null and team_number is not null order by team_number,member_number loop
  for g in select value from jsonb_array_elements(escape_private.parallel_state(p.id)) where (value->>'done')::boolean loop
   insert into escape_private.parallel_closures(session_id,team_number,group_id,lanes) values(p_session,p.team_number,(g->>'id')::uuid,g->'lanes') on conflict do nothing;
  end loop;
 end loop;perform escape_private.sync_play_v15(p_session,p_actor);
end;$$;
alter function escape_private.student_projection(uuid) rename to student_projection_v15;
create function escape_private.student_projection(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare v jsonb;p public.escape_participants;s public.escape_sessions;b jsonb;
begin
 v:=escape_private.student_projection_v15(p_actor);select * into p from public.escape_participants where id=p_actor;select * into s from public.escape_sessions where id=p.session_id;
 if s.status='playing' and v->'result'='null'::jsonb and p.progress->>'heldBlockId' is not null then
  select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=p.progress->>'heldBlockId';
  if b is not null and escape_private.role_visible(s.content_snapshot,b,p.role_name) then v:=v||jsonb_build_object('held',escape_private.public_block(b),'hasMoreHints',false);end if;
 end if;return v;
end;$$;
alter function public.escape_student_play(text,text,uuid,jsonb,uuid) set schema escape_private;
alter function escape_private.escape_student_play(text,text,uuid,jsonb,uuid) rename to student_play_v15;
create function public.escape_student_play(p_token text,p_action text default 'read',p_block uuid default null,p_input jsonb default null,p_request uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;g jsonb;
begin
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 select * into s from public.escape_sessions where id=p.session_id for update;
 if p_action='submit' and p_block is not null then
  select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
  g:=escape_private.parallel_group(s.content_snapshot,p_block::text);
  if g is not null and exists(select 1 from jsonb_array_elements(s.content_snapshot->'content') b where b->>'id'=p_block::text and escape_private.role_visible(s.content_snapshot,b,p.role_name)) and exists(select 1 from escape_private.parallel_closures c where c.session_id=s.id and c.team_number=p.team_number and c.group_id=(g->>'id')::uuid and c.retired_at is null) then return jsonb_build_object('outcome','parallel_closed','message','다른 팀원이 먼저 해결했습니다. 다음 단계로 이동합니다.','game',escape_private.student_projection(p.id));end if;
 end if;return escape_private.student_play_v15(p_token,p_action,p_block,p_input,p_request);
end;$$;
-- A valid QR submitted just after another OR lane closes is a safe no-op receipt.
-- No scan, completion or reward is manufactured for the unfinished lane.
alter function escape_private.scan_current_qr(text,text,uuid) rename to scan_current_qr_v15;
create function escape_private.scan_current_qr(p_token text,p_qr text,p_block uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;b jsonb;g jsonb;
begin
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 select * into s from public.escape_sessions where id=p.session_id for update;
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 if p.id is not null and s.status='playing' then
  select item into b from jsonb_array_elements(s.content_snapshot->'content') item
  where item->>'questionType'='qr' and (p_block is null or item->>'id'=p_block::text) and escape_private.role_visible(s.content_snapshot,item,p.role_name)
  and exists(select 1 from jsonb_array_elements(coalesce(s.content_snapshot->'qrMissions','[]')) m,jsonb_array_elements(m->'codes') q where m->>'id'=item->>'qrMissionId' and coalesce((m->>'active')::boolean,false) and coalesce((q->>'active')::boolean,false) and q->>'token'=p_qr) limit 1;
  g:=escape_private.parallel_group(s.content_snapshot,b->>'id');
  if g is not null and exists(select 1 from escape_private.parallel_closures pc where pc.session_id=s.id and pc.team_number=p.team_number and pc.group_id=(g->>'id')::uuid and pc.retired_at is null) then
   return jsonb_build_object('duplicate',true,'completed',false,'message','다른 팀원이 먼저 해결했습니다. 다음 단계로 이동합니다.','game',escape_private.student_projection(p.id));
  end if;
 end if;
 return escape_private.scan_current_qr_v15(p_token,p_qr,p_block);
end;$$;
alter function public.escape_student_lobby(text,text,integer,integer,integer,integer,text) set schema escape_private;
alter function escape_private.escape_student_lobby(text,text,integer,integer,integer,integer,text) rename to student_lobby_v15;
create function public.escape_student_lobby(p_token text,p_action text default 'read',p_team integer default null,p_grade integer default null,p_class integer default null,p_number integer default null,p_name text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;
begin
 if p_action='leave' and p_token ~ '^[a-f0-9]{64}$' then
  select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token);
  select * into s from public.escape_sessions where id=p.session_id for update;
  if s.status='finished' or exists(select 1 from public.escape_results where session_id=s.id and subject_key=escape_private.result_key(p.id)) then
   -- Completed departure detaches only the credential; roster/results remain immutable.
   update public.escape_participants set recovery_hash=escape_private.hash_token(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')) where id=p.id;
   return jsonb_build_object('left',true);
  end if;
 end if;return escape_private.student_lobby_v15(p_token,p_action,p_team,p_grade,p_class,p_number,p_name);
end;$$;

create or replace function escape_private.result_groups(p_session uuid) returns table(subject_key text,label text,member_ids uuid[],done boolean,wrong_count integer,hint_count integer,base_score numeric)
language sql stable set search_path='' as $$
 with config as (select content_snapshot doc,escape_private.result_rules(content_snapshot) rules from public.escape_sessions where id=p_session),
 groups as (select escape_private.result_key(p.id) key,
 case when c.doc->>'playMode'='team' then p.team_number||'조' else p.grade||'-'||p.classroom||'-'||p.student_number||' '||p.display_name end name,
 array_agg(p.id order by p.id) ids,
 bool_and(coalesce(case when c.rules->>'finishMode'='final' then (case when escape_private.parallel_group(c.doc,c.rules->>'finalBlockId') is not null then exists(select 1 from escape_private.parallel_closures pc where pc.session_id=p.session_id and pc.team_number=p.team_number and pc.group_id=(escape_private.parallel_group(c.doc,c.rules->>'finalBlockId')->>'id')::uuid and pc.retired_at is null) else (not exists(select 1 from jsonb_array_elements(c.doc->'content') b where b->>'id'=c.rules->>'finalBlockId' and escape_private.role_visible(c.doc,b,p.role_name)) or p.progress->'completedIds' ? (c.rules->>'finalBlockId') and not(p.progress->'availableIds' ? (c.rules->>'finalBlockId'))) end) else
 ((p.progress->>'totalCount')::integer>0 or escape_private.role_views(c.doc)) and p.progress->>'completedCount'=p.progress->>'totalCount' and jsonb_array_length(p.progress->'availableIds')=0 end,false)) and bool_or(case when c.rules->>'finishMode'='final' then coalesce(p.progress->'completedIds' ? (c.rules->>'finalBlockId'),false) or exists(select 1 from escape_private.parallel_closures pc where pc.session_id=p.session_id and pc.team_number=p.team_number and pc.group_id=(escape_private.parallel_group(c.doc,c.rules->>'finalBlockId')->>'id')::uuid and pc.retired_at is null) else coalesce((p.progress->>'totalCount')::integer>0,false) end) finished
 from public.escape_participants p cross join config c where p.session_id=p_session and p.left_at is null
 group by key,name),
 scored as (select g.*,(select coalesce(sum(greatest(0,(b->>'points')::numeric)),0) from config c,jsonb_array_elements(c.doc->'content') b
 where b->>'type'='question' and exists(select 1 from public.escape_participants p where p.id=any(g.ids) and p.progress->'completedIds' ? (b->>'id')) and not exists(select 1 from public.escape_participants p where p.id=any(g.ids) and escape_private.role_visible(c.doc,b,p.role_name) and not(p.progress->'completedIds' ? (b->>'id')))) points from groups g)
 select key,name,ids,coalesce(finished,false),
 (select coalesce(sum(wrong_count),0)::integer from public.escape_block_progress where participant_id=any(ids)),
 (select count(*)::integer from public.escape_hint_uses where participant_id=any(ids)),points from scored;
$$;

alter function escape_private.assert_runnable(jsonb) rename to assert_runnable_v15;
create function escape_private.assert_runnable(doc jsonb) returns void language plpgsql set search_path='' as $$
declare g jsonb;st jsonb;c jsonb;b jsonb;first_b jsonb;other_b jsonb;used text[]:='{}';ids text[];idx integer;ln integer;n integer;low_n integer;high_n integer;
begin
 perform escape_private.assert_runnable_v15(doc);
 if jsonb_typeof(coalesce(doc->'parallelGroups','[]'))<>'array' then raise exception '병렬 구간 형식을 확인하세요.' using errcode='22023';end if;
 if jsonb_array_length(coalesce(doc->'parallelGroups','[]'))>0 and not escape_private.role_views(doc) then raise exception '병렬 진행은 팀전·역할 사용·역할별 화면 분리가 필요합니다.' using errcode='22023';end if;
 for g in select value from jsonb_array_elements(coalesce(doc->'parallelGroups','[]')) loop
  if g->>'id' is null or g->>'id' !~* '^[0-9a-f-]{36}$' or g->>'id'=any(used) or g->>'mode' is null or g->>'mode' not in ('AND','OR') or jsonb_typeof(g->'lanes') is distinct from 'array' or jsonb_array_length(g->'lanes')<>2 or jsonb_typeof(g->'steps') is distinct from 'array' or jsonb_array_length(g->'steps') not between 1 and 100 then raise exception '병렬 구간 이름·경로·단계 설정을 확인하세요.' using errcode='22023';end if;
  used:=array_append(used,g->>'id');ids:='{}';idx:=0;
  for st in select value from jsonb_array_elements(g->'steps') loop
   if jsonb_typeof(st->'cells') is distinct from 'array' or jsonb_array_length(st->'cells')<>2 or (st#>>'{cells,0,hold}'='true' and st#>>'{cells,1,hold}'='true') then raise exception '병렬 단계에는 새 화면이 하나 이상 필요합니다.' using errcode='22023';end if;
   for ln in 0..1 loop
    c:=st->'cells'->ln;
    if coalesce((c->>'hold')::boolean,false) then
     if idx=0 or c->>'blockId' is not null then raise exception '첫 병렬 단계는 이전 화면을 유지할 수 없습니다.' using errcode='22023';end if;
    else
     select value into b from jsonb_array_elements(doc->'content') where value->>'id'=c->>'blockId';
     if b is null or b->>'id'=any(used) then raise exception '병렬 콘텐츠 참조는 중복 없이 연결하세요.' using errcode='22023';end if;
     used:=array_append(used,b->>'id');ids:=array_append(ids,b->>'id');
     select value into first_b from jsonb_array_elements(doc->'content') where value->>'id'=g#>>array['steps','0','cells',ln::text,'blockId'];
     if jsonb_array_length(escape_private.audience_roles(b))=0 or escape_private.audience_roles(b)<>escape_private.audience_roles(first_b) then raise exception '각 경로에 동일한 표시 대상 역할을 지정하세요.' using errcode='22023';end if;
    end if;
   end loop;idx:=idx+1;
  end loop;
  select min(ord),max(ord),count(distinct item->>'stageId') into low_n,high_n,n from jsonb_array_elements(doc->'content') with ordinality x(item,ord) where item->>'id'=any(ids);
  if high_n-low_n+1<>cardinality(ids) or n<>1 then raise exception '병렬 구간은 같은 스테이지의 연속된 묶음이어야 합니다.' using errcode='22023';end if;
  select value into first_b from jsonb_array_elements(doc->'content') where value->>'id'=g#>>'{steps,0,cells,0,blockId}';
  select value into other_b from jsonb_array_elements(doc->'content') where value->>'id'=g#>>'{steps,0,cells,1,blockId}';
  if exists(select 1 from jsonb_array_elements_text(escape_private.audience_roles(first_b)) role where escape_private.audience_roles(other_b) ? role) then raise exception 'A/B 경로 역할은 겹치지 않아야 합니다.' using errcode='22023';end if;
 end loop;
end;$$;
alter function escape_private.assert_role_roster(uuid) rename to assert_role_roster_v15;
create function escape_private.assert_role_roster(sid uuid) returns void language plpgsql set search_path='' as $$
declare doc jsonb;g jsonb;b jsonb;t record;ln integer;
begin
 perform escape_private.assert_role_roster_v15(sid);select content_snapshot into doc from public.escape_sessions where id=sid;
 for g in select value from jsonb_array_elements(coalesce(doc->'parallelGroups','[]')) loop
  for ln in 0..1 loop
   select value into b from jsonb_array_elements(doc->'content') where value->>'id'=g#>>array['steps','0','cells',ln::text,'blockId'];
   for t in select team_number from public.escape_participants where session_id=sid and left_at is null group by team_number loop
    if not exists(select 1 from public.escape_participants p where p.session_id=sid and p.left_at is null and p.team_number=t.team_number and escape_private.role_visible(doc,b,p.role_name)) then raise exception '%조에 % 병렬 경로 담당 역할이 없습니다.',t.team_number,g#>>array['lanes',ln::text,'name'] using errcode='22023';end if;
   end loop;
  end loop;
 end loop;
end;$$;
create function escape_private.team_progress_percent(sid uuid,team integer) returns integer language plpgsql stable set search_path='' as $$
declare doc jsonb;b jsonb;g jsonb;gs jsonb;ps jsonb;seen jsonb:='[]';total integer:=0;partial numeric:=0;actor uuid;
begin
 if exists(select 1 from public.escape_results where session_id=sid and subject_key='t:'||team) then return 100;end if;
 select content_snapshot into doc from public.escape_sessions where id=sid;select id into actor from public.escape_participants where session_id=sid and team_number=team and left_at is null limit 1;ps:=escape_private.parallel_state(actor);
 for b in select value from jsonb_array_elements(doc->'content') loop
  g:=escape_private.parallel_group(doc,b->>'id');
  if g is not null then
   if seen ? (g->>'id') then continue;end if;seen:=seen||jsonb_build_array(g->>'id');total:=total+1;select value into gs from jsonb_array_elements(ps) where value->>'id'=g->>'id';partial:=partial+coalesce((gs->>'fraction')::numeric,0);
  elsif exists(select 1 from public.escape_participants p where p.session_id=sid and p.team_number=team and p.left_at is null and escape_private.role_visible(doc,b,p.role_name)) then
   total:=total+1;if not exists(select 1 from public.escape_participants p where p.session_id=sid and p.team_number=team and p.left_at is null and escape_private.role_visible(doc,b,p.role_name) and not coalesce(p.progress->'completedIds' ? (b->>'id'),false)) then partial:=partial+1;end if;
  end if;
 end loop;return case when total=0 then 0 else least(100,greatest(0,round(partial/total*100)::integer)) end;
end;$$;
alter function public.escape_teacher_progress(uuid,text,uuid,uuid) set schema escape_private;
alter function escape_private.escape_teacher_progress(uuid,text,uuid,uuid) rename to teacher_progress_v15;
create function public.escape_teacher_progress(p_session uuid,p_action text default 'read',p_participant uuid default null,p_block uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;rows jsonb;teams jsonb;
begin
 v:=escape_private.teacher_progress_v15(p_session,p_action,p_participant,p_block);
 select coalesce(jsonb_agg(row||jsonb_build_object('progressPercent',case when exists(select 1 from public.escape_results r where r.session_id=p_session and (row->>'id')::uuid=any(r.member_ids)) then 100 else least(100,greatest(0,coalesce((row#>>'{progress,progressPercent}')::numeric,round(coalesce((row#>>'{progress,completedCount}')::numeric,0)/greatest(1,coalesce((row#>>'{progress,totalCount}')::numeric,0))*100)))) end)),'[]') into rows from jsonb_array_elements(v->'participants') row;
 select coalesce(jsonb_agg(jsonb_build_object('team',team_number,'percent',escape_private.team_progress_percent(p_session,team_number))),'[]') into teams from(select distinct team_number from public.escape_participants where session_id=p_session and left_at is null and team_number is not null) t;
 return v||jsonb_build_object('participants',rows,'teamProgress',teams);
end;$$;
alter function public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) set schema escape_private;
alter function escape_private.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) rename to teacher_control_v15;
create function public.escape_teacher_control(p_session uuid,p_action text,p_scope text default 'student',p_participant uuid default null,p_team integer default null,p_block uuid default null,p_stage text default null,p_new_team integer default null,p_revision bigint default null,p_request uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.escape_sessions;p public.escape_participants;g jsonb;item jsonb;v jsonb;rewinds jsonb:='[]';target_n integer;current_n integer;last_n integer;ids uuid[];members uuid[];floor_id bigint;
begin
 select * into s from public.escape_sessions where id=p_session and owner_id=auth.uid() for update;
 if s.id is null then raise exception '본인 수업만 관리할 수 있습니다.' using errcode='42501';end if;
 if exists(select 1 from public.escape_teacher_actions where session_id=s.id and request_id=p_request) then return public.escape_teacher_progress(s.id);end if;
 -- In an AND wait some team members deliberately have no current block. Keep their
 -- completed lanes and apply the teacher's team action only to the remaining work.
 if p_action in ('complete','skip') and p_scope='team' and exists(select 1 from public.escape_participants where session_id=s.id and team_number=p_team and left_at is null and progress#>>'{parallelActive,id}' is not null and progress->>'currentBlockId' is null) then
  if p_request is null or p_revision is distinct from s.progress_revision or s.status not in ('playing','paused') then raise exception '진행 상태가 변경되었습니다. 최신 상태에서 다시 실행하세요.' using errcode='22023';end if;
  select array_agg(id) into ids from public.escape_participants where session_id=s.id and team_number=p_team and left_at is null and progress->>'currentBlockId' is not null;
  if ids is null then raise exception '강제로 처리할 현재 콘텐츠가 없습니다.' using errcode='22023';end if;
  insert into public.escape_progress_overrides(participant_id,block_id,action,scope,team_number)
   select id,(progress->>'currentBlockId')::uuid,p_action,'team',team_number from public.escape_participants where id=any(ids)
   on conflict(participant_id,block_id) do update set action=excluded.action,scope='team',team_number=excluded.team_number,created_at=now();
  insert into public.escape_teacher_actions(session_id,teacher_id,request_id,action,scope,target_ids,details)
   values(s.id,auth.uid(),p_request,p_action,'team',ids,jsonb_build_object('parallelWaitingPreserved',true,'targets',(select jsonb_agg(jsonb_build_object('participantId',id,'name',display_name,'team',team_number,'block',progress->>'currentBlockId')) from public.escape_participants where id=any(ids))));
  perform escape_private.sync_play(s.id);update public.escape_sessions set progress_revision=progress_revision+1 where id=s.id;
  return public.escape_teacher_progress(s.id);
 end if;
 if p_revision=s.progress_revision and s.status in ('playing','paused') and p_action in ('move','stage','reset','team') then
  select ord into target_n from jsonb_array_elements(s.content_snapshot->'content') with ordinality x(b,ord) where p_action='move' and b->>'id'=p_block::text or p_action='stage' and b->>'stage'=p_stage order by ord limit 1;
  for p in select * from public.escape_participants where session_id=s.id and left_at is null and (p_scope='student' and id=p_participant or p_scope='team' and team_number=p_team) loop
   select ord into current_n from jsonb_array_elements(s.content_snapshot->'content') with ordinality x(b,ord) where b->>'id'=p.progress->>'currentBlockId';
   if current_n is null and p.progress#>>'{parallelActive,id}' is not null then select max(ord)+1 into current_n from jsonb_array_elements(s.content_snapshot->'content') with ordinality x(b,ord) where escape_private.parallel_group(s.content_snapshot,b->>'id')->>'id'=p.progress#>>'{parallelActive,id}';end if;
   if current_n is null and p.progress->>'completedCount'=p.progress->>'totalCount' then current_n:=jsonb_array_length(s.content_snapshot->'content')+1;end if;
   for g in select value from jsonb_array_elements(coalesce(s.content_snapshot->'parallelGroups','[]')) loop
    select max(ord) into last_n from jsonb_array_elements(s.content_snapshot->'content') with ordinality x(b,ord) where escape_private.parallel_group(s.content_snapshot,b->>'id')->>'id'=g->>'id';
    if p_action in ('reset','team') or target_n<current_n and target_n<=last_n then rewinds:=rewinds||jsonb_build_array(jsonb_build_object('team',p.team_number,'group',g->>'id'));end if;
   end loop;
   if p_action='team' then for g in select value from jsonb_array_elements(coalesce(s.content_snapshot->'parallelGroups','[]')) loop rewinds:=rewinds||jsonb_build_array(jsonb_build_object('team',p_new_team,'group',g->>'id'));end loop;end if;
  end loop;
 end if;
 v:=escape_private.teacher_control_v15(p_session,p_action,p_scope,p_participant,p_team,p_block,p_stage,p_new_team,p_revision,p_request);
 for item in select distinct value from jsonb_array_elements(rewinds) loop
  select array_agg((b->>'id')::uuid) into ids from jsonb_array_elements(s.content_snapshot->'content') b where escape_private.parallel_group(s.content_snapshot,b->>'id')->>'id'=item->>'group';
  select array_agg(id) into members from public.escape_participants where session_id=s.id and left_at is null and team_number=(item->>'team')::integer;
  update escape_private.parallel_closures set retired_at=now() where session_id=s.id and team_number=(item->>'team')::integer and group_id=(item->>'group')::uuid and retired_at is null;
  select coalesce(max(id),0) into floor_id from public.escape_events where session_id=s.id;
  insert into escape_private.block_replays(participant_id,block_id,event_floor,scope) select m,b,floor_id,'team' from unnest(members)m,unnest(ids)b on conflict(participant_id,block_id) do update set event_floor=excluded.event_floor,scope='team',created_at=now();
  update public.escape_events set retired_at=now() where session_id=s.id and event_team=(item->>'team')::integer and block_id=any(ids) and retired_at is null;
  update public.escape_qr_scans set retired_at=now() where session_id=s.id and retired_at is null and (subject_key='t:'||(item->>'team') or participant_id=any(members)) and mission_id in(select (b->>'qrMissionId')::uuid from jsonb_array_elements(s.content_snapshot->'content') b where (b->>'id')::uuid=any(ids));
  delete from public.escape_progress_overrides where participant_id=any(members) and block_id=any(ids);
  delete from public.escape_submission_receipts where participant_id=any(members) and block_id=any(ids);
  update public.escape_block_progress set completed_at=null where participant_id=any(members) and block_id=any(ids);
  update escape_private.question_timing set timing_known=false,completed=false,active=false,elapsed_ms=0 where session_id=s.id and block_id=any(ids) and subject_key='t:'||(item->>'team');
  delete from public.escape_results where session_id=s.id and subject_key='t:'||(item->>'team');
 end loop;
 if jsonb_array_length(rewinds)>0 then
  perform escape_private.sync_play(s.id);update public.escape_sessions set progress_revision=progress_revision+1 where id=s.id;
  update public.escape_teacher_actions set details=details||jsonb_build_object('parallelRewinds',rewinds) where session_id=s.id and request_id=p_request;
 end if;return public.escape_teacher_progress(s.id);
end;$$;
revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_student_play(text,text,uuid,jsonb,uuid),public.escape_student_lobby(text,text,integer,integer,integer,integer,text),public.escape_teacher_progress(uuid,text,uuid,uuid),public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) from public,anon,authenticated;
grant execute on function public.escape_student_play(text,text,uuid,jsonb,uuid),public.escape_student_lobby(text,text,integer,integer,integer,integer,text) to anon;
grant execute on function public.escape_teacher_progress(uuid,text,uuid,uuid),public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
