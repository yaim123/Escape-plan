-- Apply once after 018. Uses database time, not a browser timer.
begin;
create index escape_session_expiry on public.escape_sessions ((coalesce(started_at,created_at)));

-- Same session deletion/cascade and fresh lobby as the teacher's reset-without-archive.
-- No archive is created, and no existing archive or author document is deleted.
create function escape_private.reset_expired_classes() returns integer
language plpgsql security definer set search_path='' as $$
declare c public.escape_contents;s public.escape_sessions;new_id uuid;reset_count integer:=0;expired_ids uuid[];old_id uuid;
begin
 -- Lock in the same order as manual reset/start: content, then session.
 -- Busy classes are retried on the next run; one job handles at most 100 contents.
 for c in select doc.* from public.escape_contents doc
  where exists(select 1 from public.escape_sessions session where session.content_id=doc.id
   and coalesce(session.started_at,session.created_at)<=now()-interval '24 hours')
  order by doc.id limit 100 for update of doc skip locked
 loop
  expired_ids:='{}';
  for s in select * from public.escape_sessions where content_id=c.id
   and coalesce(started_at,created_at)<=now()-interval '24 hours'
   order by id for update skip locked
  loop
   -- Invalidates the old topic before deletion, so connected clients refetch.
   perform realtime.send('{}'::jsonb,'changed',s.lobby_topic,false);
   delete from public.escape_sessions where id=s.id;
   -- Reset receipts have no session FK. Remove stale retry pointers for this class.
   delete from public.escape_reset_receipts where content_id=c.id and (old_session=s.id or new_session=s.id);
   expired_ids:=array_append(expired_ids,s.id);reset_count:=reset_count+1;
  end loop;
  if cardinality(expired_ids)>0 then
   if not exists(select 1 from public.escape_sessions where content_id=c.id and status<>'finished') then
    insert into public.escape_sessions(content_id,owner_id,content_snapshot)
     values(c.id,c.owner_id,c.document) returning id into new_id;
   else
    select id into new_id from public.escape_sessions where content_id=c.id and status<>'finished';
   end if;
   foreach old_id in array expired_ids loop
    insert into public.escape_reset_receipts(request_id,owner_id,content_id,old_session,new_session)
     values(gen_random_uuid(),c.owner_id,c.id,old_id,new_id);
   end loop;
  end if;
 end loop;
 return reset_count;
end;$$;

-- Authenticated owners of an expired tab can follow its reset receipt to the lobby.
-- Students never get this mapping or access to another teacher's class.
create function escape_private.reset_lobby_for_teacher(p_session uuid) returns jsonb
language plpgsql set search_path='' as $$
declare s public.escape_sessions;
begin
 select current_session.* into s from public.escape_reset_receipts r
 join public.escape_contents c on c.id=r.content_id and c.owner_id=auth.uid()
 join public.escape_sessions current_session on current_session.content_id=c.id and current_session.status<>'finished' and current_session.owner_id=auth.uid()
 where r.old_session=p_session and r.owner_id=auth.uid() limit 1;
 if s.id is null then return null;end if;
 if s.status='lobby' then return escape_private.roster(s.id);end if;
 return public.escape_teacher_progress(s.id);
end;
$$;
alter function public.escape_teacher_progress(uuid,text,uuid,uuid) set schema escape_private;
alter function escape_private.escape_teacher_progress(uuid,text,uuid,uuid) rename to teacher_progress_v18;
create function public.escape_teacher_progress(p_session uuid,p_action text default 'read',p_participant uuid default null,p_block uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replacement jsonb;
begin
 if p_action='read' and not exists(select 1 from public.escape_sessions where id=p_session) then
  replacement:=escape_private.reset_lobby_for_teacher(p_session);
  if replacement is not null then return replacement;end if;
 end if;
 return escape_private.teacher_progress_v18(p_session,p_action,p_participant,p_block);
end;$$;
alter function public.escape_teacher_lobby(text,uuid) set schema escape_private;
alter function escape_private.escape_teacher_lobby(text,uuid) rename to teacher_lobby_v18;
create function public.escape_teacher_lobby(p_action text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare replacement jsonb;
begin
 if p_action='read' and not exists(select 1 from public.escape_sessions where id=p_id) then
  replacement:=escape_private.reset_lobby_for_teacher(p_id);
  if replacement is not null then return replacement;end if;
 end if;
 return escape_private.teacher_lobby_v18(p_action,p_id);
end;$$;
revoke all on all functions in schema escape_private from public,anon,authenticated;
revoke all on function public.escape_teacher_progress(uuid,text,uuid,uuid),public.escape_teacher_lobby(text,uuid) from public,anon,authenticated;
grant execute on function public.escape_teacher_progress(uuid,text,uuid,uuid),public.escape_teacher_lobby(text,uuid) to authenticated;

-- A real server scheduler is required: closing every browser does not stop cleanup.
create extension if not exists pg_cron;
select cron.schedule('escape-reset-expired-classes','*/5 * * * *','select escape_private.reset_expired_classes();');
notify pgrst,'reload schema';
commit;
