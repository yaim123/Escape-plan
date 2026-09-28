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

const chat=(t,action='list',room=null,text=null)=>call('select public.escape_chat($1,$2,$3,$4,$5) result',[t,action,room,text,crypto.randomUUID()]);
async function setup(r,n,teams=[]){const sid=(await save(r)).sessionId;await as('anon');const ids=[];for(let i=0;i<n;i++){ids.push((await join(r,tokens[i],i+1)).participantId);await lobby(tokens[i],teams[i]||1);}await as('authenticated',A);return {sid,ids};}
async function cleanup(r){await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[r.id]);}
function rolesRoom(){const r=newRoom('015 역할 경로');r.playMode='team';Object.assign(r.teamSettings,{rolesEnabled:true,roleViewsEnabled:true,roles:['탐색자','탐색자','분석가','분석가']});return r;}
// Exact 2+2 slots, common -> role branches -> common, server projection and action isolation.
for(const explicit of [false,true]){
 const r=rolesRoom(),intro=newBlock('story'),a=newBlock(),b=newBlock(),end=newBlock('guide');
 a.answers=['A'];b.answers=['B'];a.title='탐색 비공개';a.body='탐색 본문 비밀';a.media=[{type:'image',url:'https://example.com/private-a.png'}];a.assignment.visibleRoles=['탐색자'];b.assignment.visibleRoles=['분석가'];
 r.content=[intro,a,b,end];if(explicit)end.unlock.conditions=[{blockId:a.id,event:'complete'},{blockId:b.id,event:'complete'}];
 const room=newChatRoom();room.name='탐색자 회의';room.scope='roles';room.roles=['탐색자'];r.chatRooms=[room];a.chatEnabled=true;a.chatRoomIds=[room.id];
 const {sid,ids}=await setup(r,4);await teacher('start',sid);const d=await dash(sid);assert.deepEqual(d.participants.map(p=>p.role),['탐색자','탐색자','분석가','분석가']);
 await as('anon');await submit(tokens[0],intro,null);
 assert.equal((await play(tokens[0])).current.id,a.id);assert.equal((await play(tokens[1])).current.id,a.id);const analyst=await play(tokens[2]);assert.equal(analyst.current.id,b.id);assert(!JSON.stringify(analyst).includes('탐색 비공개'));assert(!JSON.stringify(analyst).includes('private-a.png'));assert(!analyst.progress.availableIds.includes(a.id));
 for(const action of ['select','submit','hint'])await assert.rejects(play(tokens[2],action,a.id,'A',crypto.randomUUID()),/역할에게 공개되지/);
 const ca=await chat(tokens[0]),ca2=await chat(tokens[1]);assert.equal(ca.rooms.length,1);assert.equal(ca2.rooms[0].id,ca.rooms[0].id);assert.equal((await chat(tokens[2])).rooms.length,0);await assert.rejects(chat(tokens[2],'read',ca.rooms[0].id),/참여할 수 없는/);
 await submit(tokens[0],a,'A');assert.equal((await play(tokens[0])).current?.id,explicit?undefined:end.id);assert.equal((await play(tokens[2])).current.id,b.id);
 await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_events where participant_id=$1 and block_id=$2',[ids[2],a.id])).rows[0].n,0);
 await as('anon');await submit(tokens[2],b,'B');assert.equal((await play(tokens[0])).current.id,end.id);await submit(tokens[0],end,null);assert((await play(tokens[2])).result);assert.equal((await play(tokens[0])).result.baseScore,200);
 await as('authenticated',A);assert((await dash(sid)).summary.allComplete);await cleanup(r);
}
// Fewer members use leading slots; capacity rejection is atomic, no role repetition.
for(const n of [3,4]){
 const r=rolesRoom();r.teamSettings.roleViewsEnabled=false;if(n===4)r.teamSettings.roles=['A','B'];const {sid}=await setup(r,n);
 if(n===4){await assert.rejects(teacher('start',sid),/팀원 수보다 설정된 역할/);await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_participants where session_id=$1 and member_number is not null',[sid])).rows[0].n,0);}
 else{await teacher('start',sid);assert.deepEqual((await dash(sid)).participants.map(p=>p.role),['탐색자','탐색자','분석가']);}
 await cleanup(r);
}
// A mid-game team move uses an unused slot, never last-role repetition or member renumbering.
{
 const r=rolesRoom();r.teamSettings.roles=['A','B'];const {sid,ids}=await setup(r,3,[1,1,2]);await teacher('start',sid);
 await assert.rejects(control(sid,'team',{scope:'student',id:ids[2],newTeam:1}),/./); // explicit RPC below supplies p_new_team
 const move=async(id,team)=>call("select public.escape_teacher_control($1,'team','student',$2,null,null,null,$3,$4,$5) result",[sid,id,team,(await dash(sid)).revision,crypto.randomUUID()]);
 await assert.rejects(move(ids[2],1),/역할 인원/);await move(ids[0],2);await move(ids[0],1);const d=await dash(sid);assert.equal(d.participants.find(p=>p.id===ids[0]).role,'A');assert.equal(d.participants.find(p=>p.id===ids[1]).role,'B');await cleanup(r);
}
// Global switches ignore but preserve child configuration; server chat is denied including list.
for(const enabled of [false,true]){
 const r=rolesRoom();r.teamSettings.roleViewsEnabled=enabled;r.teamSettings.chatEnabled=enabled;const a=newBlock('story');a.assignment.visibleRoles=['분석가'];r.content=[a,newBlock('guide')];const c=newChatRoom();r.chatRooms=[c];a.chatEnabled=true;a.chatRoomIds=[c.id];
 const {sid}=await setup(r,3);await teacher('start',sid);await as('anon');const g=await play(tokens[0]);assert.equal(g.current.id,enabled?r.content[1].id:a.id);
 if(!enabled){assert.equal(g.current.chatEnabled,false);await assert.rejects(chat(tokens[0]),/채팅을 사용할 수 없/);}else assert.equal((await chat(tokens[2])).rooms.length,1);
 await cleanup(r);
}
// Legacy single-role assignment is adopted only with the global role screen switch ON.
{
 const r=rolesRoom(),a=newBlock('story');a.assignment={mode:'role',role:'탐색자'};r.content=[a,newBlock('guide')];const {sid}=await setup(r,3);await teacher('start',sid);await as('anon');assert.equal((await play(tokens[2])).current.id,r.content[1].id);await cleanup(r);
}
// 'Assigned' retains solver semantics but only visible assignees are required.
{
 const r=rolesRoom(),a=newBlock();a.answers=['OK'];a.assignment.visibleRoles=['탐색자'];a.completion.mode='assigned';r.content=[a,newBlock('guide')];const {sid}=await setup(r,4);await teacher('start',sid);await as('anon');await submit(tokens[0],a,'OK');assert.equal((await play(tokens[0])).current,null);assert.equal((await play(tokens[0])).waiting.blockId,a.id);assert.equal((await play(tokens[0])).waiting.found,undefined);await submit(tokens[1],a,'OK');assert.equal((await play(tokens[0])).current.id,r.content[1].id);await cleanup(r);
}
// Waiting from authoritative UNIQUE contributions, active departures, configured text and counts.
{
 const {r,q,m,next}=fixture('team','team','UNIQUE_MEMBER');r.content=[q,next];m.codes=Array.from({length:4},newQr);r.teamSettings.waiting={title:'조사 끝!',body:'동료들을 기다려주세요.',showCounts:true};const {sid}=await setup(r,4);await teacher('start',sid);await as('anon');
 await scan(tokens[0],m.codes[0]);let g=await play(tokens[0]);assert.deepEqual(g.waiting,{blockId:q.id,found:1,required:4});assert.equal(g.waitingSettings.title,'조사 끝!');await scan(tokens[1],m.codes[1]);assert.equal((await play(tokens[0])).waiting.found,2);
 await call("select public.escape_student_lobby($1,'leave') result",[tokens[3]]);assert.equal((await play(tokens[0])).waiting.required,3);await scan(tokens[2],m.codes[2]);g=await play(tokens[0]);assert.equal(g.current.id,next.id);assert.equal(g.waiting,null);await cleanup(r);
}
// Normal per-member ALL completion has meaningful counts; pause/read/reconnect preserves state.
{
 const r=rolesRoom(),q=newBlock();q.answers=['x'];q.completion.mode='all';r.content=[q,newBlock('guide')];const {sid}=await setup(r,4);await teacher('start',sid);await as('anon');await submit(tokens[0],q,'x');assert.equal((await play(tokens[0])).waiting.found,1);assert.equal((await play(tokens[0])).waiting.required,4);await as('authenticated',A);await control(sid,'pause');await as('anon');assert.equal((await play(tokens[0])).status,'paused');await as('authenticated',A);await control(sid,'resume');await as('anon');assert.equal((await play(tokens[0])).waiting.found,1);await cleanup(r);
}
// Dangling role references fail at execution; inactive chat configuration is retained and ignored.
{
 const r=rolesRoom();r.content[0].assignment.visibleRoles=['없는 역할'];await as('authenticated',A);await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[r.id,A,r.roomCode,r.title,r]);await assert.rejects(teacher('open',r.id),/존재하지 않는/);await cleanup(r);
 const off=rolesRoom();off.teamSettings.chatEnabled=false;off.chatRooms=[{...newChatRoom(),scope:'roles',roles:['삭제된 역할']}];const {sid}=await setup(off,1);await teacher('start',sid);await cleanup(off);
}
// Final role-only blocks score/finish for their audience without forged peer completion.
{
 const r=rolesRoom(),q=newBlock();q.answers=['x'];q.assignment.visibleRoles=['탐색자'];r.content=[q];r.rules.finishMode='final';r.rules.finalBlockId=q.id;
 const {sid,ids}=await setup(r,3);await teacher('start',sid);await as('anon');assert.equal((await play(tokens[2])).result,null);await submit(tokens[0],q,'x');assert.equal((await play(tokens[2])).result.baseScore,100);await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_events where participant_id=$1',[ids[2]])).rows[0].n,0);await cleanup(r);
}
// If the only final-role participant leaves before solving, no fabricated arrival is recorded.
{
 const r=rolesRoom(),q=newBlock();q.answers=['x'];q.assignment.visibleRoles=['분석가'];r.content=[newBlock('story'),q];r.rules.finishMode='final';r.rules.finalBlockId=q.id;const {sid}=await setup(r,3);await teacher('start',sid);await as('anon');await submit(tokens[0],r.content[0],null);await call("select public.escape_student_lobby($1,'leave') result",[tokens[2]]);assert.equal((await play(tokens[0])).result,null);await cleanup(r);
}
// Forced unlock cannot bypass audience; QR RPCs use the same available/current path gate.
{
 const r=rolesRoom(),q=newBlock();q.questionType='qr';q.qrScope='team';q.assignment.visibleRoles=['탐색자'];r.content=[q,newBlock('guide')];const m=ensureBlockQr(r,q);const {sid,ids}=await setup(r,3);await teacher('start',sid);await control(sid,'unlock',{scope:'student',id:ids[2],block:q.id});await as('anon');assert.notEqual((await play(tokens[2])).current.id,q.id);await assert.rejects(answerQr(tokens[2],q,m.codes[0]),/QR|공개/);await scan(tokens[0],m.codes[0]);assert.equal((await play(tokens[1])).current.id,r.content[1].id);await cleanup(r);
}
// Detect unsatisfiable role paths without changing the original completion rule.
for(const kind of ['all','n','final']){
 const r=rolesRoom(),q=newBlock('story');q.assignment.visibleRoles=['분석가'];r.content=[q,newBlock('guide')];if(kind==='all')q.completion.mode='all';if(kind==='n'){q.completion.mode='n';q.completion.count=3;}if(kind==='final'){r.rules.finishMode='final';r.rules.finalBlockId=q.id;}
 if(kind==='all'){await assert.rejects(save(r),/팀원 전원 완료/);await cleanup(r);continue;}
 const {sid}=await setup(r,kind==='final'?2:3);await assert.rejects(teacher('start',sid),kind==='final'?/최종 블록/:/인원/);await cleanup(r);
}
await as('anon');await assert.rejects(db.query("select escape_private.role_visible('{}','{}','x')"),/permission denied/);await assert.rejects(db.query('update public.escape_participants set role_slot=1'),/permission denied/);
await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_contents')).rows[0].n,0);await db.close();console.log('PASS 015: role slots/capacity/moves, role paths/conditions/results, projection and RPC denial, global chat, role chat, contribution waiting, compatibility, cleanup');
