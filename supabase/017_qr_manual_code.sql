-- Apply once after 016. Printed QR tokens and the existing scan/answer engine are unchanged.
begin;
create function escape_private.manual_qr_code() returns text language plpgsql volatile set search_path='' as $$
declare bytes bytea:=sha256(convert_to(gen_random_uuid()::text,'UTF8'));code text:='';i integer;
begin for i in 0..5 loop code:=code||substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',get_byte(bytes,i)%32+1,1);end loop;return code;end;$$;
create function escape_private.manual_qr_document(doc jsonb,previous jsonb default '{}') returns jsonb language plpgsql volatile set search_path='' as $$
declare m jsonb;q jsonb;old_q jsonb;missions jsonb:='[]';codes jsonb;used text[]:='{}';code text;
begin
 if jsonb_typeof(doc->'qrMissions') is distinct from 'array' then return doc;end if;
 for m in select value from jsonb_array_elements(doc->'qrMissions') loop
  codes:='[]';for q in select value from jsonb_array_elements(coalesce(m->'codes','[]')) loop
   select item into old_q from jsonb_array_elements(coalesce(previous->'qrMissions','[]')) pm,jsonb_array_elements(pm->'codes') item where item->>'id'=q->>'id' and item->>'token'=q->>'token' limit 1;
   code:=coalesce(old_q->>'manualCode',q->>'manualCode');
   if code is null or code !~ '^[A-HJ-NP-Z2-9]{6}$' or code=any(used) then loop code:=escape_private.manual_qr_code();exit when not(code=any(used));end loop;end if;
   used:=array_append(used,code);codes:=codes||jsonb_build_array(q||jsonb_build_object('manualCode',code));
  end loop;missions:=missions||jsonb_build_array(jsonb_set(m,'{codes}',codes));
 end loop;return jsonb_set(doc,'{qrMissions}',missions);
end;$$;
create function escape_private.prepare_manual_qr_document() returns trigger language plpgsql security definer set search_path='' as $$
begin new.document:=escape_private.manual_qr_document(new.document,case when tg_op='UPDATE' then old.document else '{}'::jsonb end);return new;end;$$;
create trigger escape_manual_qr_document before insert or update of document on public.escape_contents for each row execute function escape_private.prepare_manual_qr_document();
update public.escape_contents set document=escape_private.manual_qr_document(document) where jsonb_typeof(document->'qrMissions')='array';
create function escape_private.prepare_manual_qr_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare doc jsonb;
begin select document into doc from public.escape_contents where id=new.content_id;new.content_snapshot:=escape_private.manual_qr_document(new.content_snapshot,doc);return new;end;$$;
create trigger escape_manual_qr_snapshot before insert or update of content_snapshot on public.escape_sessions for each row execute function escape_private.prepare_manual_qr_snapshot();
update public.escape_sessions set content_snapshot=escape_private.manual_qr_document(content_snapshot,(select document from public.escape_contents where id=content_id)) where jsonb_typeof(content_snapshot->'qrMissions')='array';
create table escape_private.manual_qr_attempts(participant_id uuid primary key references public.escape_participants(id) on delete cascade,window_at timestamptz not null,attempts integer not null);
revoke all on escape_private.manual_qr_attempts from public,anon,authenticated;
create function public.escape_answer_qr_manual(p_token text,p_block uuid,p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.escape_participants;s public.escape_sessions;qr text;code text:=upper(regexp_replace(coalesce(p_code,''),'[[:space:]]','','g'));tries integer;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '참가 확인이 필요합니다.' using errcode='42501';end if;
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 if p.id is null then raise exception '참가 기록을 찾을 수 없습니다.' using errcode='42501';end if;
 select * into s from public.escape_sessions where id=p.session_id for update;
 select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) and left_at is null;
 if p.id is null or s.id is null then raise exception '참가 기록을 찾을 수 없습니다.' using errcode='42501';end if;
 insert into escape_private.manual_qr_attempts values(p.id,clock_timestamp(),1) on conflict(participant_id) do update
  set attempts=case when escape_private.manual_qr_attempts.window_at<clock_timestamp()-interval '1 minute' then 1 else escape_private.manual_qr_attempts.attempts+1 end,
      window_at=case when escape_private.manual_qr_attempts.window_at<clock_timestamp()-interval '1 minute' then clock_timestamp() else escape_private.manual_qr_attempts.window_at end returning attempts into tries;
 if tries>30 then return jsonb_build_object('error','잠시 기다린 뒤 다시 입력해주세요.');end if;
 if p_block is not null and code ~ '^[A-HJ-NP-Z2-9]{6}$' then
  select q->>'token' into qr from jsonb_array_elements(coalesce(s.content_snapshot->'qrMissions','[]')) m,jsonb_array_elements(m->'codes') q,jsonb_array_elements(s.content_snapshot->'content') b
   where b->>'id'=p_block::text and (b->>'qrMissionId'=m->>'id' or b->>'qrMissionId' is null and b->>'qrId'=q->>'id') and q->>'manualCode'=code and coalesce((m->>'active')::boolean,false) and coalesce((q->>'active')::boolean,false) and escape_private.role_visible(s.content_snapshot,b,p.role_name) limit 1;
 end if;
 if qr is null then return jsonb_build_object('error','코드를 확인해주세요.');end if;
 return escape_private.scan_current_qr(p_token,qr,p_block);
end;$$;
revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_answer_qr_manual(text,uuid,text) from public,anon,authenticated;
grant execute on function public.escape_answer_qr_manual(text,uuid,text) to anon;
notify pgrst,'reload schema';
commit;
