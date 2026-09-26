-- Apply once AFTER 009. No existing migration, author document, archive or running snapshot is rewritten.
begin;
alter table public.escape_sessions add column snapshot_source_hash text, add column assets_acknowledged boolean not null default false;
-- Historical snapshots only receive provenance when their normalized content actually matches.
update public.escape_sessions s set snapshot_source_hash=md5(c.document::text)
from public.escape_contents c where c.id=s.content_id and s.status='lobby' and s.content_snapshot=escape_private.clean_document(c.document);

create or replace function escape_private.prepare_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 new.snapshot_source_hash:=md5(new.content_snapshot::text);
 new.content_snapshot:=escape_private.clean_document(new.content_snapshot);
 return new;
end;$$;

create function escape_private.asset_url_valid(v text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(v ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$',false);
$$;
create function escape_private.asset_warnings(doc jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare b jsonb;m jsonb;out jsonb:='[]';label text;n integer:=0;
begin
 for b in select value from jsonb_array_elements(doc->'content') loop
  n:=n+1;label:=n||'. '||coalesce(b->>'title','제목 없는 블록');
  if b->>'display' in ('image','immersive') and not escape_private.asset_url_valid(b->>'backgroundUrl') then out:=out||jsonb_build_array(label||': 배경 이미지를 사용할 수 없습니다.');end if;
  for m in select value from jsonb_array_elements(coalesce(b->'media','[]')) loop
   if btrim(coalesce(m->>'url',''))<>'' and not escape_private.asset_url_valid(m->>'url') then out:=out||jsonb_build_array(label||': 자료를 사용할 수 없습니다.');end if;
  end loop;
 end loop;return out;
end;$$;
create function escape_private.safe_play_document(doc jsonb,failed_assets text[] default '{}') returns jsonb language plpgsql immutable set search_path='' as $$
declare b jsonb;items jsonb:='[]';
begin
 doc:=escape_private.clean_document(doc);
 for b in select value from jsonb_array_elements(doc->'content') loop
  b:=jsonb_set(b,'{media}',(select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(coalesce(b->'media','[]')) where escape_private.asset_url_valid(value->>'url') and not (value->>'url'=any(failed_assets))));
  if b->>'display' in ('image','immersive') and (not escape_private.asset_url_valid(b->>'backgroundUrl') or b->>'backgroundUrl'=any(failed_assets)) then
   b:=jsonb_set(b,'{backgroundUrl}','""');
   if b->>'display'='image' then b:=jsonb_set(b,'{display}','"theme"');end if;
  end if;
  items:=items||jsonb_build_array(b);
 end loop;return jsonb_set(doc,'{content}',items);
end;$$;
create or replace function escape_private.assert_runnable(doc jsonb) returns void language plpgsql set search_path='' as $$
declare b jsonb;c jsonb;m jsonb;q jsonb;n integer;label text;
begin
 if doc->>'schemaVersion' is distinct from '1' or coalesce(doc->>'playMode','') not in ('individual','team') then raise exception '콘텐츠 기본 구조를 확인하세요.' using errcode='22023';end if;
 if coalesce((doc#>>'{teamSettings,teamCount}')::integer,0) not between 1 and 20 or ((doc#>>'{teamSettings,maxMembers}') is not null and (doc#>>'{teamSettings,maxMembers}')::integer not between 1 and 20) then raise exception '팀 설정을 확인하세요.' using errcode='22023';end if;
 if jsonb_typeof(doc->'content') is distinct from 'array' or jsonb_array_length(doc->'content')=0 then raise exception '실행할 콘텐츠를 추가하세요.' using errcode='22023';end if;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(doc->'content')) then raise exception '중복되거나 누락된 블록 ID입니다.' using errcode='22023';end if;
 if doc#>>'{rules,finishMode}'='final' and not exists(select 1 from jsonb_array_elements(doc->'content') x where x->>'id'=doc#>>'{rules,finalBlockId}') then raise exception '최종 완료 콘텐츠를 선택하세요.' using errcode='22023';end if;
 for b in select value from jsonb_array_elements(doc->'content') loop
  if coalesce(b->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(b->>'type','') not in ('story','guide','question') or coalesce(b->>'questionType','') not in ('short','number','choice','multi','ox','order','match','cipher','switch','condition','approval','qr') then raise exception '지원하지 않는 블록 구조입니다.' using errcode='22023';end if;
  label:=coalesce(b->>'title','제목 없는 블록');
  if b->>'display'='immersive' and b->>'type'<>'story' then raise exception '몰입형 표시는 스토리에서만 사용합니다.' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(coalesce(b->'media','[]')) asset where coalesce(asset->>'type','') not in ('image','video','audio')) then raise exception '자료 유형을 확인하세요.' using errcode='22023';end if;
  if b->>'type'='question' and b->>'questionType' in ('choice','multi','order') and exists(select 1 from jsonb_array_elements_text(b->'answers') a where not (b->'options') ? a) then raise exception '%: 정답과 선택지를 확인하세요.',label using errcode='22023';end if;
  if b->>'type'='question' and b->>'questionType' in ('order','match') and jsonb_array_length(b->'answers')<>jsonb_array_length(b->'options') then raise exception '%: 정답과 항목 개수를 맞추세요.',label using errcode='22023';end if;
  if b->>'type' not in ('story','guide','question') or b->>'display' not in ('card','theme','image','full','immersive') then raise exception '%: 블록 유형 또는 표시 방식을 확인하세요.',label using errcode='22023';end if;
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

-- Owner-only optimistic concurrency: content row THEN session row, matching reset's lock order.
create function public.escape_lobby_snapshot(p_content uuid,p_action text default 'inspect',p_session uuid default null,p_version text default null,p_snapshot_version text default null,p_allow_assets boolean default false,p_failed_assets text[] default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.escape_contents;s public.escape_sessions;doc jsonb;v text;out jsonb;active_exists boolean;
begin
 select * into c from public.escape_contents where id=p_content and owner_id=auth.uid() for update;
 if not found then raise exception '본인 콘텐츠만 관리할 수 있습니다.' using errcode='42501';end if;
 select * into s from public.escape_sessions where content_id=c.id and status<>'finished' order by created_at desc limit 1 for update;
 active_exists:=found;v:=md5(c.document::text);
 if p_action='inspect' then
  return jsonb_build_object('version',v,'document',c.document,'changed',active_exists and s.status='lobby' and s.snapshot_source_hash is distinct from v,
   'snapshotVersion',case when active_exists then md5(s.content_snapshot::text) end,'snapshot',case when active_exists and s.status='lobby' then s.content_snapshot end,
   'assetsAcknowledged',coalesce(s.assets_acknowledged,false),'state',case when active_exists then escape_private.roster(s.id) end);
 end if;
 if p_action='open' and active_exists then return escape_private.roster(s.id);end if;
 if p_action not in ('open','refresh','assets') or p_action is null then raise exception '지원하지 않는 작업입니다.' using errcode='22023';end if;
 if p_version is distinct from v then raise exception '제작본이 다시 변경되었습니다. 대기실을 다시 열어 확인하세요.' using errcode='40001';end if;
 if p_action in ('refresh','assets') then
  if not active_exists or p_session is distinct from s.id or s.status<>'lobby' then raise exception '대기 상태에서만 제작본을 반영할 수 있습니다.' using errcode='22023';end if;
  if p_snapshot_version is distinct from md5(s.content_snapshot::text) then raise exception '대기실 내용이 변경되었습니다. 다시 확인하세요.' using errcode='40001';end if;
 end if;
 doc:=escape_private.clean_document(case when p_action='assets' then s.content_snapshot else c.document end);
 perform escape_private.assert_runnable(doc);
 if jsonb_array_length(escape_private.asset_warnings(doc))>0 and not coalesce(p_allow_assets,false) then raise exception '일부 자료에 문제가 있습니다. 자료 없이 시작할지 확인하세요.' using errcode='22023';end if;
 if cardinality(coalesce(p_failed_assets,'{}'))>0 and not coalesce(p_allow_assets,false) then raise exception '자료 제외 확인이 필요합니다.' using errcode='22023';end if;
 if p_action='refresh' and exists(select 1 from public.escape_participants where session_id=s.id and left_at is null) then
  if doc->>'playMode' is distinct from s.content_snapshot->>'playMode' then raise exception '참가자가 있는 대기실의 개인전/팀전 방식은 변경할 수 없습니다.' using errcode='22023';end if;
  if exists(select 1 from public.escape_participants where session_id=s.id and left_at is null and team_number>(doc#>>'{teamSettings,teamCount}')::integer)
   or exists(select 1 from public.escape_participants where session_id=s.id and left_at is null and team_number is not null group by team_number having count(*)>(doc#>>'{teamSettings,maxMembers}')::integer) then raise exception '현재 팀 편성을 유지할 수 없는 팀 수 또는 정원입니다.' using errcode='22023';end if;
 end if;
 if p_action='open' then
  select * into s from public.escape_sessions where content_id=c.id and status='finished' order by created_at desc limit 1 for update;
  if found then out:=public.escape_finish_reset(s.id,'reset',true,gen_random_uuid(),true);
  else out:=escape_private.teacher_lobby_v2('open',c.id);end if;
  select * into s from public.escape_sessions where id=(out->>'sessionId')::uuid;
 end if;
 update public.escape_sessions set content_snapshot=escape_private.safe_play_document(doc,coalesce(p_failed_assets,'{}')),
  snapshot_source_hash=case when p_action='assets' then snapshot_source_hash else v end,assets_acknowledged=true,progress_revision=progress_revision+1 where id=s.id;
 -- Lobby has no play events yet. Existing start_play initializes members and recomputes all conditions.
 return escape_private.roster(s.id);
end;$$;

create or replace function public.escape_teacher_lobby(p_action text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.escape_contents;s public.escape_sessions;
begin
 if p_action='open' then
  select * into c from public.escape_contents where id=p_id and owner_id=auth.uid() for update;
  if not found then raise exception '본인 콘텐츠만 열 수 있습니다.' using errcode='42501';end if;
  return public.escape_lobby_snapshot(c.id,'open',null,md5(c.document::text));
 end if;
 if p_action='start' then
  perform 1 from public.escape_contents cc join public.escape_sessions ss on ss.content_id=cc.id where ss.id=p_id and cc.owner_id=auth.uid() for update of cc;
  select * into s from public.escape_sessions where id=p_id and owner_id=auth.uid() for update;
  if not found then raise exception '본인 수업만 시작할 수 있습니다.' using errcode='42501';end if;
  if s.status='lobby' then
   perform escape_private.assert_runnable(s.content_snapshot);
   if not s.assets_acknowledged and jsonb_array_length(escape_private.asset_warnings(s.content_snapshot))>0 then raise exception '일부 자료에 문제가 있습니다. 대기실을 다시 열어 자료 경고를 확인하세요.' using errcode='22023';end if;
  end if;
 end if;
 return escape_private.teacher_lobby_v8(p_action,p_id);
end;$$;

alter function escape_private.public_block(jsonb) rename to public_block_v9;
create function escape_private.public_block(p_block jsonb) returns jsonb language sql immutable set search_path='' as $$
 select escape_private.public_block_v9(p_block)||jsonb_build_object('immersiveOverlay',coalesce(p_block->'immersiveOverlay','true'::jsonb));
$$;
revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_lobby_snapshot(uuid,text,uuid,text,text,boolean,text[]),public.escape_teacher_lobby(text,uuid) from public,anon,authenticated;
grant execute on function public.escape_lobby_snapshot(uuid,text,uuid,text,text,boolean,text[]),public.escape_teacher_lobby(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
