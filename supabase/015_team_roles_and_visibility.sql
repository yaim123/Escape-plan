-- 015: team role slots, role paths, global chat and contribution waiting.
-- Apply once after 014. No existing documents or historical results are rewritten.
begin;
create function escape_private.role_views(doc jsonb) returns boolean language sql immutable set search_path='' as $$
 select doc->>'playMode'='team' and coalesce((doc#>>'{teamSettings,rolesEnabled}')::boolean,false) and coalesce((doc#>>'{teamSettings,roleViewsEnabled}')::boolean,false);
$$;
create function escape_private.audience_roles(b jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when jsonb_typeof(b#>'{assignment,visibleRoles}')='array' then b#>'{assignment,visibleRoles}' when b#>>'{assignment,mode}'='role' then jsonb_build_array(b#>>'{assignment,role}') else '[]'::jsonb end;
$$;
create function escape_private.role_visible(doc jsonb,b jsonb,role_name text) returns boolean language sql immutable set search_path='' as $$
 select not escape_private.role_views(doc) or jsonb_array_length(escape_private.audience_roles(b))=0 or escape_private.audience_roles(b) ? coalesce(role_name,'');
$$;
create function escape_private.team_chat_enabled(doc jsonb) returns boolean language sql immutable set search_path='' as $$
 -- Absent flag keeps 014 chat documents working. Explicit OFF overrides every block.
 select doc->>'playMode'='team' and coalesce((doc#>>'{teamSettings,chatEnabled}')::boolean,true);
$$;
alter table public.escape_participants add column role_slot integer;
-- Slot identity is separate from historical member_number (which must never be renumbered).
update public.escape_participants set role_slot=member_number where member_number is not null;
create or replace function escape_private.assign_current_role() returns trigger language plpgsql set search_path='' as $$
declare s public.escape_sessions;slot integer;
begin
 select * into s from public.escape_sessions where id=new.session_id for update;
 if new.left_at is not null or new.team_number is null then new.role_slot:=null;return new;end if;
 if s.content_snapshot->>'playMode'<>'team' or not coalesce((s.content_snapshot#>>'{teamSettings,rolesEnabled}')::boolean,false) then return new;end if;
 if s.status not in ('playing','paused') or new.member_number is null then return new;end if;
 if old.member_number is null then slot:=new.member_number;
 elsif new.team_number is distinct from old.team_number then
  select n into slot from generate_series(1,jsonb_array_length(s.content_snapshot#>'{teamSettings,roles}')) n
   where not exists(select 1 from public.escape_participants p where p.session_id=new.session_id and p.team_number=new.team_number and p.left_at is null and p.id<>new.id and p.role_slot=n) order by n limit 1;
 else slot:=coalesce(old.role_slot,new.member_number);end if;
 if slot is null or slot>jsonb_array_length(s.content_snapshot#>'{teamSettings,roles}') then raise exception '팀원 수보다 설정된 역할 인원이 적습니다. 역할 인원을 추가하거나 팀 인원을 조정해주세요.' using errcode='22023';end if;
 new.role_slot:=slot;new.role_name:=s.content_snapshot#>>array['teamSettings','roles',(slot-1)::text];return new;
end;$$;
create function escape_private.role_capacity() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='lobby' and new.status='playing' and new.content_snapshot->>'playMode'='team' and coalesce((new.content_snapshot#>>'{teamSettings,rolesEnabled}')::boolean,false) and exists(
 select 1 from public.escape_participants where session_id=new.id and left_at is null group by team_number having count(*)>jsonb_array_length(new.content_snapshot#>'{teamSettings,roles}')) then
 raise exception '팀원 수보다 설정된 역할 인원이 적습니다. 역할 인원을 추가하거나 팀 인원을 조정해주세요.' using errcode='22023';end if;return new;
end;$$;
create trigger escape_role_capacity before update of status on public.escape_sessions for each row execute function escape_private.role_capacity();


-- Check only new role paths. Existing assignment/completion rooms keep their semantics.
create function escape_private.assert_role_roster(sid uuid) returns void language plpgsql set search_path='' as $$
declare doc jsonb;team record;item record;eligible integer;visible_count integer;
begin
 select content_snapshot into doc from public.escape_sessions where id=sid;
 if not escape_private.role_views(doc) then return;end if;
 for team in select team_number,jsonb_agg(jsonb_build_object('id',id,'member',member_number,'role',role_name) order by member_number) members from public.escape_participants where session_id=sid and left_at is null group by team_number loop
  if not exists(select 1 from jsonb_array_elements(doc->'content') block,jsonb_array_elements(team.members) peer where escape_private.role_visible(doc,block,peer->>'role')) then raise exception '%조가 볼 수 있는 콘텐츠가 없습니다. 역할 배정을 확인하세요.',team.team_number using errcode='22023';end if;
  for item in select value block,ordinality-1 idx from jsonb_array_elements(doc->'content') with ordinality loop
   select count(*) filter(where escape_private.role_visible(doc,item.block,peer->>'role')),count(*) filter(where escape_private.role_visible(doc,item.block,peer->>'role') and escape_private.assigned(item.block,peer,team.members,item.idx::integer)) into visible_count,eligible from jsonb_array_elements(team.members) peer;
   if doc#>>'{rules,finishMode}'='final' and item.block->>'id'=doc#>>'{rules,finalBlockId}' and eligible=0 then raise exception '%조에 최종 블록을 수행할 역할이 없습니다.',team.team_number using errcode='22023';end if;
   if visible_count=0 then continue;end if;
   if eligible=0 then raise exception '%: 표시 대상과 문제 배정 대상이 겹치지 않습니다. 역할 또는 배정 방식을 확인하세요.',item.block->>'title' using errcode='22023';end if;
   if item.block->>'questionType'<>'qr' and item.block#>>'{completion,mode}'='n' and (item.block#>>'{completion,count}')::integer>eligible then raise exception '%: 완료에 필요한 인원이 표시·배정 대상보다 많습니다.',item.block->>'title' using errcode='22023';end if;
   if item.block->>'questionType'<>'qr' and item.block#>>'{completion,mode}' in ('member','role') and exists(select 1 from jsonb_array_elements(team.members) peer where
    (item.block#>>'{completion,mode}'='member' and peer->>'member'=item.block#>>'{completion,member}' or item.block#>>'{completion,mode}'='role' and peer->>'role'=item.block#>>'{completion,role}') and not escape_private.role_visible(doc,item.block,peer->>'role')) then raise exception '%: 완료 대상이 볼 수 없는 블록입니다.',item.block->>'title' using errcode='22023';end if;
  end loop;
 end loop;
end;$$;

create or replace function escape_private.start_play() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b jsonb; role_names jsonb:=new.content_snapshot#>'{teamSettings,roles}';
begin
  perform escape_private.assert_runnable(new.content_snapshot);
  if jsonb_array_length(new.content_snapshot->'content')=0 then raise exception '콘텐츠를 하나 이상 추가하세요.' using errcode='22023'; end if;
  for b in select value from jsonb_array_elements(new.content_snapshot->'content') loop
    if b->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or b->>'type' not in ('story','question','guide','wait')
      or b->>'questionType' not in ('short','number','choice','multi','ox','order','match','cipher','switch','condition','approval','qr') then
      raise exception '지원하지 않는 콘텐츠 형식입니다.' using errcode='22023';
    end if;
  end loop;
  with numbered as (select id, case when new.content_snapshot->>'playMode'='individual' then 1 else row_number() over(partition by team_number order by arrived_at,id)::integer end num
    from public.escape_participants where session_id=new.id and left_at is null)
  update public.escape_participants p set member_number=n.num, role_name=case when coalesce((new.content_snapshot#>>'{teamSettings,rolesEnabled}')::boolean,false)
    then coalesce(role_names->>(n.num-1),'조원') else '조원' end
    from numbered n where p.id=n.id;
  perform escape_private.assert_role_roster(new.id);
  update public.escape_sessions set play_version=1, progress_revision=progress_revision+1 where id=new.id;
  perform escape_private.sync_play(new.id);
  return new;
end;
$$;

create or replace function escape_private.assert_runnable(doc jsonb) returns void language plpgsql set search_path='' as $$
declare c jsonb;b jsonb;ids text[]:='{}';
begin
 perform escape_private.assert_runnable_v13(doc);
 if escape_private.team_chat_enabled(doc) then
 if jsonb_typeof(coalesce(doc->'chatRooms','[]'))<>'array' or jsonb_array_length(coalesce(doc->'chatRooms','[]'))>32 then raise exception '채팅방 설정을 확인하세요.' using errcode='22023';end if;
 for c in select value from jsonb_array_elements(coalesce(doc->'chatRooms','[]')) loop
  if c->>'id' is null or c->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or c->>'id'=any(ids) or length(btrim(coalesce(c->>'name',''))) not between 1 and 80 or c->>'scope' is null or c->>'scope' not in ('team','roles') or jsonb_typeof(c->'roles') is distinct from 'array' then raise exception '채팅방 이름·참여 범위를 확인하세요.' using errcode='22023';end if;
  ids:=array_append(ids,c->>'id');
  if c->>'scope'='roles' and (not coalesce((doc#>>'{teamSettings,rolesEnabled}')::boolean,false) or jsonb_array_length(c->'roles')=0 or exists(select 1 from jsonb_array_elements_text(c->'roles') r where not(doc#>'{teamSettings,roles}' ? r))) then raise exception '채팅 참여 역할을 확인하세요.' using errcode='22023';end if;
 end loop;
 for b in select value from jsonb_array_elements(doc->'content') loop
  if coalesce((b->>'chatEnabled')::boolean,false) and (jsonb_typeof(b->'chatRoomIds') is distinct from 'array' or jsonb_array_length(b->'chatRoomIds')=0 or exists(select 1 from jsonb_array_elements_text(b->'chatRoomIds') r where not(r=any(ids)))) then raise exception '블록에 채팅방을 연결하세요.' using errcode='22023';end if;
 end loop;
end if;
 if doc->>'playMode'='team' and coalesce((doc#>>'{teamSettings,rolesEnabled}')::boolean,false) then
  if jsonb_typeof(doc#>'{teamSettings,roles}') is distinct from 'array' or jsonb_array_length(doc#>'{teamSettings,roles}')=0 or exists(select 1 from jsonb_array_elements(doc#>'{teamSettings,roles}') r where jsonb_typeof(r)<>'string' or length(btrim(r#>>'{}')) not between 1 and 80) then raise exception '역할 이름과 인원을 확인하세요.' using errcode='22023';end if;
  for b in select value from jsonb_array_elements(doc->'content') loop
   if (b#>>'{assignment,mode}'='role' and not(doc#>'{teamSettings,roles}' ? (b#>>'{assignment,role}'))) or (b#>>'{completion,mode}'='role' and not(doc#>'{teamSettings,roles}' ? (b#>>'{completion,role}'))) or exists(select 1 from jsonb_array_elements(b#>'{unlock,conditions}') cond where coalesce(cond->>'role','')<>'' and not(doc#>'{teamSettings,roles}' ? (cond->>'role'))) then raise exception '%: 존재하지 않는 역할을 참조합니다. 대상과 조건을 수정하세요.',b->>'title' using errcode='22023';end if;
   if escape_private.role_views(doc) then
    if b#>'{assignment,visibleRoles}' is not null and (jsonb_typeof(b#>'{assignment,visibleRoles}')<>'array' or exists(select 1 from jsonb_array_elements(b#>'{assignment,visibleRoles}') r where jsonb_typeof(r)<>'string')) then raise exception '표시 대상 역할 형식을 확인하세요.' using errcode='22023';end if;
    if exists(select 1 from jsonb_array_elements_text(escape_private.audience_roles(b)) r where not(doc#>'{teamSettings,roles}' ? r)) then raise exception '%: 존재하지 않는 표시 대상 역할입니다.',b->>'title' using errcode='22023';end if;
    -- Do not silently reinterpret a team-wide completion predicate as a role predicate.
    if jsonb_array_length(escape_private.audience_roles(b))>0 and b#>>'{completion,mode}'='all' and b->>'questionType'<>'qr' and exists(select 1 from jsonb_array_elements_text(doc#>'{teamSettings,roles}') r where not(escape_private.audience_roles(b) ? r)) then raise exception '%: 역할 전용 블록의 팀원 전원 완료 조건을 확인하세요. 특정 역할 완료 또는 배정된 팀원 완료를 사용하세요.',b->>'title' using errcode='22023';end if;
    if b->>'questionType'='qr' and exists(select 1 from jsonb_array_elements(coalesce(doc->'qrMissions','[]')) q where q->>'id'=b->>'qrMissionId' and q->>'mode'='UNIQUE_MEMBER') and jsonb_array_length(escape_private.audience_roles(b))>0 and exists(select 1 from jsonb_array_elements_text(doc#>'{teamSettings,roles}') r where not(escape_private.audience_roles(b) ? r)) then raise exception '팀원별 서로 다른 QR은 모든 팀원이 볼 수 있어야 합니다.' using errcode='22023';end if;
   end if;
  end loop;
 end if;
end;$$;

alter function escape_private.completed(jsonb,jsonb,integer,boolean) rename to completed_v14;
create function escape_private.completed(p_block jsonb,p_context jsonb,p_index integer,p_individual boolean) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if coalesce((p_context->>'roleViews')::boolean,false) and p_block#>>'{completion,mode}'='assigned' then
  -- Keep the original array for automatic distribution's index calculation.
  p_context:=jsonb_set(p_context,'{members}',coalesce((select jsonb_agg(m) from jsonb_array_elements(p_context->'members') m where
   escape_private.assigned(p_block,m,p_context->'members',p_index) and (jsonb_array_length(escape_private.audience_roles(p_block))=0 or escape_private.audience_roles(p_block) ? (m->>'role'))),'[]'));
  p_block:=jsonb_set(p_block,'{completion,mode}','"all"');
 end if;
 return escape_private.completed_v14(p_block,p_context,p_index,p_individual);
end;$$;
alter function escape_private.play_context(uuid) rename to play_context_v14;
create function escape_private.play_context(p_actor uuid) returns jsonb language sql stable set search_path='' as $$
 select escape_private.play_context_v14(p_actor)||jsonb_build_object('roleViews',escape_private.role_views(s.content_snapshot)) from public.escape_participants p join public.escape_sessions s on s.id=p.session_id where p.id=p_actor;
$$;

create or replace function escape_private.play_state(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.escape_participants; s public.escape_sessions; ctx jsonb; m jsonb; b jsonb; i integer:=0; prior_done boolean:=true;
  complete boolean; mine boolean; available boolean; forced text; done_ids jsonb:='[]'; mine_ids jsonb:='[]'; open_ids jsonb:='[]'; current_id text; wrongs jsonb; relevant integer:=0; waiting jsonb; q jsonb; qr_states jsonb; contributing integer;
begin
  select * into p from public.escape_participants where id=p_actor;
  select * into s from public.escape_sessions where id=p.session_id;
  ctx:=escape_private.play_context(p_actor);
  select value into m from jsonb_array_elements(ctx->'members') where value->>'id'=p_actor::text;
  for b in select value from jsonb_array_elements(s.content_snapshot->'content') loop
    if not escape_private.role_visible(s.content_snapshot,b,p.role_name) then i:=i+1;continue;end if;
    relevant:=relevant+1;
    select action into forced from public.escape_progress_overrides where participant_id=p_actor and block_id=(b->>'id')::uuid and (scope='student' or team_number=p.team_number);
    complete:=coalesce(forced in ('complete','skip'),false) or escape_private.completed(b,ctx,i,s.content_snapshot->>'playMode'='individual');
    mine:=exists(select 1 from jsonb_array_elements(ctx->'events') e where e->>'blockId'=b->>'id' and e->>'type'='complete' and e->>'member'=p.member_number::text);
    available:=case when forced in ('complete','skip') then false when forced='open' then true else (not complete and not mine and (s.content_snapshot->>'playMode'='individual' or escape_private.assigned(b,m,ctx->'members',i)) and
      (case when jsonb_array_length(b#>'{unlock,conditions}')>0 then escape_private.unlocked(b->'unlock',ctx->'events') else prior_done end)) end;
    if complete then done_ids:=done_ids||jsonb_build_array(b->>'id'); end if;
    if mine then mine_ids:=mine_ids||jsonb_build_array(b->>'id'); end if;
    if available then open_ids:=open_ids||jsonb_build_array(b->>'id'); end if;
    if waiting is null and not complete and s.content_snapshot->>'playMode'='team' then
     q:=null;
     if ctx->'uniqueBlocks' ? (b->>'id') then
      qr_states:=coalesce(qr_states,escape_private.qr_state(p_actor));
      select value into q from jsonb_array_elements(qr_states) where value->>'id'=b->>'qrMissionId' and value->>'mode'='UNIQUE_MEMBER';
     end if;
     if coalesce((q->>'selfDone')::boolean,false) then waiting:=jsonb_build_object('blockId',b->>'id','found',q->'found','required',q->'required');
     elsif mine then
      waiting:=jsonb_build_object('blockId',b->>'id');
      if b#>>'{completion,mode}'='all' then
       select count(*) into contributing from jsonb_array_elements(ctx->'members') peer where exists(select 1 from jsonb_array_elements(ctx->'events') e where e->>'blockId'=b->>'id' and e->>'type'='complete' and e->>'member'=peer->>'member');
       waiting:=waiting||jsonb_build_object('found',contributing,'required',jsonb_array_length(ctx->'members'));
      end if;
     end if;
    end if;
    prior_done:=prior_done and complete; i:=i+1;
  end loop;
  current_id:=p.progress->>'currentBlockId';
  if current_id is null or not open_ids ? current_id then current_id:=open_ids->>0; end if;
  select coalesce(jsonb_object_agg(block_id::text,wrong_count),'{}') into wrongs from public.escape_block_progress where participant_id=p_actor and wrong_count>0;
  return jsonb_build_object('currentBlockId',current_id,'completedIds',done_ids,'personalCompletedIds',mine_ids,'availableIds',open_ids,
    'completedCount',jsonb_array_length(done_ids),'totalCount',relevant,'waiting',waiting,'wrongCounts',wrongs,'memberNumber',p.member_number,'role',p.role_name);
end; $$;

create or replace function escape_private.result_groups(p_session uuid) returns table(subject_key text,label text,member_ids uuid[],done boolean,wrong_count integer,hint_count integer,base_score numeric)
language sql stable set search_path='' as $$
 with config as (select content_snapshot doc,escape_private.result_rules(content_snapshot) rules from public.escape_sessions where id=p_session),
 groups as (select escape_private.result_key(p.id) key,
 case when c.doc->>'playMode'='team' then p.team_number||'조' else p.grade||'-'||p.classroom||'-'||p.student_number||' '||p.display_name end name,
 array_agg(p.id order by p.id) ids,
 bool_and(coalesce(case when c.rules->>'finishMode'='final' then (not exists(select 1 from jsonb_array_elements(c.doc->'content') b where b->>'id'=c.rules->>'finalBlockId' and escape_private.role_visible(c.doc,b,p.role_name)) or p.progress->'completedIds' ? (c.rules->>'finalBlockId') and not(p.progress->'availableIds' ? (c.rules->>'finalBlockId'))) else
 ((p.progress->>'totalCount')::integer>0 or escape_private.role_views(c.doc)) and p.progress->>'completedCount'=p.progress->>'totalCount' and jsonb_array_length(p.progress->'availableIds')=0 end,false)) and bool_or(case when c.rules->>'finishMode'='final' then coalesce(p.progress->'completedIds' ? (c.rules->>'finalBlockId'),false) else coalesce((p.progress->>'totalCount')::integer>0,false) end) finished
 from public.escape_participants p cross join config c where p.session_id=p_session and p.left_at is null
 group by key,name),
 scored as (select g.*,(select coalesce(sum(greatest(0,(b->>'points')::numeric)),0) from config c,jsonb_array_elements(c.doc->'content') b
 where b->>'type'='question' and exists(select 1 from public.escape_participants p where p.id=any(g.ids) and p.progress->'completedIds' ? (b->>'id')) and not exists(select 1 from public.escape_participants p where p.id=any(g.ids) and escape_private.role_visible(c.doc,b,p.role_name) and not(p.progress->'completedIds' ? (b->>'id')))) points from groups g)
 select key,name,ids,coalesce(finished,false),
 (select coalesce(sum(wrong_count),0)::integer from public.escape_block_progress where participant_id=any(ids)),
 (select count(*)::integer from public.escape_hint_uses where participant_id=any(ids)),points from scored;
$$;

create or replace function escape_private.chat_allowed(p_actor uuid,p_source uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.escape_participants p join public.escape_sessions s on s.id=p.session_id,
 jsonb_array_elements(coalesce(s.content_snapshot->'chatRooms','[]')) c,jsonb_array_elements(s.content_snapshot->'content') b
 where escape_private.team_chat_enabled(s.content_snapshot) and p.id=p_actor and p.left_at is null and p.team_number is not null and s.content_snapshot->>'playMode'='team' and s.status in ('playing','paused')
 and b->>'id'=(escape_private.play_state(p.id)->>'currentBlockId') and coalesce((b->>'chatEnabled')::boolean,false) and b->'chatRoomIds' ? p_source::text
 and c->>'id'=p_source::text and (c->>'scope'='team' or c->>'scope'='roles' and c->'roles' ? p.role_name));
$$;

create or replace function public.escape_chat(p_token text,p_action text default 'list',p_room uuid default null,p_text text default null,p_request uuid default null,p_before bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;c jsonb;r public.escape_chat_rooms;v jsonb;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '참가 확인이 필요합니다.' using errcode='42501';end if;
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 if not found then raise exception '참가 기록을 찾을 수 없습니다.' using errcode='42501';end if;
 select * into s from public.escape_sessions where id=p.session_id for update;
 select * into p from public.escape_participants where id=p.id and left_at is null;
 if p.id is null or s.id is null or s.status not in ('playing','paused') or not escape_private.team_chat_enabled(s.content_snapshot) then raise exception '이 수업에서 채팅을 사용할 수 없습니다.' using errcode='42501';end if;
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

alter function escape_private.student_projection(uuid) rename to student_projection_v14;
create function escape_private.student_projection(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;v jsonb;b jsonb;w jsonb;cfg jsonb;
begin
 select * into p from public.escape_participants where id=p_actor;select * into s from public.escape_sessions where id=p.session_id;
 v:=escape_private.student_projection_v14(p_actor);
 select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=v#>>'{current,id}';
 -- Defensive projection gate, including stale stored current IDs and previously revealed hints.
 if b is not null and not escape_private.role_visible(s.content_snapshot,b,p.role_name) then v:=v||jsonb_build_object('current',null,'revealedHints','[]'::jsonb,'hasMoreHints',false,'stageName','','qr','[]'::jsonb);end if;
 v:=v||jsonb_build_object('available',coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(v->'available','[]')) x join lateral jsonb_array_elements(s.content_snapshot->'content') item on item->>'id'=x->>'id' where escape_private.role_visible(s.content_snapshot,item,p.role_name)),'[]'));
 if not escape_private.team_chat_enabled(s.content_snapshot) and v->'current'<>'null'::jsonb then v:=jsonb_set(v,'{current,chatEnabled}','false');end if;
 w:=p.progress->'waiting';cfg:=coalesce(s.content_snapshot#>'{teamSettings,waiting}','{}');
 return v||jsonb_build_object('teamChatEnabled',escape_private.team_chat_enabled(s.content_snapshot),'waiting',w,
 'waitingSettings',jsonb_build_object('title',coalesce(nullif(cfg->>'title',''),'내 할 일을 완료했습니다!'),'body',coalesce(nullif(cfg->>'body',''),'다른 팀원이 조건을 완료할 때까지 기다려주세요.'),'showCounts',coalesce((cfg->>'showCounts')::boolean,true)));
end;$$;
-- An explicit audience check precedes even duplicate receipts / hint reads.
alter function public.escape_student_play(text,text,uuid,jsonb,uuid) set schema escape_private;
alter function escape_private.escape_student_play(text,text,uuid,jsonb,uuid) rename to student_play_v14;
create function public.escape_student_play(p_token text,p_action text default 'read',p_block uuid default null,p_input jsonb default null,p_request uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;b jsonb;
begin
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 if p.id is null then raise exception '참가 기록을 찾을 수 없습니다.' using errcode='42501';end if;
 select * into s from public.escape_sessions where id=p.session_id for update;
 select * into p from public.escape_participants where id=p.id;
 if p_block is not null then
  select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=p_block::text;
  if b is not null and not escape_private.role_visible(s.content_snapshot,b,p.role_name) then raise exception '현재 역할에게 공개되지 않은 콘텐츠입니다.' using errcode='42501';end if;
 end if;
 return escape_private.student_play_v14(p_token,p_action,p_block,p_input,p_request);
end;$$;
revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_student_play(text,text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.escape_student_play(text,text,uuid,jsonb,uuid) to anon;
notify pgrst,'reload schema';
commit;
