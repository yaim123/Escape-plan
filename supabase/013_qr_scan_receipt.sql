-- Apply once after 012. Keep the existing validation, completion and realtime transaction.
-- Only add a safe receipt for the mission just scanned, even after currentBlockId advances.
begin;
alter function escape_private.scan_current_qr(text,text,uuid) rename to scan_current_qr_v9;
create function escape_private.scan_current_qr(p_token text,p_qr text,p_block uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;b jsonb;m jsonb;state jsonb;v jsonb;needed integer;recognized integer;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '먼저 방 코드로 입장하세요.' using errcode='42501';end if;
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 if not found then raise exception '참가 기록을 찾을 수 없습니다.' using errcode='42501';end if;
 select * into s from public.escape_sessions where id=p.session_id for update;
 -- The canonical routine rechecks membership/status/assignment/QR ownership under this lock.
 -- Capture only the old block reference here; no client-supplied mission or counts are trusted.
 select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=(escape_private.play_state(p.id)->>'currentBlockId');
 select value into m from jsonb_array_elements(s.content_snapshot->'qrMissions') where value->>'id'=b->>'qrMissionId'
  or b->>'qrMissionId' is null and exists(select 1 from jsonb_array_elements(value->'codes') q where q->>'id'=b->>'qrId');
 v:=escape_private.scan_current_qr_v9(p_token,p_qr,p_block);
 select * into p from public.escape_participants where id=p.id;
 select value into state from jsonb_array_elements(escape_private.qr_state(p.id)) where value->>'id'=m->>'id';
 if state is null then return v;end if;
 recognized:=(state->>'found')::integer;
 needed:=case m->>'mode' when 'ALL' then (state->>'total')::integer when 'N_OF_M' then (m->>'count')::integer else 1 end;
 if m->>'mode'='UNIQUE_MEMBER' then
  -- qr_state uses active participants, not the number of printed codes. Extra scans by
  -- the same actor do not satisfy another member's contribution; never count them twice.
  select count(*),count(*) filter(where exists(select 1 from jsonb_array_elements(state->'scans') q where q->>'actorId'=a.id::text))
  into needed,recognized from public.escape_participants a
  where a.session_id=s.id and a.left_at is null and
   case when s.content_snapshot->>'playMode'='team' and m->>'scope'='team' then a.team_number=p.team_number else a.id=p.id end;
 end if;
 -- Legacy single-QR questions finish on their selected code, irrespective of its old mission.
 if b->>'qrMissionId' is null then return v||jsonb_build_object('qrScan',jsonb_build_object('mode','ANY','found',1,'required',1,'done',v->'completed'));end if;
 return v||jsonb_build_object('qrScan',jsonb_build_object('mode',m->>'mode','found',recognized,'required',needed,'done',v->'completed'));
end; $$;
revoke all on function escape_private.scan_current_qr(text,text,uuid),escape_private.scan_current_qr_v9(text,text,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
