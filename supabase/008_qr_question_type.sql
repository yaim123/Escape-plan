-- Apply once after 007. No table/RLS changes; existing QR missions keep their RPC.
begin;

alter function escape_private.play_context(uuid) rename to play_context_v7;
create function escape_private.play_context(p_actor uuid) returns jsonb
language sql stable set search_path='' as $$
 select escape_private.play_context_v7(p_actor)||jsonb_build_object('actorMember',p.member_number)
 from public.escape_participants p where p.id=p_actor;
$$;
alter function escape_private.completed(jsonb,jsonb,integer,boolean) rename to completed_v7;
create function escape_private.completed(p_block jsonb,p_context jsonb,p_index integer,p_individual boolean) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if p_block->>'type'='question' and p_block->>'questionType'='qr' then
  return exists(select 1 from jsonb_array_elements(p_context->'events') e
   where e->>'blockId'=p_block->>'id' and e->>'type'='complete'
   and (not p_individual and p_block->>'qrScope'='team' or e->>'member'=p_context->>'actorMember'));
 end if;
 return escape_private.completed_v7(p_block,p_context,p_index,p_individual);
end; $$;

-- Ordinary answer submission can never complete a QR question, including imported stale answers.
alter function escape_private.answer_correct(jsonb,jsonb) rename to answer_correct_v7;
create function escape_private.answer_correct(p_block jsonb,p_input jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if p_block->>'questionType'='qr' then raise exception 'QR 코드 스캔을 사용하세요.' using errcode='22023';end if;
 return escape_private.answer_correct_v7(p_block,p_input);
end; $$;

create function public.escape_answer_qr(p_token text,p_block uuid,p_qr text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;b jsonb;state jsonb;v jsonb;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '먼저 방 코드로 입장하세요.' using errcode='42501';end if;
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 if not found then raise exception '참가 기록을 찾을 수 없습니다.' using errcode='42501';end if;
 -- Same lock as 007: scans, submissions, teacher actions and reset are serialized.
 select * into s from public.escape_sessions where id=p.session_id for update;
 select * into p from public.escape_participants where id=p.id and left_at is null;
 if s.id is null or p.id is null then raise exception '초기화된 수업입니다. 다시 입장하세요.' using errcode='42501';end if;
 if s.status<>'playing' or s.play_version<>1 then raise exception '게임 진행 중에만 QR을 사용할 수 있습니다.' using errcode='22023';end if;
 select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=p_block::text;
 if b is null or b->>'type'<>'question' or b->>'questionType'<>'qr' then raise exception '현재 QR 문제에서만 사용할 수 있습니다.' using errcode='42501';end if;
 -- Reject a different QR before calling 007, so even its mission receives no claim.
 if p_qr is null or not exists(select 1 from jsonb_array_elements(coalesce(s.content_snapshot->'qrMissions','[]')) m,
  lateral jsonb_array_elements(m->'codes') q where q->>'id'=b->>'qrId' and q->>'token'=p_qr) then
  raise exception '이 문제의 QR코드가 아닙니다.' using errcode='22023';
 end if;
 if exists(select 1 from public.escape_results where session_id=s.id and subject_key=escape_private.result_key(p.id)) then
  raise exception '이미 탈출을 완료했습니다.' using errcode='22023';end if;
 state:=escape_private.play_state(p.id);
 if state->'completedIds' ? p_block::text then
  return jsonb_build_object('duplicate',true,'message','이미 완료한 QR 문제입니다.','game',escape_private.student_projection(p.id));
 end if;
 if state->>'currentBlockId' is distinct from p_block::text or not(state->'availableIds' ? p_block::text) then
  raise exception '현재 공개된 QR 문제에서만 사용할 수 있습니다.' using errcode='42501';end if;
 -- Reuse 007's session/content/active/assignment checks and canonical deduplicated mission event.
 v:=public.escape_scan_qr(p_token,p_qr);
 -- A previously claimed mission QR can still solve another question or another scanner-only actor.
 perform escape_private.complete_block(p.id,b,'student');
 perform escape_private.sync_play(s.id);
 update public.escape_sessions set progress_revision=progress_revision+1 where id=s.id;
 return jsonb_build_object('duplicate',false,'message','QR 문제를 완료했습니다.','game',escape_private.student_projection(p.id));
end; $$;

create or replace function escape_private.start_play() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b jsonb; role_names jsonb:=new.content_snapshot#>'{teamSettings,roles}';
begin
  if jsonb_array_length(new.content_snapshot->'content')=0 then raise exception '콘텐츠를 하나 이상 추가하세요.' using errcode='22023'; end if;
  for b in select value from jsonb_array_elements(new.content_snapshot->'content') loop
    if b->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or b->>'type' not in ('story','question','guide','wait')
      or b->>'questionType' not in ('short','number','choice','multi','ox','order','match','cipher','switch','condition','approval','qr') then
      raise exception '지원하지 않는 콘텐츠 형식입니다.' using errcode='22023';
    end if;
    if b->>'type'='question' and b->>'questionType'='qr' and
      (coalesce(b->>'qrScope','') not in ('student','team') or not exists(
        select 1 from jsonb_array_elements(coalesce(new.content_snapshot->'qrMissions','[]')) m,
        lateral jsonb_array_elements(m->'codes') q where q->>'id'=b->>'qrId' and (m->>'active')::boolean and (q->>'active')::boolean)) then
      raise exception 'QR 문제의 활성 통과 QR과 완료 범위를 확인하세요.' using errcode='22023';
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


revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_answer_qr(text,uuid,text) from public,anon,authenticated;
grant execute on function public.escape_answer_qr(text,uuid,text) to anon;
notify pgrst,'reload schema';
commit;
