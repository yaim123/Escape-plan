-- Apply once AFTER 001 and 002. Start a NEW lobby after installing.
-- Answers remain in the protected session snapshot. No submitted text is stored.
begin;
alter table public.escape_sessions add column play_version integer not null default 0;
alter table public.escape_sessions add column progress_revision bigint not null default 0;
create table public.escape_block_progress (
  participant_id uuid not null references public.escape_participants(id) on delete cascade,
  block_id uuid not null,
  wrong_count integer not null default 0 check(wrong_count >= 0),
  completed_at timestamptz,
  primary key(participant_id, block_id)
);
create table public.escape_submission_receipts (
  participant_id uuid not null references public.escape_participants(id) on delete cascade,
  request_id uuid not null,
  block_id uuid not null,
  outcome text not null check(outcome in ('correct','wrong','already_complete')),
  created_at timestamptz not null default now(),
  primary key(participant_id, request_id)
);
alter table public.escape_block_progress enable row level security;
alter table public.escape_submission_receipts enable row level security;
revoke all on public.escape_block_progress, public.escape_submission_receipts from anon, authenticated;
create unique index escape_completion_event_once on public.escape_events(participant_id,block_id,event_type)
  where event_type in ('complete','button','approved');
create index escape_events_scope on public.escape_events(session_id,participant_id,block_id);

create function escape_private.play_context(p_actor uuid) returns jsonb
language sql stable set search_path = '' as $$
  with actor as (select p.*, s.content_snapshot->>'playMode' mode from public.escape_participants p join public.escape_sessions s on s.id=p.session_id where p.id=p_actor),
  members as (select p.id, p.member_number, p.role_name from public.escape_participants p, actor a where p.session_id=a.session_id and p.left_at is null and
    ((a.mode='individual' and p.id=a.id) or (a.mode='team' and p.team_number=a.team_number)))
  select jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'member',member_number,'role',role_name) order by member_number) from members),'[]'),
    'events',coalesce((select jsonb_agg(jsonb_build_object('blockId',e.block_id,'type',e.event_type,'member',m.member_number,'role',m.role_name)) from public.escape_events e join members m on m.id=e.participant_id),'[]'));
$$;
create function escape_private.assigned(p_block jsonb, p_member jsonb, p_members jsonb, p_index integer) returns boolean
language plpgsql immutable set search_path = '' as $$
declare a jsonb:=p_block->'assignment';
begin
  case a->>'mode'
    when 'all' then return true;
    when 'member' then return (p_member->>'member')::integer=(a->>'member')::integer;
    when 'role' then return p_member->>'role'=a->>'role';
    when 'auto' then return jsonb_array_length(p_members)>0 and p_member->>'id'=(p_members->(p_index % greatest(1,jsonb_array_length(p_members))))->>'id';
    else return false;
  end case;
end;
$$;
create function escape_private.completed(p_block jsonb, p_context jsonb, p_index integer, p_individual boolean) returns boolean
language plpgsql immutable set search_path = '' as $$
declare m jsonb; mode text:=p_block#>>'{completion,mode}'; done boolean; n integer:=0; required_n integer:=0; satisfied_n integer:=0;
begin
  for m in select value from jsonb_array_elements(p_context->'members') loop
    select exists(select 1 from jsonb_array_elements(p_context->'events') e where e->>'type'='complete' and e->>'blockId'=p_block->>'id' and e->>'member'=m->>'member') into done;
    if done then n:=n+1; end if;
    if p_individual or mode in ('any','all','n') or (mode='member' and m->>'member'=p_block#>>'{completion,member}')
      or (mode='role' and m->>'role'=p_block#>>'{completion,role}') or (mode='assigned' and escape_private.assigned(p_block,m,p_context->'members',p_index)) then
      required_n:=required_n+1; if done then satisfied_n:=satisfied_n+1; end if;
    end if;
  end loop;
  if p_individual or mode='any' then return n>0; end if;
  if mode='n' then return n>=greatest(1,(p_block#>>'{completion,count}')::integer); end if;
  return required_n>0 and satisfied_n=required_n;
end;
$$;
create function escape_private.unlocked(p_unlock jsonb, p_events jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare c jsonb; matches integer:=0; n integer:=jsonb_array_length(p_unlock->'conditions');
begin
  if n=0 then return true; end if;
  for c in select value from jsonb_array_elements(p_unlock->'conditions') loop
    if exists(select 1 from jsonb_array_elements(p_events) e where e->>'blockId'=c->>'blockId' and e->>'type'=coalesce(c->>'event','complete')
      and (coalesce(c->>'member','') in ('','0') or c->>'member'=e->>'member') and (coalesce(c->>'role','')='' or c->>'role'=e->>'role')) then matches:=matches+1; end if;
  end loop;
  case p_unlock->>'mode' when 'OR' then return matches>0; when 'N' then return matches>=greatest(1,(p_unlock->>'count')::integer); else return matches=n; end case;
end;
$$;
create function escape_private.play_state(p_actor uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.escape_participants; s public.escape_sessions; ctx jsonb; m jsonb; b jsonb; i integer:=0; prior_done boolean:=true;
  complete boolean; mine boolean; available boolean; done_ids jsonb:='[]'; mine_ids jsonb:='[]'; open_ids jsonb:='[]'; current_id text; wrongs jsonb;
begin
  select * into p from public.escape_participants where id=p_actor;
  select * into s from public.escape_sessions where id=p.session_id;
  ctx:=escape_private.play_context(p_actor);
  select value into m from jsonb_array_elements(ctx->'members') where value->>'id'=p_actor::text;
  for b in select value from jsonb_array_elements(s.content_snapshot->'content') loop
    complete:=escape_private.completed(b,ctx,i,s.content_snapshot->>'playMode'='individual');
    mine:=exists(select 1 from jsonb_array_elements(ctx->'events') e where e->>'blockId'=b->>'id' and e->>'type'='complete' and e->>'member'=p.member_number::text);
    available:=not complete and not mine and (s.content_snapshot->>'playMode'='individual' or escape_private.assigned(b,m,ctx->'members',i)) and
      (case when jsonb_array_length(b#>'{unlock,conditions}')>0 then escape_private.unlocked(b->'unlock',ctx->'events') else prior_done end);
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
end;
$$;
create function escape_private.sync_play(p_session uuid, p_actor uuid default null) returns void
language plpgsql set search_path = '' as $$
declare p record; actor_team integer; mode text;
begin
  select content_snapshot->>'playMode' into mode from public.escape_sessions where id=p_session;
  select team_number into actor_team from public.escape_participants where id=p_actor;
  for p in select id from public.escape_participants where session_id=p_session and left_at is null and
    (p_actor is null or (mode='individual' and id=p_actor) or (mode='team' and team_number=actor_team)) loop
    update public.escape_participants set progress=escape_private.play_state(p.id) where id=p.id;
  end loop;
end;
$$;

create function escape_private.start_play() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b jsonb; role_names jsonb:=new.content_snapshot#>'{teamSettings,roles}';
begin
  if jsonb_array_length(new.content_snapshot->'content')=0 then raise exception '콘텐츠를 하나 이상 추가하세요.' using errcode='22023'; end if;
  for b in select value from jsonb_array_elements(new.content_snapshot->'content') loop
    if b->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or b->>'type' not in ('story','question','guide','wait')
      or b->>'questionType' not in ('short','number','choice','multi','ox','order','match','cipher','switch','condition','approval') then
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
create trigger escape_start_play after update of status on public.escape_sessions for each row
  when(old.status='lobby' and new.status='playing') execute function escape_private.start_play();

create function escape_private.normalize_answer(p_text text,p_options jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare v text:=normalize(p_text,NFKC);
begin
  if coalesce((p_options->>'trim')::boolean,false) then v:=regexp_replace(v,'^[[:space:]﻿]+|[[:space:]﻿]+$','','g'); end if;
  if coalesce((p_options->>'spaces')::boolean,false) then v:=regexp_replace(v,'[[:space:]﻿]','','g'); end if;
  if coalesce((p_options->>'case')::boolean,false) then v:=lower(v); end if;
  if coalesce((p_options->>'punctuation')::boolean,false) then v:=regexp_replace(v,'[!-/:-@\[-`{-~¡-©«-¬®-±´¶-¸»¿×÷˂-˅˒-˟˥-˫˭˯-˿͵;΄-΅·϶҂՚-՟։-֊֍-֏־׀׃׆׳-״؆-؏؛؝-؟٪-٭۔۞۩۽-۾܀-܍߶-߹߾-߿࠰-࠾࡞࢈।-॥॰৲-৳৺-৻৽੶૰-૱୰௳-௺౷౿಄൏൹෴฿๏๚-๛༁-༗༚-༟༴༶༸༺-༽྅྾-࿅࿇-࿌࿎-࿚၊-၏႞-႟჻፠-፨᎐-᎙᐀᙭-᙮᚛-᚜᛫-᛭᜵-᜶។-៖៘-៛᠀-᠊᥀᥄-᥅᧞-᧿᨞-᨟᪠-᪦᪨-᪭᭎-᭏᭚-᭪᭴-᭿᯼-᯿᰻-᰿᱾-᱿᳀-᳇᳓᾽᾿-῁῍-῏῝-῟῭-`´-῾‐-‧‰-⁞⁺-⁾₊-₎₠-⃁℀-℁℃-℆℈-℉℔№-℘℞-℣℥℧℩℮℺-℻⅀-⅄⅊-⅍⅏↊-↋←-␩⑀-⑊⒜-ⓩ─-❵➔-⭳⭶-⯿⳥-⳪⳹-⳼⳾-⳿⵰⸀-⸮⸰-⹝⺀-⺙⺛-⻳⼀-⿕⿰-⿿、-〄〈-〠〰〶-〷〽-〿゛-゜゠・㆐-㆑㆖-㆟㇀-㇥㇯㈀-㈞㈪-㉇㉐㉠-㉿㊊-㊰㋀-㏿䷀-䷿꒐-꓆꓾-꓿꘍-꘏꙳꙾꛲-꛷꜀-꜖꜠-꜡꞉-꞊꠨-꠫꠶-꠹꡴-꡷꣎-꣏꣸-꣺꣼꤮-꤯꥟꧁-꧍꧞-꧟꩜-꩟꩷-꩹꫞-꫟꫰-꫱꭛꭪-꭫꯫﬩﮲-﯒﴾-﵏﶐-﶑﷈-﷏﷼-﷿︐-︙︰-﹒﹔-﹦﹨-﹫！-／：-＠［-｀｛-･￠-￦￨-￮￼-�𐄀-𐄂𐄷-𐄿𐅹-𐆉𐆌-𐆎𐆐-𐆜𐆠𐇐-𐇼𐎟𐏐𐕯𐡗𐡷-𐡸𐤟𐤿𐩐-𐩘𐩿𐫈𐫰-𐫶𐬹-𐬿𐮙-𐮜𐵮𐶎-𐶏𐺭𐻐-𐻘𐽕-𐽙𐾆-𐾉𑁇-𑁍𑂻-𑂼𑂾-𑃁𑅀-𑅃𑅴-𑅵𑇅-𑇈𑇍𑇛𑇝-𑇟𑈸-𑈽𑊩𑏔-𑏕𑏗-𑏘𑑋-𑑏𑑚-𑑛𑑝𑓆𑗁-𑗗𑙁-𑙃𑙠-𑙬𑚹𑜼-𑜿𑠻𑥄-𑥆𑧢𑨿-𑩆𑪚-𑪜𑪞-𑪢𑬀-𑬉𑯡𑱁-𑱅𑱰-𑱱𑻷-𑻸𑽃-𑽏𑿕-𑿱𑿿𒑰-𒑴𒿱-𒿲𖩮-𖩯𖫵𖬷-𖬿𖭄-𖭅𖵭-𖵯𖺗-𖺚𖿢𛲜𛲟𜰀-𜳯𜳺-𜳼𜴀-𜺳𜺺-𜻐𜻠-𜻰𜽐-𜿃𝀀-𝃵𝄀-𝄦𝄩-𝅘𝅥𝅲𝅪-𝅬𝆃-𝆄𝆌-𝆩𝆮-𝇪𝈀-𝉁𝉅𝌀-𝍖𝛁𝛛𝛻𝜕𝜵𝝏𝝯𝞉𝞩𝟃𝠀-𝧿𝨷-𝨺𝩭-𝩴𝩶-𝪃𝪅-𝪋𞅏𞋿𞗿𞥞-𞥟𞲬𞲰𞴮𞻰-𞻱🀀-🀫🀰-🂓🂠-🂮🂱-🂿🃁-🃏🃑-🃵🄍-🆭🇦-🈂🈐-🈻🉀-🉈🉐-🉑🉠-🉥🌀-🛘🛜-🛬🛰-🛼🜀-🟙🟠-🟫🟰🠀-🠋🠐-🡇🡐-🡙🡠-🢇🢐-🢭🢰-🢻🣀-🣁🣐-🣘🤀-🩗🩠-🩭🩰-🩼🪀-🪊🪎-🫆🫈🫍-🫜🫟-🫪🫯-🫸🬀-🮒🮔-🯯🯺]','','g'); end if;
  return v;
end;
$$;
create function escape_private.answer_correct(p_block jsonb,p_input jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare kind text:=p_block->>'questionType'; answers jsonb:=p_block->'answers'; a text; entered text; n integer;
begin
  if kind in ('approval','condition') then return false; end if;
  if kind='switch' then return p_input='true'::jsonb; end if;
  if kind in ('multi','order','match') then
    if jsonb_typeof(p_input)<>'array' then return false; end if;
    n:=jsonb_array_length(answers);
    if n=0 or jsonb_array_length(p_input)<>n or exists(select 1 from jsonb_array_elements(p_input) x where jsonb_typeof(x)<>'string') then return false; end if;
    if kind='multi' then return (select count(distinct value) from jsonb_array_elements(p_input))=n and p_input <@ answers; end if;
    return p_input=answers;
  end if;
  if jsonb_typeof(p_input) not in ('string','number') then return false; end if;
  entered:=p_input#>>'{}';
  if kind='number' then
    if btrim(entered) !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' then return false; end if;
    for a in select value from jsonb_array_elements_text(answers) loop
      if btrim(a) ~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$' and btrim(a)::numeric=btrim(entered)::numeric then return true; end if;
    end loop;
    return false;
  end if;
  return exists(select 1 from jsonb_array_elements_text(answers) x(answer) where escape_private.normalize_answer(x.answer,p_block->'normalization')=escape_private.normalize_answer(entered,p_block->'normalization'));
exception when numeric_value_out_of_range or invalid_text_representation then return false;
end;
$$;

create function escape_private.public_block(p_block jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id',p_block->'id','type',p_block->'type','questionType',p_block->'questionType',
    'title',p_block->'title','body',p_block->'body','stage',p_block->'stage','display',p_block->'display',
    'buttonText',p_block->'buttonText','media',p_block->'media',
    'options',case when p_block->>'questionType' in ('choice','multi','order','match') then p_block->'options' else '[]'::jsonb end,
    -- Matching needs candidate labels, but NEVER the correct pairing/order.
    'matchChoices',case when p_block->>'questionType'='match' then (select coalesce(jsonb_agg(value order by value),'[]') from (select distinct value from jsonb_array_elements_text(p_block->'answers')) x) else '[]'::jsonb end);
$$;
create function escape_private.student_projection(p_actor uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.escape_participants; s public.escape_sessions; state jsonb; b jsonb; visible jsonb;
begin
  select * into p from public.escape_participants where id=p_actor;
  select * into s from public.escape_sessions where id=p.session_id;
  if s.status not in ('playing','paused') then return jsonb_build_object('status',s.status,'sessionId',s.id,'revision',s.progress_revision,'current',null); end if;
  if s.play_version<>1 then raise exception '이전 버전 수업입니다. 교사가 새 대기실을 열어주세요.' using errcode='22023'; end if;
  state:=p.progress;
  select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=state->>'currentBlockId';
  select coalesce(jsonb_agg(jsonb_build_object('id',value->'id','title',value->'title','type',value->'type') order by ord),'[]') into visible
    from jsonb_array_elements(s.content_snapshot->'content') with ordinality x(value,ord) where state->'availableIds' ? (value->>'id');
  return jsonb_build_object('status',s.status,'sessionId',s.id,'participantId',p.id,'revision',s.progress_revision,'title',s.content_snapshot->>'title',
    'playMode',s.content_snapshot->>'playMode','team',p.team_number,'startedAt',s.started_at,'topic',s.lobby_topic,
    'progress',state,'current',case when b is not null then escape_private.public_block(b) else null end,'available',visible);
end;
$$;
create function escape_private.complete_block(p_actor uuid,p_block jsonb,p_source text) returns void
language plpgsql set search_path = '' as $$
declare sid uuid;
begin
  select session_id into sid from public.escape_participants where id=p_actor;
  insert into public.escape_block_progress(participant_id,block_id,completed_at) values(p_actor,(p_block->>'id')::uuid,now())
    on conflict(participant_id,block_id) do update set completed_at=coalesce(escape_block_progress.completed_at,excluded.completed_at);
  if p_source='teacher' and p_block->>'questionType'='approval' then
    insert into public.escape_events(session_id,participant_id,block_id,event_type,source) values(sid,p_actor,(p_block->>'id')::uuid,'approved',p_source) on conflict do nothing;
  end if;
  if p_block->>'type'<>'question' or p_block->>'questionType'='switch' then
    insert into public.escape_events(session_id,participant_id,block_id,event_type,source) values(sid,p_actor,(p_block->>'id')::uuid,'button',p_source) on conflict do nothing;
  end if;
  insert into public.escape_events(session_id,participant_id,block_id,event_type,source) values(sid,p_actor,(p_block->>'id')::uuid,'complete',p_source) on conflict do nothing;
end;
$$;

-- The only student play endpoint. Tokens authorize the actor; IDs cannot impersonate a peer.
create function public.escape_student_play(p_token text,p_action text default 'read',p_block uuid default null,p_input jsonb default null,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.escape_participants; s public.escape_sessions; sid uuid; b jsonb; state jsonb; outcome text; receipt public.escape_submission_receipts; good boolean;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '참가 복구 정보가 필요합니다.' using errcode='42501'; end if;
  select session_id into sid from public.escape_participants where recovery_hash=escape_private.hash_token(p_token);
  if not found then raise exception '참가 기록을 찾을 수 없습니다.' using errcode='42501'; end if;
  select * into s from public.escape_sessions where id=sid for update;
  select * into p from public.escape_participants where recovery_hash=escape_private.hash_token(p_token) for update;
  if p.left_at is not null then raise exception '퇴장한 참가자입니다.' using errcode='42501'; end if;
  if p_action='read' then return escape_private.student_projection(p.id); end if;
  if p_action not in ('submit','select') or p_action is null then raise exception '지원하지 않는 작업입니다.' using errcode='22023'; end if;
  if s.status<>'playing' or s.play_version<>1 then raise exception '진행 중인 수업에서만 제출할 수 있습니다.' using errcode='22023'; end if;
  if p_action='submit' then
    if p_request is null then raise exception '제출 요청 ID가 필요합니다.' using errcode='22023'; end if;
    select * into receipt from public.escape_submission_receipts where participant_id=p.id and request_id=p_request;
    if found then
      if receipt.block_id<>p_block then raise exception '다른 문제에 사용된 요청 ID입니다.' using errcode='22023'; end if;
      return jsonb_build_object('outcome',receipt.outcome,'duplicate',true,'game',escape_private.student_projection(p.id));
    end if;
    if octet_length(coalesce(p_input::text,''))>8192 then raise exception '입력 길이가 너무 깁니다.' using errcode='22023'; end if;
    -- Cap sustained automated guessing, without storing any answer string/hash.
    if (select count(*) from public.escape_submission_receipts where participant_id=p.id and created_at>now()-interval '1 minute')>=60 then raise exception '잠시 기다린 뒤 다시 시도하세요.' using errcode='22023'; end if;
  end if;
  select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=p_block::text;
  if b is null then raise exception '제출할 수 없는 콘텐츠입니다.' using errcode='42501'; end if;
  state:=escape_private.play_state(p.id);
  if not (state->'availableIds' ? p_block::text) then
    -- A late duplicate after a teammate completed the block has no extra side effect.
    if p_action='submit' and ((state->'completedIds' ? p_block::text) or (state->'personalCompletedIds' ? p_block::text)) then
      return jsonb_build_object('outcome','already_complete','game',escape_private.student_projection(p.id));
    end if;
    raise exception '공개되지 않았거나 본인에게 배정되지 않은 콘텐츠입니다.' using errcode='42501';
  end if;
  if p_action='select' then
    update public.escape_participants set progress=jsonb_set(progress,'{currentBlockId}',to_jsonb(p_block::text)) where id=p.id;
    update public.escape_sessions set progress_revision=progress_revision+1 where id=sid;
    return escape_private.student_projection(p.id);
  end if;
  if b->>'type'='question' and b->>'questionType'='approval' then raise exception '교사 승인이 필요한 문제입니다.' using errcode='22023'; end if;
  good:=b->>'type'<>'question' or b->>'questionType'='condition' or coalesce(escape_private.answer_correct(b,p_input),false);
  if good then
    perform escape_private.complete_block(p.id,b,'student'); outcome:='correct';
  else
    insert into public.escape_block_progress(participant_id,block_id,wrong_count) values(p.id,p_block,1)
      on conflict(participant_id,block_id) do update set wrong_count=escape_block_progress.wrong_count+1;
    outcome:='wrong';
  end if;
  insert into public.escape_submission_receipts(participant_id,request_id,block_id,outcome) values(p.id,p_request,p_block,outcome);
  perform escape_private.sync_play(sid,p.id);
  update public.escape_sessions set progress_revision=progress_revision+1 where id=sid;
  return jsonb_build_object('outcome',outcome,'game',escape_private.student_projection(p.id));
end;
$$;

create function public.escape_teacher_progress(p_session uuid,p_action text default 'read',p_participant uuid default null,p_block uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.escape_sessions; p public.escape_participants; b jsonb; state jsonb; students jsonb;
begin
  select * into s from public.escape_sessions where id=p_session and owner_id=auth.uid() for update;
  if not found then raise exception '본인 수업의 진행도만 볼 수 있습니다.' using errcode='42501'; end if;
  if p_action='approve' then
    if s.status<>'playing' or s.play_version<>1 then raise exception '진행 중인 수업이 아닙니다.' using errcode='22023'; end if;
    select * into p from public.escape_participants where id=p_participant and session_id=s.id and left_at is null;
    if not found then raise exception '참가자를 찾을 수 없습니다.' using errcode='42501'; end if;
    select value into b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=p_block::text;
    state:=escape_private.play_state(p.id);
    if b is null or b->>'type'<>'question' or b->>'questionType'<>'approval' or not(state->'availableIds' ? p_block::text) then
      raise exception '공개된 교사 승인형 문제만 승인할 수 있습니다.' using errcode='22023';
    end if;
    perform escape_private.complete_block(p.id,b,'teacher');
    perform escape_private.sync_play(s.id,p.id);
    update public.escape_sessions set progress_revision=progress_revision+1 where id=s.id returning * into s;
  elsif p_action<>'read' or p_action is null then raise exception '지원하지 않는 작업입니다.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p1.id,'name',p1.display_name,'grade',p1.grade,'classroom',p1.classroom,'number',p1.student_number,
    'team',p1.team_number,'memberNumber',p1.member_number,'role',p1.role_name,'progress',p1.progress,
    'currentTitle',x.b->>'title','approvalBlockId',case when x.b->>'type'='question' and x.b->>'questionType'='approval' then x.b->>'id' else null end)
    order by p1.team_number,p1.member_number,p1.arrived_at),'[]') into students
    from public.escape_participants p1 left join lateral (select value b from jsonb_array_elements(s.content_snapshot->'content') where value->>'id'=p1.progress->>'currentBlockId') x on true
    where p1.session_id=s.id and p1.left_at is null;
  return jsonb_build_object('status',s.status,'sessionId',s.id,'revision',s.progress_revision,'playMode',s.content_snapshot->>'playMode','participants',students);
end;
$$;

revoke all on all functions in schema escape_private from public, anon, authenticated;
revoke all on function public.escape_student_play(text,text,uuid,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.escape_teacher_progress(uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.escape_student_play(text,text,uuid,jsonb,uuid) to anon;
grant execute on function public.escape_teacher_progress(uuid,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
