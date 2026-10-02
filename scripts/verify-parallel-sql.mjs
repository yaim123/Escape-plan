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

await db.exec(await readFile('supabase/014_team_chat_and_rewind.sql','utf8'));
await db.exec(await readFile('supabase/015_team_roles_and_visibility.sql','utf8'));
await db.exec(await readFile('supabase/016_parallel_flow.sql','utf8'));
if(process.argv.includes('--recovery')){await db.exec(await readFile('supabase/017_qr_manual_code.sql','utf8'));await db.exec(await readFile('supabase/018_duplicate_participant_recovery.sql','utf8'));}

const chat=(t,action='list',room=null,text=null)=>call('select public.escape_chat($1,$2,$3,$4,$5) result',[t,action,room,text,crypto.randomUUID()]);
async function setup(r,n,teams=[]){const sid=(await save(r)).sessionId;await as('anon');const ids=[];for(let i=0;i<n;i++){ids.push((await join(r,tokens[i],i+1)).participantId);await lobby(tokens[i],teams[i]||1);}await as('authenticated',A);return {sid,ids};}
async function cleanup(r){await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[r.id]);}
function rolesRoom(){const r=newRoom('015 역할 경로');r.playMode='team';Object.assign(r.teamSettings,{rolesEnabled:true,roleViewsEnabled:true,roles:['탐색자','탐색자','분석가','분석가']});return r;}

const {normalizeRoom}=await import('../src/core/model.js');const {createParallel,addParallelStep}=await import('../src/core/parallel.js');
function parallelRoom(mode='AND',steps=1,hold=false){const r=normalizeRoom(rolesRoom());r.content[0].title='공통 시작';const g=createParallel(r,r.stageGroups[0].id,newBlock);g.mode=mode;for(let i=1;i<steps;i++)addParallelStep(r,g,r.stageGroups[0].id,newBlock);if(hold){const id=g.steps[1].cells[0].blockId;r.content=r.content.filter(b=>b.id!==id);g.steps[1].cells[0]={hold:true};}const end=newBlock('guide');end.stageId=r.stageGroups[0].id;r.content.push(end);for(const b of r.content.filter(b=>b!==end&&b!==r.content[0])){b.type='question';b.answers=['yes'];b.body='PRIVATE '+b.id;}return {r,g,intro:r.content[0],end,block:(lane,step=0)=>r.content.find(b=>b.id===g.steps[step].cells[lane].blockId)};}
for(const mode of ['AND','OR'])for(const winner of [0,2]){
 const {r,g,intro,end,block}=parallelRoom(mode);const {sid,ids}=await setup(r,4);await teacher('start',sid);await as('anon');await submit(tokens[0],intro,null);assert.equal((await play(tokens[0])).current.id,block(0).id);assert.equal((await play(tokens[1])).current.id,block(0).id);assert.equal((await play(tokens[2])).current.id,block(1).id);
 const lane=winner===0?0:1,other=winner===0?2:0;await submit(tokens[winner],block(lane),'yes');let a=await play(tokens[winner]),b=await play(tokens[other]);
 if(mode==='AND'){assert.equal(a.current,null);assert.equal(a.waiting.unit,'lanes');assert.equal(a.waiting.found,1);assert.equal(a.waiting.required,2);assert.equal(b.current.id,block(1-lane).id);await as('authenticated',A);assert.equal((await dash(sid)).teamProgress[0].percent,50);await as('anon');await submit(tokens[other],block(1-lane),'yes');}
 else {assert.equal(a.current.id,end.id);assert.equal(b.current.id,end.id);const late=await submit(tokens[other],block(1-lane),'yes');assert.equal(late.outcome,'parallel_closed');await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_events where participant_id=$1 and block_id=$2',[ids[other],block(1-lane).id])).rows[0].n,0);await as('anon');}
 assert.equal((await play(tokens[0])).current.id,end.id);await as('postgres');assert.equal((await db.query('select count(*) n from escape_private.parallel_closures where session_id=$1 and retired_at is null',[sid])).rows[0].n,1);await as('anon');await submit(tokens[0],end,null);assert((await play(tokens[2])).result);await as('authenticated',A);assert.equal((await dash(sid)).teamProgress[0].percent,100);await cleanup(r);
}
// Independent multi-step paths, hold is read-only and advances after its peer step.
for(const hold of [false,true]){
 const {r,g,intro,end,block}=parallelRoom('AND',2,hold);const {sid}=await setup(r,4);await teacher('start',sid);await as('anon');await submit(tokens[0],intro,null);await submit(tokens[0],block(0),'yes');await submit(tokens[2],block(1),'yes');
 if(hold){const state=await play(tokens[0]);assert.equal(state.current,null);assert.equal(state.held.id,block(0).id);assert(!JSON.stringify(state).includes(block(1,1).body));await assert.rejects(play(tokens[0],'hint',block(0).id,null,crypto.randomUUID()),/공개/);}
 else{assert.equal((await play(tokens[0])).current.id,block(0,1).id);await submit(tokens[0],block(0,1),'yes');}
 assert.equal((await play(tokens[2])).current.id,block(1,1).id);await submit(tokens[2],block(1,1),'yes');assert.equal((await play(tokens[0])).current.id,end.id);await cleanup(r);
}
// Split/merge twice and rewind invalidates only the shared current replay, retaining history.
{
 const {r,g,intro,end,block}=parallelRoom('OR');const firstA=block(0),firstB=block(1);const second=createParallel(r,r.stageGroups[0].id,newBlock);const last=newBlock('guide');last.stageId=end.stageId;r.content.push(last);const {sid,ids}=await setup(r,4);await teacher('start',sid);await as('anon');await submit(tokens[0],intro,null);await Promise.all([submit(tokens[0],firstA,'yes'),submit(tokens[2],firstB,'yes')]);await submit(tokens[0],end,null);assert.equal((await play(tokens[0])).current.id,second.steps[0].cells[0].blockId);
 await as('authenticated',A);await control(sid,'move',{scope:'student',id:ids[0],block:firstA.id});await as('anon');assert.equal((await play(tokens[0])).current.id,firstA.id);assert.equal((await play(tokens[2])).current.id,firstB.id);await submit(tokens[2],firstB,'yes');await as('postgres');assert.equal((await db.query('select count(*) n from escape_private.parallel_closures where session_id=$1 and retired_at is not null',[sid])).rows[0].n,1);
 await as('authenticated',A);await finish(sid,'reset',true);await as('postgres');assert.equal((await db.query('select count(*) n from escape_private.parallel_closures where session_id=$1',[sid])).rows[0].n,0);await cleanup(r);
}
// Existing QR verification remains canonical inside a lane. Late OR scans are no-ops.
for(const mode of ['AND','OR']){
 const {r,g,intro,end,block}=parallelRoom(mode);const a=block(0),b=block(1);b.questionType='qr';b.answers=[];b.qrScope='team';const mission=ensureBlockQr(r,b);const {sid,ids}=await setup(r,4);await teacher('start',sid);await as('anon');await submit(tokens[0],intro,null);
 await assert.rejects(answerQr(tokens[0],b,mission.codes[0]),/QR|공개/);
 await submit(tokens[0],a,'yes');const response=await answerQr(tokens[2],b,mission.codes[0]);assert.equal(response.game.current.id,end.id);
 await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_qr_scans where session_id=$1',[sid])).rows[0].n,mode==='OR'?0:1);
 await as('anon');await assert.rejects(call('select public.escape_answer_qr($1,$2,$3) result',[tokens[2],b.id,'f'.repeat(64)]),/QR/);await as('authenticated',A);await control(sid,'pause');await as('anon');await assert.rejects(answerQr(tokens[2],b,mission.codes[0]),/진행 중/);await as('authenticated',A);await control(sid,'resume');await control(sid,'move',{scope:'student',id:ids[0],block:a.id});await as('anon');assert.equal((await play(tokens[2])).current.id,b.id);await answerQr(tokens[2],b,mission.codes[0]);if(mode==='AND')await submit(tokens[0],a,'yes');assert.equal((await play(tokens[0])).current.id,end.id);await cleanup(r);
}
// Forward forcing keeps history; shared backward moves reset the current parallel replay.
{
 const {r,g,intro,end,block}=parallelRoom();const {sid,ids}=await setup(r,4);await teacher('start',sid);await as('anon');await submit(tokens[0],intro,null);await as('authenticated',A);await control(sid,'move',{scope:'student',id:ids[0],block:end.id});await as('anon');assert.equal((await play(tokens[0])).current.id,end.id);assert.equal((await play(tokens[2])).current.id,block(1).id);await as('authenticated',A);await control(sid,'move',{scope:'student',id:ids[0],block:block(0).id});await control(sid,'complete',{scope:'team',team:1,block:block(0).id});await as('anon');assert.equal((await play(tokens[0])).current.id,end.id);assert.equal((await play(tokens[2])).current.id,end.id);await as('authenticated',B);await assert.rejects(control(sid,'reset',{scope:'team',team:1}),/본인/);await as('anon');await assert.rejects(call("select public.escape_teacher_control($1,'reset','team',null,1) result",[sid]),/permission denied/);await cleanup(r);
}
// Rewind the last physical lane block while its actor is already waiting at AND.
{
 const {r,intro,block}=parallelRoom();const {sid,ids}=await setup(r,4);await teacher('start',sid);await as('anon');await submit(tokens[0],intro,null);await submit(tokens[2],block(1),'yes');assert.equal((await play(tokens[2])).waiting.found,1);await as('authenticated',A);await control(sid,'move',{scope:'student',id:ids[2],block:block(1).id});await as('anon');assert.equal((await play(tokens[2])).current.id,block(1).id);assert.equal((await play(tokens[0])).current.id,block(0).id);await cleanup(r);
}
// A final block inside an OR group finishes by join, without awarding the other path.
{
 const {r,intro,end,block}=parallelRoom();const {sid}=await setup(r,4);await teacher('start',sid);await as('anon');await submit(tokens[0],intro,null);await submit(tokens[0],block(0),'yes');await as('authenticated',A);await control(sid,'complete',{scope:'team',team:1});await as('anon');assert.equal((await play(tokens[0])).current.id,end.id);assert.equal((await play(tokens[2])).current.id,end.id);await cleanup(r);
}
{
 const {r,intro,block}=parallelRoom('OR');r.rules.finishMode='final';r.rules.finalBlockId=block(1).id;r.rules.scoreEnabled=true;const {sid}=await setup(r,4);await teacher('start',sid);await as('anon');await submit(tokens[0],intro,null);await submit(tokens[0],block(0),'yes');const result=(await play(tokens[2])).result;assert(result);assert.equal(result.score,100);await cleanup(r);
}
// Completed departure revokes only that student's browser credential, not team/result/session.
for(const mode of ['individual','team']){
 const r=normalizeRoom(newRoom());r.playMode=mode;let sid;
 if(mode==='team'){({sid}=await setup(r,2));}else {sid=(await save(r)).sessionId;await as('anon');await join(r,tokens[0],1);await as('authenticated',A);}await teacher('start',sid);await as('anon');await submit(tokens[0],r.content[0],null);const before=await play(tokens[0]);assert(before.result);await call("select public.escape_student_lobby($1,'leave') result",[tokens[0]]);await assert.rejects(play(tokens[0]),/참가 기록/);if(mode==='team')assert.deepEqual((await play(tokens[1])).result,before.result);await as('authenticated',A);assert.equal((await dash(sid)).summary.completed,1);await cleanup(r);
}
// Finished-but-incomplete exit also preserves the archive roster.
{
 const r=normalizeRoom(newRoom());const sid=(await save(r)).sessionId;await as('anon');await join(r,tokens[0],1);await as('authenticated',A);await teacher('start',sid);await finish(sid);await as('anon');assert((await call("select public.escape_student_lobby($1,'leave') result",[tokens[0]])).left);await as('authenticated',A);assert.equal((await dash(sid)).participants.length,1);await cleanup(r);
}
await as('anon');await assert.rejects(db.query('select * from escape_private.parallel_closures'),/permission denied/);await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_contents')).rows[0].n,0);await db.close();console.log('PASS 016 SQL: linear/parallel AND/OR, both winners, same-role access, late/simultaneous submit, hold/reconnect, repeated splits, rewind/reset audit, logical %, completed/finished leave, security and cleanup');
