-- Apply once AFTER 008. Existing RLS, tables, answers, result archives and session snapshots remain protected.
begin;

create function escape_private.clean_document(doc jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare b jsonb;items jsonb:='[]';removed jsonb;before_count integer;after_count integer;
begin
 select coalesce(jsonb_agg(value->>'id'),'[]') into removed from jsonb_array_elements(doc->'content') where value->>'type'='wait';
 for b in select value from jsonb_array_elements(doc->'content') where value->>'type'<>'wait' loop
  b:=jsonb_set(b,'{media}',(select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(coalesce(b->'media','[]')) where btrim(coalesce(value->>'url',''))<>''));
  before_count:=jsonb_array_length(b#>'{unlock,conditions}');
  b:=jsonb_set(b,'{unlock,conditions}',(select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(b#>'{unlock,conditions}') where not(removed ? (value->>'blockId'))));
  after_count:=jsonb_array_length(b#>'{unlock,conditions}');
  if before_count<>after_count and b#>>'{unlock,mode}'='N' then
   b:=jsonb_set(b,'{unlock,count}',to_jsonb(greatest(1,least((b#>>'{unlock,count}')::integer,after_count))));
   if after_count=0 then b:=jsonb_set(b,'{unlock,mode}','"AND"');end if;
  end if;
  if b->>'display'='full' then b:=jsonb_set(b,'{display}','"theme"');end if;
  items:=items||jsonb_build_array(b);
 end loop;
 doc:=jsonb_set(doc,'{content}',items);
 if removed ? (doc#>>'{rules,finalBlockId}') then doc:=jsonb_set(jsonb_set(doc,'{rules,finishMode}','"all"'),'{rules,finalBlockId}','null');end if;
 return doc;
end; $$;
create function escape_private.prepare_snapshot() returns trigger language plpgsql set search_path='' as $$
begin new.content_snapshot:=escape_private.clean_document(new.content_snapshot);return new;end;$$;
create trigger escape_prepare_snapshot before insert on public.escape_sessions for each row execute function escape_private.prepare_snapshot();

create function public.escape_class_states() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('contentId',content_id,'sessionId',id,'status',status)),'[]')
 from (select distinct on(content_id) content_id,id,status from public.escape_sessions
 where owner_id=auth.uid() and status<>'finished' order by content_id,created_at desc) s;
$$;

-- Save remains permissive. This function is called only before creating/starting a class.
create function escape_private.assert_runnable(doc jsonb) returns void language plpgsql set search_path='' as $$
declare b jsonb;c jsonb;m jsonb;q jsonb;n integer;label text;
begin
 if jsonb_typeof(doc->'content') is distinct from 'array' or jsonb_array_length(doc->'content')=0 then raise exception '실행할 콘텐츠를 추가하세요.' using errcode='22023';end if;
 for b in select value from jsonb_array_elements(doc->'content') loop
  label:=coalesce(b->>'title','제목 없는 블록');
  if b->>'type' not in ('story','guide','question') or b->>'display' not in ('card','theme','image','full') then raise exception '%: 블록 유형 또는 표시 방식을 확인하세요.',label using errcode='22023';end if;
  if b->>'display'='image' and coalesce(b->>'backgroundUrl','') !~* '^https?://[^[:space:]/?#]+' then raise exception '%: 배경 이미지 URL을 확인하세요.',label using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(coalesce(b->'media','[]')) x where coalesce(x->>'url','') !~* '^https?://[^[:space:]/?#]+') then raise exception '%: 자료 URL을 확인하세요.',label using errcode='22023';end if;
  if b->>'type'='question' and b->>'questionType' not in ('qr','switch','condition','approval') and not exists(select 1 from jsonb_array_elements_text(coalesce(b->'answers','[]')) x where btrim(x)<>'') then raise exception '%: 정답을 입력하세요.',label using errcode='22023';end if;
  for c in select value from jsonb_array_elements(coalesce(b#>'{unlock,conditions}','[]')) loop
   if c->>'blockId'=b->>'id' or not exists(select 1 from jsonb_array_elements(doc->'content') x where x->>'id'=c->>'blockId') and
     not exists(select 1 from jsonb_array_elements(coalesce(doc->'qrMissions','[]')) x where x->>'id'=c->>'blockId' or exists(select 1 from jsonb_array_elements(x->'codes') y where y->>'id'=c->>'blockId')) then raise exception '%: 공개 조건의 대상을 확인하세요.',label using errcode='22023';end if;
  end loop;
  if b#>>'{unlock,mode}'='N' and ((b#>>'{unlock,count}')::integer<1 or (b#>>'{unlock,count}')::integer>jsonb_array_length(b#>'{unlock,conditions}')) then raise exception '%: 필요한 공개 조건 수를 확인하세요.',label using errcode='22023';end if;
  if b->>'type'='question' and b->>'questionType'='qr' then
   select value into m from jsonb_array_elements(coalesce(doc->'qrMissions','[]')) where value->>'id'=b->>'qrMissionId' or b->>'qrMissionId' is null and exists(select 1 from jsonb_array_elements(value->'codes') x where x->>'id'=b->>'qrId');
   select count(*) into n from jsonb_array_elements(coalesce(m->'codes','[]')) x where (x->>'active')::boolean;
   if m is null or not coalesce((m->>'active')::boolean,false) or n=0 or coalesce(b->>'qrScope','') not in ('student','team') then raise exception '%: 활성 QR과 완료 범위를 확인하세요.',label using errcode='22023';end if;
   if b->>'qrMissionId' is not null then
    if m->>'blockId' is distinct from b->>'id' or m->>'scope' is distinct from b->>'qrScope' or m->>'mode' not in ('ANY','ALL','N_OF_M','UNIQUE_MEMBER') then raise exception '%: QR 문제 연결을 확인하세요.',label using errcode='22023';end if;
    if m->>'mode'='N_OF_M' and ((m->>'count')::integer<1 or (m->>'count')::integer>n) then raise exception '%: 필요한 QR 개수를 확인하세요.',label using errcode='22023';end if;
    if m->>'mode'='UNIQUE_MEMBER' and (doc->>'playMode'<>'team' or b->>'qrScope'<>'team') then raise exception '%: 팀원별 QR은 팀전·팀 전체에서 사용하세요.',label using errcode='22023';end if;
   end if;
  end if;
 end loop;
 if exists(with recursive refs as(select x->>'id' ref,x->>'blockId' owner from jsonb_array_elements(coalesce(doc->'qrMissions','[]')) x union all select y->>'id',x->>'blockId' from jsonb_array_elements(coalesce(doc->'qrMissions','[]')) x,jsonb_array_elements(x->'codes') y), edges as(select item.value->>'id' src,coalesce(refs.owner,edge.value->>'blockId') dst from jsonb_array_elements(doc->'content') item cross join lateral jsonb_array_elements(item.value#>'{unlock,conditions}') edge left join refs on refs.ref=edge.value->>'blockId'), walk as(
  select src,dst,array[src] path,src=dst cycle from edges union all select w.src,e.dst,w.path||w.dst,e.dst=any(w.path||w.dst) from walk w join edges e on e.src=w.dst where not w.cycle and cardinality(w.path)<=200)
  select 1 from walk where cycle) then raise exception '공개 조건이 순환합니다.' using errcode='22023';end if;
end; $$;

alter function public.escape_teacher_lobby(text,uuid) set schema escape_private;
alter function escape_private.escape_teacher_lobby(text,uuid) rename to teacher_lobby_v8;
create function public.escape_teacher_lobby(p_action text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.escape_contents;s public.escape_sessions;
begin
 if p_action='open' then
  select * into c from public.escape_contents where id=p_id and owner_id=auth.uid() for update;
  if not found then raise exception '본인 콘텐츠만 열 수 있습니다.' using errcode='42501';end if;
  c.document:=escape_private.clean_document(c.document);
  update public.escape_contents set document=c.document where id=c.id and document is distinct from c.document;
  -- Returning to an existing class must work even while the author edits an incomplete draft.
  if not exists(select 1 from public.escape_sessions where content_id=c.id and status<>'finished') then
   perform escape_private.assert_runnable(c.document);
   select * into s from public.escape_sessions where content_id=c.id and status='finished' order by created_at desc limit 1 for update;
   -- Starting the next class preserves the previous result through the existing reset transaction.
   if found then return public.escape_finish_reset(s.id,'reset',true,gen_random_uuid(),true);end if;
  end if;
 elsif p_action='start' then
  select * into s from public.escape_sessions where id=p_id and owner_id=auth.uid() for update;
  if not found then raise exception '본인 수업만 시작할 수 있습니다.' using errcode='42501';end if;
  if s.status='lobby' then perform escape_private.assert_runnable(s.content_snapshot);end if;
 end if;
 return escape_private.teacher_lobby_v8(p_action,p_id);
end; $$;

-- Keep 007's complete validation routine private; all public QR paths now pass the current-block guard.
alter function public.escape_scan_qr(text,text) set schema escape_private;
alter function escape_private.escape_scan_qr(text,text) rename to scan_qr_v7;

create or replace function escape_private.qr_state(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;m jsonb;v jsonb;scans jsonb;members jsonb;done boolean;total integer;found integer;out jsonb:='[]';
begin
 select * into p from public.escape_participants where id=p_actor;
 select * into s from public.escape_sessions where id=p.session_id;
 for m in select value from jsonb_array_elements(coalesce(s.content_snapshot->'qrMissions','[]')) where (value->>'active')::boolean loop
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'member',a.member_number,'role',a.role_name)),'[]') into members from public.escape_participants a
  where a.session_id=s.id and a.left_at is null and (case when s.content_snapshot->>'playMode'='team' and m->>'scope'='team' then a.team_number=p.team_number else a.id=p.id end);
  select coalesce(jsonb_agg(jsonb_build_object('qrId',q.qr_id,'actorId',q.participant_id,'member',q.event_member,'role',q.event_role)),'[]') into scans
  from public.escape_qr_scans q where q.session_id=s.id and q.mission_id=(m->>'id')::uuid
   and q.subject_key=case when m->>'blockId' is not null and m->>'scope'='student' then 'p:'||p.id else escape_private.result_key(p.id) end and (p.progress_reset_at is null or q.created_at>=p.progress_reset_at)
   and (m->>'scope'='team' or q.participant_id=p.id)
   and exists(select 1 from jsonb_array_elements(m->'codes') c where c->>'id'=q.qr_id::text and (c->>'active')::boolean);
  select count(*) into total from jsonb_array_elements(m->'codes') c where (c->>'active')::boolean;
  found:=jsonb_array_length(scans);
  done:=total>0 and case m->>'mode' when 'ANY' then found>=1 when 'ALL' then found>=total when 'N_OF_M' then found>=(m->>'count')::integer
    when 'UNIQUE_MEMBER' then jsonb_array_length(members)>0 and not exists(select 1 from jsonb_array_elements(members) a where not exists(select 1 from jsonb_array_elements(scans) q where q->>'actorId'=a->>'id')) else false end;
  out:=out||jsonb_build_array(jsonb_build_object('id',m->>'id','name',m->>'name','mode',m->>'mode','scope',m->>'scope','found',found,'total',total,'done',done,'scans',scans));
 end loop;return out;
end; $$;



create or replace function escape_private.qr_public(p_actor uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(m-'scans'-'id'),'[]') from public.escape_participants p join public.escape_sessions s on s.id=p.session_id,
 lateral jsonb_array_elements(s.content_snapshot->'content') b,lateral jsonb_array_elements(escape_private.qr_state(p_actor)) m
 where p.id=p_actor and s.status='playing' and b->>'id'=p.progress->>'currentBlockId' and b->>'type'='question' and b->>'questionType'='qr'
 and (m->>'id'=b->>'qrMissionId' or b->>'qrMissionId' is null and exists(select 1 from jsonb_array_elements(s.content_snapshot->'qrMissions') source,jsonb_array_elements(source->'codes') q where source->>'id'=m->>'id' and q->>'id'=b->>'qrId'));
$$;

create function escape_private.scan_current_qr(p_token text,p_qr text,p_block uuid default null) returns jsonb language plpgsql set search_path='' as $$
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
 select exists(select 1 from public.escape_qr_scans where session_id=s.id and subject_key=key and qr_id=(q->>'id')::uuid) into duplicate;
 v:=escape_private.scan_qr_v7(p_token,p_qr);
 -- 007's team claim remains canonical for team-wide blocks. For scanner-only blocks,
 -- move its validated claim to the participant namespace under the same session lock.
 if key<>escape_private.result_key(p.id) then
  insert into public.escape_qr_scans(session_id,participant_id,mission_id,qr_id,subject_key,event_team,event_member,event_role)
  values(s.id,p.id,(m->>'id')::uuid,(q->>'id')::uuid,key,p.team_number,p.member_number,p.role_name) on conflict do nothing;
  delete from public.escape_qr_scans where session_id=s.id and subject_key=escape_private.result_key(p.id) and qr_id=(q->>'id')::uuid;
 end if;
 select coalesce((value->>'done')::boolean,false) into done from jsonb_array_elements(escape_private.qr_state(p.id)) where value->>'id'=m->>'id';
 if b->>'qrMissionId' is null then done:=true;end if;
 if done then perform escape_private.complete_block(p.id,b,'student');end if;
 perform escape_private.sync_play(s.id);
 update public.escape_sessions set progress_revision=progress_revision+1 where id=s.id;
 return jsonb_build_object('duplicate',duplicate,'completed',done,'message',case when done then 'QR 문제를 완료했습니다.' when duplicate then '이미 찾은 QR입니다. 다른 QR을 찾아보세요.' else 'QR 단서를 발견했습니다. 다음 QR을 찾아보세요.' end,'game',escape_private.student_projection(p.id));
end; $$;
create function public.escape_scan_qr(p_token text,p_qr text) returns jsonb language sql security definer set search_path='' as $$select escape_private.scan_current_qr(p_token,p_qr);$$;
create or replace function public.escape_answer_qr(p_token text,p_block uuid,p_qr text) returns jsonb language sql security definer set search_path='' as $$select escape_private.scan_current_qr(p_token,p_qr,p_block);$$;

alter function escape_private.public_block(jsonb) rename to public_block_v8;
create function escape_private.public_block(p_block jsonb) returns jsonb language sql immutable set search_path='' as $$
 select escape_private.public_block_v8(p_block)||jsonb_build_object('backgroundUrl',p_block->>'backgroundUrl');
$$;
alter function escape_private.student_projection(uuid) rename to student_projection_v8;
create function escape_private.student_projection(p_actor uuid) returns jsonb language sql stable set search_path='' as $$
 select escape_private.student_projection_v8(p_actor)||jsonb_build_object('theme',jsonb_build_object('color',s.content_snapshot#>>'{theme,color}'))
 from public.escape_participants p join public.escape_sessions s on s.id=p.session_id where p.id=p_actor;
$$;

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
    then coalesce(role_names->>(case when n.num=1 then 0 else least(1,jsonb_array_length(role_names)-1) end),'조원') else '조원' end
    from numbered n where p.id=n.id;
  update public.escape_sessions set play_version=1, progress_revision=progress_revision+1 where id=new.id;
  perform escape_private.sync_play(new.id);
  return new;
end;
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
    available:=case when forced in ('complete','skip') then false when forced='open' then true else (not complete and not mine and (s.content_snapshot->>'playMode'='individual' or escape_private.assigned(b,m,ctx->'members',i)) and
      (case when jsonb_array_length(b#>'{unlock,conditions}')>0 then escape_private.unlocked(b->'unlock',ctx->'events') else prior_done end)) end;
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


-- Only obsolete wait blocks are removed from existing active snapshots; archives remain immutable.
do $$declare s record;begin
 for s in select id,content_snapshot from public.escape_sessions where status<>'finished' and exists(select 1 from jsonb_array_elements(content_snapshot->'content') b where b->>'type'='wait') for update loop
  update public.escape_sessions set content_snapshot=escape_private.clean_document(s.content_snapshot) where id=s.id;
  perform escape_private.sync_play(s.id);
  update public.escape_sessions set progress_revision=progress_revision+1 where id=s.id;
 end loop;
end;$$;

revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_class_states(),public.escape_teacher_lobby(text,uuid),public.escape_scan_qr(text,text),public.escape_answer_qr(text,uuid,text) from public,anon,authenticated;
grant execute on function public.escape_class_states(),public.escape_teacher_lobby(text,uuid) to authenticated;
grant execute on function public.escape_scan_qr(text,text),public.escape_answer_qr(text,uuid,text) to anon;
notify pgrst,'reload schema';
commit;
