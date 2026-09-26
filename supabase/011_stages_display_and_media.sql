-- Apply once after 010. Existing migrations and running snapshots are unchanged.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('escape-media','escape-media',true,104857600,array['image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/ogg','audio/webm','video/mp4','video/webm'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Tombstones serialize reference creation against Storage API deletion, including lost responses.
-- Actual bytes are removed ONLY by the Storage API, never by DELETE FROM storage.objects here.
create table escape_private.media_retired(path text primary key,retired_at timestamptz not null default now());
revoke all on escape_private.media_retired from public,anon,authenticated;
create function escape_private.media_paths(doc jsonb) returns setof text language sql immutable set search_path='' as $$
 select distinct substring(v#>>'{}' from '/storage/v1/object/public/escape-media/([0-9a-f-]{36}/[0-9a-f-]{36}/(?:images|audio|video|backgrounds)/[0-9a-f-]{36}\.[a-z0-9]+)')
 from jsonb_path_query(doc,'$.** ? (@.type() == "string")') v
 where (v#>>'{}') ~ '/storage/v1/object/public/escape-media/';
$$;
create function escape_private.media_referenced(p_path text) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.escape_contents c where p_path in(select escape_private.media_paths(c.document)))
 or exists(select 1 from public.escape_sessions s where s.status in ('lobby','playing','paused') and p_path in(select escape_private.media_paths(s.content_snapshot)));
$$;
create function escape_private.protect_media_references() returns trigger language plpgsql security definer set search_path='' as $$
declare doc jsonb;
begin
 if tg_table_name='escape_contents' then doc:=new.document;
 else
  if tg_op='UPDATE' and new.content_snapshot=old.content_snapshot then return new;end if;
  doc:=new.content_snapshot;
 end if;
 perform pg_advisory_xact_lock(711011);
 if exists(select 1 from escape_private.media_retired r where r.path in(select escape_private.media_paths(doc))) then
  raise exception '이미 삭제된 업로드 파일을 참조하고 있습니다. 자료를 다시 업로드하세요.' using errcode='22023';
 end if;
 return new;
end;$$;
create trigger escape_media_content_refs before insert or update of document on public.escape_contents for each row execute function escape_private.protect_media_references();
create trigger escape_media_snapshot_refs before insert or update of content_snapshot on public.escape_sessions for each row execute function escape_private.protect_media_references();

create function public.escape_storage_owned(p_name text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and split_part(p_name,'/',1)=auth.uid()::text
 and p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(images|audio|video|backgrounds)/[0-9a-f-]{36}\.[a-z0-9]+$';
$$;
create function public.escape_storage_can_insert(p_name text) returns boolean language sql volatile security definer set search_path='' as $$
 select public.escape_storage_owned(p_name) and exists(select 1 from public.escape_contents where id::text=split_part(p_name,'/',2) and owner_id=auth.uid())
 and not exists(select 1 from escape_private.media_retired where path=p_name);
$$;
create function public.escape_storage_can_delete(p_name text) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if not public.escape_storage_owned(p_name) then return false;end if;
 perform pg_advisory_xact_lock(711011);
 if escape_private.media_referenced(p_name) then return false;end if;
 insert into escape_private.media_retired(path) values(p_name) on conflict do nothing;
 return true;
end;$$;
create policy escape_media_owner_read on storage.objects for select to authenticated using(bucket_id='escape-media' and public.escape_storage_owned(name));
create policy escape_media_owner_insert on storage.objects for insert to authenticated with check(bucket_id='escape-media' and public.escape_storage_can_insert(name));
create policy escape_media_owner_delete on storage.objects for delete to authenticated using(bucket_id='escape-media' and public.escape_storage_can_delete(name));
-- Scope restrictive guards to this bucket so older broad project policies cannot bypass ownership.
create policy escape_media_insert_guard on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'escape-media' or public.escape_storage_can_insert(name));
create policy escape_media_delete_guard on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'escape-media' or public.escape_storage_can_delete(name));
create policy escape_media_update_guard on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'escape-media') with check(bucket_id<>'escape-media');
-- No UPDATE/upsert policy: replacement always uses a fresh UUID to preserve snapshots.

create function public.escape_unused_media(p_paths text[]) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception '교사 로그인이 필요합니다.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(path),'[]') from unnest(p_paths) path where public.escape_storage_owned(path) and not escape_private.media_referenced(path));
end;$$;
create function public.escape_room_media(p_content uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.escape_contents where id=p_content and owner_id=auth.uid()) then raise exception '본인 콘텐츠만 관리할 수 있습니다.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(name),'[]') from storage.objects where bucket_id='escape-media' and split_part(name,'/',1)=auth.uid()::text and split_part(name,'/',2)=p_content::text);
end;$$;
create function public.escape_library_sessions() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('contentId',content_id,'sessionId',id,'status',status)),'[]') from
 (select distinct on(content_id) content_id,id,status from public.escape_sessions where owner_id=auth.uid() order by content_id,(status<>'finished') desc,created_at desc) s;
$$;
create function public.escape_delete_archives(p_content uuid,p_confirm boolean default false) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform 1 from public.escape_contents where id=p_content and owner_id=auth.uid() for update;
 if not found then raise exception '본인 수업 기록만 삭제할 수 있습니다.' using errcode='42501';end if;
 if not coalesce(p_confirm,false) then raise exception '기록 삭제 확인이 필요합니다.' using errcode='22023';end if;
 delete from public.escape_result_archives where content_id=p_content and owner_id=auth.uid();get diagnostics n=row_count;return n;
end;$$;

alter function escape_private.student_projection(uuid) rename to student_projection_v10;
create function escape_private.student_projection(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare v jsonb;p public.escape_participants;s public.escape_sessions;g record;r jsonb;used integer;stage_name text;policy jsonb;
begin
 select * into p from public.escape_participants where id=p_actor;select * into s from public.escape_sessions where id=p.session_id;
 v:=escape_private.student_projection_v10(p_actor);r:=escape_private.result_rules(s.content_snapshot);
 select * into g from escape_private.result_groups(s.id) where subject_key=escape_private.result_key(p_actor);
 select value->>'name' into stage_name from jsonb_array_elements(coalesce(s.content_snapshot->'stageGroups','[]')) with ordinality a(value,n) where n::text=v#>>'{current,stage}';
 select coalesce(jsonb_object_agg(key,value),'{}') into policy from jsonb_each(coalesce(s.content_snapshot->'studentDisplaySettings','{}')) where value#>>'{}' in ('always','info','hidden') and key=any(array['title','description','stage','stageName','progress','completed','elapsed','remaining','connection','mode','student','team','role','score','wrong','hints','penalty','rank','board','blockTitle','blockType']);
 select count(*) into used from public.escape_hint_uses h join public.escape_participants a on a.id=h.participant_id where h.session_id=s.id and
 case r->>'hints' when 'individual' then h.participant_id=p.id when 'team' then case when s.content_snapshot->>'playMode'='individual' then h.participant_id=p.id else a.team_number is not distinct from p.team_number end when 'stage' then h.stage=v#>>'{current,stage}' else true end;
 return v||jsonb_build_object('studentDisplaySettings',policy,'description',s.content_snapshot->>'description','stageName',coalesce(stage_name,''),'studentName',p.display_name,
 'theme',jsonb_build_object('color',s.content_snapshot#>>'{theme,color}','background',s.content_snapshot#>>'{theme,background}','bgm',s.content_snapshot#>>'{theme,bgm}'),
 'design',jsonb_build_object('backgroundColor',s.content_snapshot#>>'{design,backgroundColor}','text',s.content_snapshot#>>'{design,text}','card',s.content_snapshot#>>'{design,card}'),
 'sound',jsonb_build_object('volume',coalesce(s.content_snapshot#>'{sound,volume}','0.35'),'allowMute',coalesce(s.content_snapshot#>'{sound,allowMute}','true')),
 'displayStats',jsonb_build_object('timeLimit',(s.content_snapshot#>>'{rules,timeLimit}')::numeric,'hintsUsed',g.hint_count,'hintsRemaining',case when r->>'hints'='unlimited' then null else greatest(0,(r->>'hintLimit')::integer-used) end,
 'score',case when coalesce((r->>'scoreEnabled')::boolean,false) then greatest(0,g.base_score-case when r->>'wrongPenaltyType'='score' then g.wrong_count*(r->>'wrongPenalty')::numeric else 0 end-case when r->>'hintPenaltyType'='score' then g.hint_count*(r->>'hintPenalty')::numeric else 0 end) end,
 'wrongCount',g.wrong_count,'penaltySeconds',case when r->>'wrongPenaltyType'='time' then g.wrong_count*(r->>'wrongPenalty')::numeric else 0 end+case when r->>'hintPenaltyType'='time' then g.hint_count*(r->>'hintPenalty')::numeric else 0 end,
 'penaltyPoints',case when r->>'wrongPenaltyType'='score' then g.wrong_count*(r->>'wrongPenalty')::numeric else 0 end+case when r->>'hintPenaltyType'='score' then g.hint_count*(r->>'hintPenalty')::numeric else 0 end));
end;$$;

-- Extend 010 warnings/cleanup to room defaults. Do not rewrite any existing snapshots.
alter function escape_private.asset_warnings(jsonb) rename to asset_warnings_v10;
create function escape_private.asset_warnings(doc jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare out jsonb:=escape_private.asset_warnings_v10(doc);k text;
begin foreach k in array array['background','bgm'] loop
 if coalesce(doc#>>array['theme',k],'')<>'' and not escape_private.asset_url_valid(doc#>>array['theme',k]) then out:=out||jsonb_build_array('전체 설정: 배경 이미지 또는 음악 URL을 확인하세요.');end if;
 end loop;return out;end;$$;
alter function escape_private.safe_play_document(jsonb,text[]) rename to safe_play_document_v10;
create function escape_private.safe_play_document(doc jsonb,failed_assets text[] default '{}') returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;begin doc:=escape_private.safe_play_document_v10(doc,failed_assets);
 foreach k in array array['background','bgm'] loop
 if not escape_private.asset_url_valid(doc#>>array['theme',k]) or doc#>>array['theme',k]=any(failed_assets) then doc:=jsonb_set(doc,array['theme',k],'""');end if;
 end loop;return doc;end;$$;
alter function escape_private.assert_runnable(jsonb) rename to assert_runnable_v10;
create function escape_private.assert_runnable(doc jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform escape_private.assert_runnable_v10(doc);
 if doc ? 'studentDisplaySettings' then
  if jsonb_typeof(doc->'studentDisplaySettings')<>'object' then raise exception '학생 표시 설정을 확인하세요.' using errcode='22023';end if;
  if exists(select 1 from jsonb_each(doc->'studentDisplaySettings') where value#>>'{}' not in ('always','info','hidden') or jsonb_typeof(value)<>'string') then raise exception '학생 표시 설정을 확인하세요.' using errcode='22023';end if;
 end if;
 if doc ? 'stageGroups' then
  if jsonb_typeof(doc->'stageGroups')<>'array' then raise exception '스테이지 형식을 확인하세요.' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(doc->'stageGroups') g where coalesce(g->>'id','')='' or jsonb_typeof(g->'name') is distinct from 'string') or (select count(*)<>count(distinct g->>'id') from jsonb_array_elements(doc->'stageGroups') g) then raise exception '스테이지 ID와 이름을 확인하세요.' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(doc->'content') b where not exists(select 1 from jsonb_array_elements(doc->'stageGroups') with ordinality a(g,n) where g->>'id'=b->>'stageId' and n::text=b->>'stage')) then raise exception '블록 소속 스테이지를 확인하세요.' using errcode='22023';end if;
 end if;
 if doc ? 'sound' and (coalesce((doc#>>'{sound,volume}')::numeric,0) not between 0 and 1 or jsonb_typeof(doc#>'{sound,allowMute}') is distinct from 'boolean') then raise exception '음악 설정을 확인하세요.' using errcode='22023';end if;
 if doc ? 'design' and (coalesce(doc#>>'{design,text}','auto') not in ('auto','light','dark') or coalesce(doc#>>'{design,card}','light') not in ('light','dark','glass') or coalesce(doc#>>'{design,backgroundColor}','') !~* '^#[a-f0-9]{6}$') then raise exception '화면 디자인 설정을 확인하세요.' using errcode='22023';end if;
end;$$;
revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_storage_owned(text),public.escape_storage_can_insert(text),public.escape_storage_can_delete(text),public.escape_unused_media(text[]),public.escape_room_media(uuid),public.escape_library_sessions(),public.escape_delete_archives(uuid,boolean) from public,anon,authenticated;
grant execute on function public.escape_storage_owned(text),public.escape_storage_can_insert(text),public.escape_storage_can_delete(text),public.escape_unused_media(text[]),public.escape_room_media(uuid),public.escape_library_sessions(),public.escape_delete_archives(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
