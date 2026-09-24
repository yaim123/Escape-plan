-- Apply once after 006. QR capabilities never contain answers or participant credentials.
begin;
create table public.escape_qr_scans (
 id bigint generated always as identity primary key,
 session_id uuid not null references public.escape_sessions(id) on delete cascade,
 participant_id uuid not null references public.escape_participants(id) on delete cascade,
 mission_id uuid not null,qr_id uuid not null,subject_key text not null,
 event_team integer,event_member integer not null,event_role text not null,
 created_at timestamptz not null default now(),
 unique(session_id,subject_key,qr_id)
);
alter table public.escape_qr_scans enable row level security;
revoke all on public.escape_qr_scans from public,anon,authenticated;
revoke all on sequence public.escape_qr_scans_id_seq from public,anon,authenticated;

create function escape_private.qr_state(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;m jsonb;v jsonb;scans jsonb;members jsonb;done boolean;total integer;found integer;out jsonb:='[]';
begin
 select * into p from public.escape_participants where id=p_actor;
 select * into s from public.escape_sessions where id=p.session_id;
 for m in select value from jsonb_array_elements(coalesce(s.content_snapshot->'qrMissions','[]')) where (value->>'active')::boolean loop
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'member',a.member_number,'role',a.role_name)),'[]') into members from public.escape_participants a
  where a.session_id=s.id and a.left_at is null and (case when s.content_snapshot->>'playMode'='team' and m->>'scope'='team' then a.team_number=p.team_number else a.id=p.id end);
  select coalesce(jsonb_agg(jsonb_build_object('qrId',q.qr_id,'actorId',q.participant_id,'member',q.event_member,'role',q.event_role)),'[]') into scans
  from public.escape_qr_scans q where q.session_id=s.id and q.mission_id=(m->>'id')::uuid
   and q.subject_key=escape_private.result_key(p.id) and (p.progress_reset_at is null or q.created_at>=p.progress_reset_at)
   and (m->>'scope'='team' or q.participant_id=p.id)
   and exists(select 1 from jsonb_array_elements(m->'codes') c where c->>'id'=q.qr_id::text and (c->>'active')::boolean);
  select count(*) into total from jsonb_array_elements(m->'codes') c where (c->>'active')::boolean;
  found:=jsonb_array_length(scans);
  done:=total>0 and case m->>'mode' when 'ANY' then found>=1 when 'ALL' then found>=total when 'N_OF_M' then found>=(m->>'count')::integer
    when 'UNIQUE_MEMBER' then jsonb_array_length(members)>0 and not exists(select 1 from jsonb_array_elements(members) a where not exists(select 1 from jsonb_array_elements(scans) q where q->>'actorId'=a->>'id')) else false end;
  out:=out||jsonb_build_array(jsonb_build_object('id',m->>'id','name',m->>'name','mode',m->>'mode','scope',m->>'scope','found',found,'total',total,'done',done,'scans',scans));
 end loop;return out;
end; $$;

alter function escape_private.play_context(uuid) rename to play_context_v6;
create function escape_private.play_context(p_actor uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare v jsonb;m jsonb;q jsonb;events jsonb:='[]';
begin
 v:=escape_private.play_context_v6(p_actor);
 for m in select value from jsonb_array_elements(escape_private.qr_state(p_actor)) loop
  for q in select value from jsonb_array_elements(m->'scans') loop
   events:=events||jsonb_build_array(jsonb_build_object('blockId',q->>'qrId','type','qr_scanned','member',q->'member','role',q->'role'));
  end loop;
  if (m->>'done')::boolean then events:=events||jsonb_build_array(jsonb_build_object('blockId',m->>'id','type','qr_complete','member',0,'role',''));end if;
 end loop;
 return jsonb_set(v,'{events}',v->'events'||events);
end; $$;
create function escape_private.qr_public(p_actor uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(m-'scans'-'id'),'[]') from jsonb_array_elements(escape_private.qr_state(p_actor)) m;
$$;
alter function escape_private.student_projection(uuid) rename to student_projection_v6;
create function escape_private.student_projection(p_actor uuid) returns jsonb language sql stable set search_path='' as $$
 select escape_private.student_projection_v6(p_actor)||jsonb_build_object('qr',escape_private.qr_public(p_actor));
$$;

create function public.escape_scan_qr(p_token text,p_qr text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;m jsonb;c jsonb;doc jsonb;inserted integer;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '먼저 방 코드로 입장하세요.' using errcode='42501';end if;
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 if not found then raise exception '참가 기록을 찾을 수 없습니다. 방 코드로 다시 입장하세요.' using errcode='42501';end if;
 select * into s from public.escape_sessions where id=p.session_id for update;
 select * into p from public.escape_participants where id=p.id;
 if s.id is null or p.id is null then raise exception '초기화된 수업입니다. 다시 입장하세요.' using errcode='42501';end if;
 if s.status<>'playing' or s.play_version<>1 then raise exception '게임 진행 중에만 QR을 사용할 수 있습니다.' using errcode='22023';end if;
 if exists(select 1 from public.escape_results where session_id=s.id and subject_key=escape_private.result_key(p.id)) then raise exception '이미 탈출을 완료했습니다.' using errcode='22023';end if;
 if p_qr is null or p_qr !~ '^[a-f0-9]{64}$' then raise exception '올바른 QR 링크가 아닙니다.' using errcode='22023';end if;
 select mission,code into m,c from jsonb_array_elements(coalesce(s.content_snapshot->'qrMissions','[]')) mission cross join lateral jsonb_array_elements(mission->'codes') code where code->>'token'=p_qr;
 if m is null or not coalesce((m->>'active')::boolean,false) or not coalesce((c->>'active')::boolean,false) then raise exception '현재 수업에 속한 활성 QR이 아닙니다.' using errcode='42501';end if;
 select document into doc from public.escape_contents where id=s.content_id;
 if not exists(select 1 from jsonb_array_elements(coalesce(doc->'qrMissions','[]')) mission cross join lateral jsonb_array_elements(mission->'codes') code
  where mission->>'id'=m->>'id' and code->>'id'=c->>'id' and code->>'token'=p_qr and (mission->>'active')::boolean and (code->>'active')::boolean) then raise exception '교사가 비활성화하거나 삭제한 QR입니다.' using errcode='42501';end if;
 if m#>>'{assignment,mode}'='member' and m#>>'{assignment,member}'<>p.member_number::text or m#>>'{assignment,mode}'='role' and m#>>'{assignment,role}'<>p.role_name then raise exception '해당 학생에게 배정된 QR이 아닙니다.' using errcode='42501';end if;
 insert into public.escape_qr_scans(session_id,participant_id,mission_id,qr_id,subject_key,event_team,event_member,event_role)
 values(s.id,p.id,(m->>'id')::uuid,(c->>'id')::uuid,escape_private.result_key(p.id),p.team_number,p.member_number,p.role_name) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted>0 then perform escape_private.sync_play(s.id);update public.escape_sessions set progress_revision=progress_revision+1 where id=s.id;end if;
 return jsonb_build_object('duplicate',inserted=0,'message',case when inserted=0 then '이 학생 또는 팀이 이미 찾은 QR입니다.' else 'QR 단서를 발견했습니다.' end,'game',escape_private.student_projection(p.id));
end; $$;

alter function public.escape_teacher_progress(uuid,text,uuid,uuid) set schema escape_private;
alter function escape_private.escape_teacher_progress(uuid,text,uuid,uuid) rename to teacher_progress_v6;
create function public.escape_teacher_progress(p_session uuid,p_action text default 'read',p_participant uuid default null,p_block uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;rows jsonb;
begin
 v:=escape_private.teacher_progress_v6(p_session,p_action,p_participant,p_block);
 select coalesce(jsonb_agg(p||jsonb_build_object('qr',escape_private.qr_public((p->>'id')::uuid))),'[]') into rows from jsonb_array_elements(v->'participants') p;
 return jsonb_set(v,'{participants}',rows);
end; $$;

-- Teacher progress reset clears the targeted actor's QR claims. Session reset cascades all claims.
alter function public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) set schema escape_private;
alter function escape_private.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) rename to teacher_control_v6;
create function public.escape_teacher_control(p_session uuid,p_action text,p_scope text default 'student',p_participant uuid default null,p_team integer default null,
 p_block uuid default null,p_stage text default null,p_new_team integer default null,p_revision bigint default null,p_request uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.escape_sessions;v jsonb;
begin
 select * into s from public.escape_sessions where id=p_session and owner_id=auth.uid() for update;
 if not found then raise exception '본인 수업만 관리할 수 있습니다.' using errcode='42501';end if;
 if p_action='reset' and not exists(select 1 from public.escape_teacher_actions where session_id=s.id and request_id=p_request) then
  delete from public.escape_qr_scans q using public.escape_participants p where q.participant_id=p.id and p.session_id=s.id and (p_scope='student' and p.id=p_participant or p_scope='team' and p.team_number=p_team);
 end if;
 v:=escape_private.teacher_control_v6(p_session,p_action,p_scope,p_participant,p_team,p_block,p_stage,p_new_team,p_revision,p_request);
 return public.escape_teacher_progress(p_session);
end; $$;

revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_scan_qr(text,text),public.escape_teacher_progress(uuid,text,uuid,uuid),public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) from public,anon,authenticated;
grant execute on function public.escape_scan_qr(text,text) to anon;
grant execute on function public.escape_teacher_progress(uuid,text,uuid,uuid),public.escape_teacher_control(uuid,text,text,uuid,integer,uuid,text,integer,bigint,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
