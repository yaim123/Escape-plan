import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { newRoom,newBlock,ensureBlockQr } from '../src/core/model.js';
import {newChatRoom} from '../src/core/chat.js';
import { isComplete,isUnlocked,assignedMembers } from '../src/core/conditions.js';
import { checkAnswer } from '../src/core/answers.js';
process.on('uncaughtException',error=>{console.error(error.message,error.where||'',error.stack?.split('\n').filter(s=>s.includes('verify-results-sql')).join('\n')||'');process.exit(1);});
let PGlite; try { ({PGlite}=await import('@electric-sql/pglite')); } catch { ({PGlite}=await import('../artifacts/pglite/package/dist/index.js')); }
const db=new PGlite(); const A=crypto.randomUUID(), B=crypto.randomUUID();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema realtime;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create table realtime.test_messages(payload jsonb);
create function realtime.send(p jsonb,e text,t text,b boolean) returns void language sql as $$ insert into realtime.test_messages values(p) $$;`);
await db.query('insert into auth.users values($1),($2)',[A,B]);
for(const file of ['001_foundation','002_live_lobby','003_live_play','004_teacher_controls','005_teacher_team_event_fix','006_results_and_reset','007_qr_interaction','008_qr_question_type','009_editor_flow_and_block_qr']) await db.exec(await readFile(`supabase/${file}.sql`,'utf8'));
await db.exec(await readFile('supabase/010_lobby_assets_and_immersive.sql','utf8'));
{await (await import('./storage-fixture.mjs')).storageFixture(db);await db.exec(await readFile('supabase/011_stages_display_and_media.sql','utf8'));}
await db.exec(await readFile('supabase/012_analysis_print_and_block_library.sql','utf8'));
await db.exec(await readFile('supabase/013_qr_scan_receipt.sql','utf8'));
const as=async(role,uid='')=>{await db.exec(`reset role; set role ${role};`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);};
const call=async(sql,args=[])=>(await db.query(sql,args)).rows[0].result;
const teacher=(action,id)=>call('select public.escape_teacher_lobby($1,$2) result',[action,id]);
const join=(r,t,n)=>call('select public.escape_join_lobby($1,$2,2,6,$3,$4) result',[r.roomCode,t,n,`학생${n}`]);
const lobby=(t,team)=>call("select public.escape_student_lobby($1,'team',$2) result",[t,team]);
const play=(t,action='read',block=null,input=null,request=null)=>call('select public.escape_student_play($1,$2,$3,$4,$5) result',[t,action,block,input===null?null:JSON.stringify(input),request]);
const submit=(t,b,input,request=crypto.randomUUID())=>play(t,'submit',b.id,input,request);
const save=async r=>{await as('authenticated',A); await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[r.id,A,r.roomCode,r.title,r]); return teacher('open',r.id);};
const tokens=['a','b','c','d','e'].map(x=>x.repeat(64));
const dash=id=>call('select public.escape_teacher_progress($1) result',[id]);
const finish=(id,action='finish',keep=true,request=crypto.randomUUID())=>call('select public.escape_finish_reset($1,$2,$3,$4,true) result',[id,action,keep,request]);
const history=id=>call('select public.escape_result_history($1) result',[id]);

const {newQrMission,newQr}=await import('../src/core/qr.js');
const scan=(t,q)=>call('select public.escape_scan_qr($1,$2) result',[t,q.token]);

const answerQr=(t,b,q)=>call('select public.escape_answer_qr($1,$2,$3) result',[t,b.id,q.token]);
const control=async(sid,action,target={})=>call('select public.escape_teacher_control($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[sid,action,target.scope||'session',target.id||null,target.team||null,target.block||null,null,null,(await dash(sid)).revision,crypto.randomUUID()]);
function fixture(mode,scope,condition){const r=newRoom('검증 '+mode+scope+condition);r.playMode=mode;const intro=newBlock('story'),q=newBlock();q.questionType='qr';q.qrScope=scope;r.content=[intro,q,newBlock('guide')];const m=ensureBlockQr(r,q);m.mode=condition;m.count=2;m.codes=[newQr(),newQr(),newQr()];return {r,q,m,intro,next:r.content[2]};}
// Upgrade a 013 class with surplus claims, keeping printed QR tokens and history.
{
 const {r,q,m,next}=fixture('team','team','UNIQUE_MEMBER');r.content=[q,next];m.codes=Array.from({length:6},newQr);const sid=(await save(r)).sessionId;
 await as('anon');for(let i=0;i<4;i++){await join(r,tokens[i],i+1);await lobby(tokens[i],1);}await as('authenticated',A);await teacher('start',sid);await as('anon');await scan(tokens[0],m.codes[0]);await scan(tokens[0],m.codes[1]);await scan(tokens[1],m.codes[2]);
 await as('postgres');await db.exec(await readFile('supabase/014_team_chat_and_rewind.sql','utf8'));if(process.argv.includes('--roles'))await db.exec(await readFile('supabase/015_team_roles_and_visibility.sql','utf8'));assert.equal((await db.query('select count(*) n from public.escape_qr_scans where session_id=$1 and retired_at is not null',[sid])).rows[0].n,1);
if(process.argv.includes('--parallel'))await db.exec(await readFile('supabase/016_parallel_flow.sql','utf8'));
if(process.argv.includes('--recovery')){await db.exec(await readFile('supabase/017_qr_manual_code.sql','utf8'));await db.exec(await readFile('supabase/018_duplicate_participant_recovery.sql','utf8'));}
 await as('anon');await scan(tokens[2],m.codes[1]);await scan(tokens[3],m.codes[3]);assert.equal((await play(tokens[0])).current.id,next.id);
 await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
for(const n of [4,6]){
 const {r,q,m,next}=fixture('team','team','UNIQUE_MEMBER');r.content=[q,next];m.codes=Array.from({length:n},newQr);const sid=(await save(r)).sessionId;
 await as('anon');for(let i=0;i<5;i++){await join(r,tokens[i],i+1);await lobby(tokens[i],i===4?2:1);}await as('authenticated',A);await teacher('start',sid);await as('anon');
 await answerQr(tokens[0],q,m.codes[0]);await assert.rejects(answerQr(tokens[0],q,m.codes[1]),/이미 QR을 찾았습니다/);await assert.rejects(scan(tokens[1],m.codes[0]),/다른 팀원이/);
 await scan(tokens[4],m.codes[0]);assert.equal((await play(tokens[4])).current.id,next.id);
 for(let i=1;i<4;i++){const result=await scan(tokens[i],m.codes[i]);assert.equal(result.qrScan.found,i+1);assert.equal(result.qrScan.required,4);}
 for(let i=0;i<4;i++)assert.equal((await play(tokens[i])).current.id,next.id);
 await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
// Active-member departure re-evaluates UNIQUE_MEMBER; too few codes prevent a new class start.
{
 const {r,q,m,next}=fixture('team','team','UNIQUE_MEMBER');r.content=[q,next];m.codes=[newQr()];const sid=(await save(r)).sessionId;
 await as('anon');await join(r,tokens[0],1);await join(r,tokens[1],2);await lobby(tokens[0],1);await lobby(tokens[1],1);await as('authenticated',A);await assert.rejects(teacher('start',sid),/팀원 수 이상의 활성 QR/);
 await as('anon');await call("select public.escape_student_lobby($1,'leave') result",[tokens[1]]);await as('authenticated',A);await teacher('start',sid);await as('anon');await scan(tokens[0],m.codes[0]);assert.equal((await play(tokens[0])).current.id,next.id);
 await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
// Departures change the active roster and emit ordinary completion/condition events.
{
 const {r,q,m,next}=fixture('team','team','UNIQUE_MEMBER');r.content=[q,next];next.unlock.conditions=[{blockId:q.id,event:'complete'}];m.codes=Array.from({length:4},newQr);const sid=(await save(r)).sessionId;
 await as('anon');for(let i=0;i<4;i++){await join(r,tokens[i],i+1);await lobby(tokens[i],1);}await as('authenticated',A);await teacher('start',sid);await as('anon');
 for(let i=0;i<3;i++)await scan(tokens[i],m.codes[i]);await call("select public.escape_student_lobby($1,'leave') result",[tokens[3]]);
 for(let i=0;i<3;i++)assert.equal((await play(tokens[i])).current.id,next.id);
 await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
// Rewind only on a backward move, retire current claims, keep earlier completion/analytics/audit.
{
 const {r,q,m,next}=fixture('team','team','UNIQUE_MEMBER');r.content=[q,next];m.codes=Array.from({length:4},newQr);const sid=(await save(r)).sessionId;
 await as('anon');let fourth;for(let i=0;i<4;i++){const p=await join(r,tokens[i],i+1);if(i===3)fourth=p.participantId;await lobby(tokens[i],i===3?2:1);}await as('authenticated',A);await teacher('start',sid);await as('anon');
 for(let i=0;i<3;i++)await scan(tokens[i],m.codes[i]);assert.equal((await play(tokens[0])).current.id,next.id);
 await as('authenticated',A);const revision=(await dash(sid)).revision;await call("select public.escape_teacher_control($1,'team','student',$2,null,null,null,1,$3,$4) result",[sid,fourth,revision,crypto.randomUUID()]);await as('anon');
 const waiting=await play(tokens[0]);assert.equal(waiting.current.id,q.id);assert.equal(waiting.qr[0].required,4);assert.equal(waiting.qr[0].found,3);assert.equal(waiting.qr[0].selfDone,true);
 await scan(tokens[3],m.codes[3]);assert.equal((await play(tokens[0])).current.id,next.id);await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
for(const mode of ['individual','team']){
 const {r,q,m,intro,next}=fixture(mode,'team','ALL');const second=newBlock('guide'),last=newBlock('guide');r.content=[intro,second,q,next,last];const sid=(await save(r)).sessionId;
 await as('anon');const a=await join(r,tokens[0],1);const b=await join(r,tokens[1],2);if(mode==='team'){await lobby(tokens[0],1);await lobby(tokens[1],1);await join(r,tokens[2],3);await lobby(tokens[2],2);}await as('authenticated',A);await teacher('start',sid);await as('anon');
 await submit(tokens[0],intro,null);await submit(tokens[0],second,null);for(const c of m.codes)await scan(tokens[0],c);await submit(tokens[0],next,null);assert.equal((await play(tokens[0])).current.id,last.id);
 if(mode==='team'){await submit(tokens[2],intro,null);await submit(tokens[2],second,null);for(const c of m.codes)await scan(tokens[2],c);await submit(tokens[2],next,null);}
 await as('authenticated',A);const target=mode==='team'?{scope:'team',team:1,block:second.id}:{scope:'student',id:a.participantId,block:second.id};await control(sid,'move',target);await as('anon');
 if(mode==='team')assert.equal((await play(tokens[2])).current.id,last.id);
 let state=await play(tokens[0]);assert.deepEqual(state.progress.completedIds,[intro.id]);assert.equal(state.current.id,second.id);await submit(tokens[0],second,null);state=await play(tokens[0]);assert.equal(state.qr[0].found,0);for(const c of m.codes)await scan(tokens[0],c);assert.equal((await play(tokens[0])).current.id,next.id);
 await as('postgres');assert.ok((await db.query('select count(*) n from public.escape_qr_scans where session_id=$1 and retired_at is not null',[sid])).rows[0].n>=3);
 await as('authenticated',A);await control(sid,'move',{...target,block:last.id});await as('anon');assert.ok((await play(tokens[0])).progress.completedIds.includes(q.id));
 await as('authenticated',A);assert.ok((await dash(sid)).actions.some(a=>a.details.rewound?.length));await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
const chat=(t,action='list',room=null,text=null,request=null,before=null)=>call('select public.escape_chat($1,$2,$3,$4,$5,$6) result',[t,action,room,text,request,before]);
// A student rewind preserves other students' non-QR completion but resets shared QR for the team.
{
 const {r,q,m,intro,next}=fixture('team','team','ALL');const second=newBlock('guide'),last=newBlock('guide');r.content=[intro,second,q,next,last];const sid=(await save(r)).sessionId;
 await as('anon');const a=await join(r,tokens[0],1),b=await join(r,tokens[1],2);await lobby(tokens[0],1);await lobby(tokens[1],1);await as('authenticated',A);await teacher('start',sid);await as('anon');
 await submit(tokens[0],intro,null);await submit(tokens[0],second,null);for(const c of m.codes)await scan(tokens[0],c);await submit(tokens[0],next,null);
 await as('authenticated',A);await control(sid,'move',{scope:'student',id:b.participantId,block:second.id});await as('anon');
 assert.equal((await play(tokens[1])).current.id,second.id);assert.ok((await play(tokens[0])).progress.completedIds.includes(second.id));assert.equal((await play(tokens[0])).qr[0].found,0);
 await submit(tokens[1],second,null);for(const c of m.codes)await scan(tokens[1],c);assert.equal((await play(tokens[1])).current.id,next.id);assert.equal((await play(tokens[0])).current.id,last.id);
 await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
for(const ending of ['finish','keep','reset']){
 const {r,q,m}=fixture('team','team','ALL');const middle=newBlock('guide'),later=newBlock('guide');r.content=[q,middle,later];r.teamSettings.rolesEnabled=true;r.teamSettings.roles=['A','B','C','D'];r.chatRooms=[newChatRoom(),newChatRoom(),newChatRoom()];Object.assign(r.chatRooms[0],{name:'AB',scope:'roles',roles:['A','B']});Object.assign(r.chatRooms[1],{name:'CD',scope:'roles',roles:['C','D']});r.chatRooms[2].name='전체';q.chatEnabled=later.chatEnabled=true;q.chatRoomIds=later.chatRoomIds=r.chatRooms.map(c=>c.id);
 const sid=(await save(r)).sessionId;await as('anon');const ids=[];for(let i=0;i<5;i++){ids.push((await join(r,tokens[i],i+1)).participantId);await lobby(tokens[i],i===4?2:1);}await as('authenticated',A);await teacher('start',sid);await as('anon');
 const lists=await Promise.all(tokens.map(t=>chat(t)));assert.deepEqual(lists[0].rooms.map(c=>c.name).sort(),['AB','전체']);assert.deepEqual(lists[2].rooms.map(c=>c.name).sort(),['CD','전체']);
 const ab=lists[0].rooms.find(c=>c.name==='AB').id,all=lists[0].rooms.find(c=>c.name==='전체').id,cd=lists[2].rooms.find(c=>c.name==='CD').id;
 const request=crypto.randomUUID();let sent=await chat(tokens[0],'send',ab,'<b>단서</b>',request);assert.equal(sent.messages[0].name,'A');assert.equal(sent.messages[0].mine,true);await chat(tokens[0],'send',ab,'<b>단서</b>',request);assert.equal((await chat(tokens[1],'read',ab)).count,1);
 for(const t of [tokens[2],tokens[3],tokens[4]]){await assert.rejects(chat(t,'read',ab),/참여할 수 없는/);await assert.rejects(chat(t,'send',ab,'침입',crypto.randomUUID()),/참여할 수 없는/);}await assert.rejects(chat(tokens[0],'read',cd),/참여할 수 없는/);
 for(let i=0;i<4;i++)await chat(tokens[i],'send',all,'안녕'+i,crypto.randomUUID());assert.equal((await chat(tokens[3],'read',all)).count,4);
 await assert.rejects(chat(tokens[0],'send',ab,' \n\t ',crypto.randomUUID()),/1~1000/);await assert.rejects(chat(tokens[0],'send',ab,'a'.repeat(1001),crypto.randomUUID()),/1~1000/);await assert.rejects(db.query('select * from public.escape_chat_messages'),/permission denied/);
 await as('authenticated',A);await control(sid,'pause');await as('anon');await assert.rejects(chat(tokens[0],'send',ab,'paused',crypto.randomUUID()),/일시정지/);await as('authenticated',A);await control(sid,'resume');await as('anon');
 for(const c of m.codes)await scan(tokens[0],c);assert.deepEqual((await chat(tokens[0])).rooms,[]);await assert.rejects(chat(tokens[0],'read',ab),/참여할 수 없는/);await submit(tokens[0],middle,null);assert.equal((await chat(tokens[0],'read',ab)).count,1);assert.equal((await chat(tokens[0])).rooms.find(c=>c.name==='AB').id,ab);
 await as('authenticated',A);await finish(sid,ending==='keep'?'reset':ending,ending!=='reset');await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_chat_rooms where session_id=$1',[sid])).rows[0].n,0);assert.equal((await db.query('select count(*) n from public.escape_chat_messages')).rows[0].n,0);await as('anon');await assert.rejects(chat(tokens[0],'read',ab));
 await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_contents')).rows[0].n,0);await db.close();console.log('PASS 014: UNIQUE_MEMBER, active capacity, rewind/replay, QR reuse, role/team/block chat authorization, idempotency, pause, reconnect/history, finish/reset deletion and cleanup');
