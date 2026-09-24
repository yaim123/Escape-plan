-- Apply once AFTER 004. Preserve completion history when a student changes teams.
begin;
drop index public.escape_completion_event_once;
create unique index escape_completion_event_once on public.escape_events(participant_id,block_id,event_type,event_team,event_member) nulls not distinct
  where event_type in ('complete','button','approved');
create or replace function public.escape_teacher_control(p_session uuid,p_action text,p_scope text default 'student',p_participant uuid default null,p_team integer default null,
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
        select greatest(
          coalesce((select max(member_number) from public.escape_participants where session_id=s.id and team_number=p_new_team),0),
          coalesce((select max(event_member) from public.escape_events where session_id=s.id and event_team=p_new_team),0)
        )+1 into next_member;
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

notify pgrst,'reload schema';
commit;
