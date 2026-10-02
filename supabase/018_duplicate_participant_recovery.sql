-- Apply once after 017. Active-session identity and one-time credential rotation.
begin;
alter table public.escape_participants drop constraint escape_participants_session_id_identity_hash_key;
create unique index escape_active_identity on public.escape_participants(session_id,identity_hash) where left_at is null;
create unique index escape_active_student_number on public.escape_participants(session_id,grade,classroom,student_number) where left_at is null;
-- 016 keeps completed departures in the result roster. Such records must not be recovered.
alter table public.escape_participants add column recovery_disabled boolean not null default false;
create table escape_private.participant_recovery_challenges(
 challenge_hash text primary key,participant_id uuid not null references public.escape_participants(id) on delete cascade,
 requested_hash text not null unique,previous_hash text not null,expires_at timestamptz not null
);
revoke all on escape_private.participant_recovery_challenges from public,anon,authenticated;
create function escape_private.normalized_student_name(value text) returns text language sql immutable set search_path='' as $$select lower(regexp_replace(normalize(btrim(value),NFC),'[[:space:]]+','','g'));$$;
create function escape_private.lock_participant(p_token text) returns public.escape_participants language plpgsql set search_path='' as $$
declare p public.escape_participants;sid uuid;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '참가 확인이 필요합니다.' using errcode='42501';end if;
 select session_id into sid from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null and not recovery_disabled;
 perform 1 from public.escape_sessions where id=sid for update;
 select * into p from public.escape_participants where session_id=sid and recovery_hash=escape_private.hash_token(p_token) and left_at is null and not recovery_disabled;
 if p.id is null then raise exception '참가 기록을 찾을 수 없습니다. 다시 입장하세요.' using errcode='42501';end if;return p;
end;$$;
create or replace function public.escape_join_lobby(p_code text,p_token text,p_grade integer,p_class integer,p_number integer,p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.escape_sessions;p public.escape_participants;hash text;challenge text;
begin
 if p_code is null or p_code !~ '^[0-9]{6}$' or p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '방 코드 또는 복구 정보가 올바르지 않습니다.' using errcode='22023';end if;
 perform escape_private.check_identity(p_grade,p_class,p_number,p_name);hash:=escape_private.hash_token(p_token);
 select item.* into s from public.escape_sessions item join public.escape_contents c on c.id=item.content_id where c.room_code=p_code and item.status<>'finished' for update of item;
 if s.id is null then raise exception '열려 있는 방이 없습니다. 방 코드를 확인하세요.' using errcode='22023';end if;
 select * into p from public.escape_participants where recovery_hash=hash;
 if p.id is not null then
  if p.session_id=s.id and p.left_at is null and not p.recovery_disabled then update public.escape_participants set last_seen_at=now() where id=p.id;return escape_private.roster(s.id,p.id);end if;
  -- A left/old-session credential cannot resurrect its old row, but can be replaced for a new admission.
  if p.left_at is null and not p.recovery_disabled and p.session_id<>s.id and exists(select 1 from public.escape_sessions where id=p.session_id and status<>'finished') then raise exception '다른 수업의 복구 정보입니다. 새 참가 정보로 입장하세요.' using errcode='22023';end if;
  update public.escape_participants set recovery_hash=escape_private.hash_token(gen_random_uuid()::text) where id=p.id;
 end if;
 select * into p from public.escape_participants where session_id=s.id and grade=p_grade and classroom=p_class and student_number=p_number and left_at is null;
 if p.id is not null then
  if p.recovery_disabled or escape_private.normalized_student_name(p.display_name)<>escape_private.normalized_student_name(p_name) then raise exception '같은 학년·반·번호의 참가자가 이미 있습니다. 입력한 정보를 확인하거나 선생님에게 문의하세요.' using errcode='22023';end if;
  challenge:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  delete from escape_private.participant_recovery_challenges where expires_at<now() or requested_hash=hash;
  insert into escape_private.participant_recovery_challenges values(escape_private.hash_token(challenge),p.id,hash,p.recovery_hash,now()+interval '2 minutes');
  return jsonb_build_object('requiresRecovery',true,'challenge',challenge,'message','이미 이 수업에 참여 중입니다. 기존 진행으로 돌아갈까요?');
 end if;
 if s.status<>'lobby' then raise exception '이미 시작한 방입니다. 신규 입장이 닫혔습니다.' using errcode='22023';end if;
 if (select count(*) from public.escape_participants where session_id=s.id and left_at is null)>=500 then raise exception '이 대기실의 참가 한도에 도달했습니다.' using errcode='22023';end if;
 insert into public.escape_participants(session_id,identity_hash,recovery_hash,grade,classroom,student_number,display_name,arrived_at)
 values(s.id,escape_private.identity_key(p_grade,p_class,p_number),hash,p_grade,p_class,p_number,btrim(p_name),now()) returning * into p;
 return escape_private.roster(s.id,p.id);
end;$$;
create function public.escape_recover_participant(p_code text,p_token text,p_challenge text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.escape_sessions;p public.escape_participants;c escape_private.participant_recovery_challenges;hash text:=escape_private.hash_token(p_token);
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_challenge is null or p_challenge !~ '^[a-f0-9]{64}$' then raise exception '복구 확인을 다시 진행해주세요.' using errcode='22023';end if;
 select item.* into s from public.escape_sessions item join public.escape_contents doc on doc.id=item.content_id where doc.room_code=p_code and item.status<>'finished' for update of item;
 select * into p from public.escape_participants where session_id=s.id and recovery_hash=hash and left_at is null and not recovery_disabled;
 if p.id is not null then return escape_private.roster(s.id,p.id);end if;
 select * into c from escape_private.participant_recovery_challenges where challenge_hash=escape_private.hash_token(p_challenge) and requested_hash=hash and expires_at>now();
 select * into p from public.escape_participants where id=c.participant_id and session_id=s.id and left_at is null and not recovery_disabled and recovery_hash=c.previous_hash;
 if p.id is null then raise exception '복구 확인이 만료되었거나 다른 기기에서 복구했습니다. 다시 입장해주세요.' using errcode='22023';end if;
 update public.escape_participants set recovery_hash=hash,last_seen_at=now() where id=p.id;
 delete from escape_private.participant_recovery_challenges where participant_id=p.id;
 return escape_private.roster(s.id,p.id);
end;$$;

-- Every student operation holds the session lock before checking the current credential.
-- This also closes the read-token / wait-for-lock race during cross-device rotation.
alter function public.escape_student_lobby(text,text,integer,integer,integer,integer,text) set schema escape_private;
alter function escape_private.escape_student_lobby(text,text,integer,integer,integer,integer,text) rename to student_lobby_v17;
create function public.escape_student_lobby(p_token text,p_action text default 'read',p_team integer default null,p_grade integer default null,p_class integer default null,p_number integer default null,p_name text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;v jsonb;
begin
 p:=escape_private.lock_participant(p_token);
 if p_action='profile' then
  select * into s from public.escape_sessions where id=p.session_id;
  if s.status<>'lobby' then raise exception '게임 시작 후에는 참가 정보를 변경할 수 없습니다.' using errcode='22023';end if;
  perform escape_private.check_identity(p_grade,p_class,p_number,p_name);
  if exists(select 1 from public.escape_participants where session_id=s.id and id<>p.id and left_at is null and grade=p_grade and classroom=p_class and student_number=p_number) then raise exception '같은 학년·반·번호의 참가자가 이미 있습니다.' using errcode='22023';end if;
  update public.escape_participants set grade=p_grade,classroom=p_class,student_number=p_number,display_name=btrim(p_name),identity_hash=escape_private.identity_key(p_grade,p_class,p_number),last_seen_at=now() where id=p.id;
  return escape_private.roster(s.id,p.id);
 end if;
 v:=escape_private.student_lobby_v17(p_token,p_action,p_team,p_grade,p_class,p_number,p_name);
 if p_action='leave' then update public.escape_participants set recovery_disabled=true where id=p.id;delete from escape_private.participant_recovery_challenges where participant_id=p.id;end if;return v;
end;$$;

alter function public.escape_student_play(text,text,uuid,jsonb,uuid) set schema escape_private;
alter function escape_private.escape_student_play(text,text,uuid,jsonb,uuid) rename to student_play_v17;
create function public.escape_student_play(p_token text,p_action text default 'read',p_block uuid default null,p_input jsonb default null,p_request uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform escape_private.lock_participant(p_token);return escape_private.student_play_v17(p_token,p_action,p_block,p_input,p_request);end;$$;

alter function public.escape_scan_qr(text,text) set schema escape_private;
alter function escape_private.escape_scan_qr(text,text) rename to scan_qr_v17;
create function public.escape_scan_qr(p_token text,p_qr text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform escape_private.lock_participant(p_token);return escape_private.scan_qr_v17(p_token,p_qr);end;$$;

alter function public.escape_answer_qr(text,uuid,text) set schema escape_private;
alter function escape_private.escape_answer_qr(text,uuid,text) rename to answer_qr_v17;
create function public.escape_answer_qr(p_token text,p_block uuid,p_qr text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform escape_private.lock_participant(p_token);return escape_private.answer_qr_v17(p_token,p_block,p_qr);end;$$;

alter function public.escape_answer_qr_manual(text,uuid,text) set schema escape_private;
alter function escape_private.escape_answer_qr_manual(text,uuid,text) rename to answer_qr_manual_v17;
create function public.escape_answer_qr_manual(p_token text,p_block uuid,p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform escape_private.lock_participant(p_token);return escape_private.answer_qr_manual_v17(p_token,p_block,p_code);end;$$;

alter function public.escape_chat(text,text,uuid,text,uuid,bigint) set schema escape_private;
alter function escape_private.escape_chat(text,text,uuid,text,uuid,bigint) rename to chat_v17;
create function public.escape_chat(p_token text,p_action text default 'list',p_room uuid default null,p_text text default null,p_request uuid default null,p_before bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform escape_private.lock_participant(p_token);return escape_private.chat_v17(p_token,p_action,p_room,p_text,p_request,p_before);end;$$;

revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_student_play(text,text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.escape_student_play(text,text,uuid,jsonb,uuid) to anon;
revoke all on function public.escape_scan_qr(text,text) from public,anon,authenticated;
grant execute on function public.escape_scan_qr(text,text) to anon;
revoke all on function public.escape_answer_qr(text,uuid,text) from public,anon,authenticated;
grant execute on function public.escape_answer_qr(text,uuid,text) to anon;
revoke all on function public.escape_answer_qr_manual(text,uuid,text) from public,anon,authenticated;
grant execute on function public.escape_answer_qr_manual(text,uuid,text) to anon;
revoke all on function public.escape_chat(text,text,uuid,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.escape_chat(text,text,uuid,text,uuid,bigint) to anon;
revoke all on function public.escape_student_lobby(text,text,integer,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.escape_student_lobby(text,text,integer,integer,integer,integer,text) to anon;
revoke all on function public.escape_recover_participant(text,text,text) from public,anon,authenticated;
grant execute on function public.escape_recover_participant(text,text,text) to anon;
notify pgrst,'reload schema';
commit;
