import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { newRoom,newBlock,ensureBlockQr } from '../src/core/model.js';
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
if(process.argv.includes('--ux'))await db.exec(await readFile('supabase/010_lobby_assets_and_immersive.sql','utf8'));
if(process.argv.includes('--media')){await (await import('./storage-fixture.mjs')).storageFixture(db);await db.exec(await readFile('supabase/011_stages_display_and_media.sql','utf8'));}
if(process.argv.includes('--tools'))await db.exec(await readFile('supabase/012_analysis_print_and_block_library.sql','utf8'));
if(process.argv.includes('--qr-ux'))await db.exec(await readFile('supabase/013_qr_scan_receipt.sql','utf8'));
if(process.argv.includes('--team-chat'))await db.exec(await readFile('supabase/014_team_chat_and_rewind.sql','utf8'));if(process.argv.includes('--roles'))await db.exec(await readFile('supabase/015_team_roles_and_visibility.sql','utf8'));
if(process.argv.includes('--parallel'))await db.exec(await readFile('supabase/016_parallel_flow.sql','utf8'));
const as=async(role,uid='')=>{await db.exec(`reset role; set role ${role};`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);};
const call=async(sql,args=[])=>(await db.query(sql,args)).rows[0].result;
const teacher=(action,id)=>call('select public.escape_teacher_lobby($1,$2) result',[action,id]);
const join=(r,t,n)=>call('select public.escape_join_lobby($1,$2,2,6,$3,$4) result',[r.roomCode,t,n,`학생${n}`]);
const lobby=(t,team)=>call("select public.escape_student_lobby($1,'team',$2) result",[t,team]);
const play=(t,action='read',block=null,input=null,request=null)=>call('select public.escape_student_play($1,$2,$3,$4,$5) result',[t,action,block,input===null?null:JSON.stringify(input),request]);
const submit=(t,b,input,request=crypto.randomUUID())=>play(t,'submit',b.id,input,request);
const save=async r=>{await as('authenticated',A); await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[r.id,A,r.roomCode,r.title,r]); return teacher('open',r.id);};
const tokens=['a','b','c'].map(x=>x.repeat(64));
const dash=id=>call('select public.escape_teacher_progress($1) result',[id]);
const finish=(id,action='finish',keep=true,request=crypto.randomUUID())=>call('select public.escape_finish_reset($1,$2,$3,$4,true) result',[id,action,keep,request]);
const history=id=>call('select public.escape_result_history($1) result',[id]);

const {newQrMission,newQr}=await import('../src/core/qr.js');
const scan=(t,q)=>call('select public.escape_scan_qr($1,$2) result',[t,q.token]);

const answerQr=(t,b,q)=>call('select public.escape_answer_qr($1,$2,$3) result',[t,b.id,q.token]);
const control=async(sid,action,target={})=>call('select public.escape_teacher_control($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[sid,action,target.scope||'session',target.id||null,target.team||null,target.block||null,null,null,(await dash(sid)).revision,crypto.randomUUID()]);
function fixture(mode,scope,condition){const r=newRoom('검증 '+mode+scope+condition);r.playMode=mode;const intro=newBlock('story'),q=newBlock();q.questionType='qr';q.qrScope=scope;r.content=[intro,q,newBlock('guide')];const m=ensureBlockQr(r,q);m.mode=condition;m.count=2;m.codes=[newQr(),newQr(),newQr()];return {r,q,m,intro,next:r.content[2]};}
for(const mode of ['individual','team'])for(const scope of ['student','team'])for(const condition of ['ANY','ALL','N_OF_M','UNIQUE_MEMBER']){
 if(condition==='UNIQUE_MEMBER'&&(mode!=='team'||scope!=='team'))continue;
 const {r,q,m,intro,next}=fixture(mode,scope,condition);const sid=(await save(r)).sessionId;
 assert.equal((await teacher('open',r.id)).sessionId,sid);
 const states=await call('select public.escape_class_states() result');assert.ok(states.some(x=>x.contentId===r.id));
 await as('anon');const a=await join(r,tokens[0],1),b=await join(r,tokens[1],2);if(mode==='team'){await lobby(tokens[0],1);await lobby(tokens[1],1);}
 await as('authenticated',A);await teacher('start',sid);await as('anon');
 assert.deepEqual((await play(tokens[0])).qr,[]);await assert.rejects(scan(tokens[0],m.codes[0]),/아직 사용할 수/);
 await submit(tokens[0],intro,null);if(mode==='individual')await submit(tokens[1],intro,null);
 await assert.rejects(answerQr(tokens[0],q,newQr()),/이 문제의 QR/);assert.equal((await play(tokens[0])).qr[0].found,0);
 await as('authenticated',A);await control(sid,'pause');await as('anon');await assert.rejects(scan(tokens[0],m.codes[0]),/진행 중/);await as('authenticated',A);await control(sid,'resume');await as('anon');
 const first=await answerQr(tokens[0],q,m.codes[0]);
 if(process.argv.includes('--qr-ux'))assert.deepEqual(first.qrScan,{mode:condition,found:1,required:condition==='ALL'?3:condition==='ANY'?1:2,done:condition==='ANY',...(process.argv.includes('--team-chat')&&condition==='UNIQUE_MEMBER'?{selfDone:true}:{})});
 if(condition==='UNIQUE_MEMBER'&&process.argv.includes('--team-chat')){await assert.rejects(scan(tokens[0],m.codes[1]),/이미 QR/);await scan(tokens[1],m.codes[1]);}
 else if(condition!=='ANY'){
  assert.equal((await scan(tokens[0],m.codes[0])).duplicate,true);assert.equal((await play(tokens[0])).qr[0].found,1);
  const second=await scan(tokens[0],m.codes[1]);if(process.argv.includes('--qr-ux')){assert.equal(second.qrScan.found,condition==='UNIQUE_MEMBER'?1:2);assert.equal(second.qrScan.required,condition==='ALL'?3:2);}
  if(condition==='ALL')await scan(tokens[0],m.codes[2]);
  if(condition==='UNIQUE_MEMBER'){assert.equal((await play(tokens[0])).current.id,q.id);const last=await scan(tokens[1],m.codes[2]);if(process.argv.includes('--qr-ux'))assert.deepEqual(last.qrScan,{mode:'UNIQUE_MEMBER',found:2,required:2,done:true});}
 }
 assert.equal((await play(tokens[0])).current.id,next.id);assert.deepEqual((await play(tokens[0])).qr,[]);
 await assert.rejects(scan(tokens[0],m.codes[0]),/아직 사용할 수/);
 if(mode==='team'&&scope==='team')assert.equal((await play(tokens[1])).current.id,next.id);
 else{
  assert.equal((await play(tokens[1])).current.id,q.id);assert.equal((await play(tokens[1])).qr[0].found,0);
  for(const code of m.codes.slice(0,condition==='ANY'?1:condition==='ALL'?3:2))await scan(tokens[1],code);
  assert.equal((await play(tokens[1])).current.id,next.id);
 }
 const safe=JSON.stringify(await play(tokens[1]));assert.ok(!safe.includes(m.codes[0].token));assert.ok(!safe.includes('qrMissionId'));
 await assert.rejects(call('select public.escape_class_states() result'),/permission denied/);
 await assert.rejects(db.query('select * from public.escape_qr_scans'),/permission denied/);
 await as('authenticated',B);assert.deepEqual(await call('select public.escape_class_states() result'),[]);
 await as('authenticated',A);assert.ok((await dash(sid)).participants.every(p=>p.progress.completedCount===2));
 await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
console.log('PASS current-block QR: all four predicates, scanner/team scope, direct URL RPC, early/wrong/repeated QR, pause, realtime revisions, recovery, RLS');

// Teacher force overrides must win over QR requirements and unmet unlock conditions.
{
 const {r,q,m,intro,next}=fixture('team','team','ALL');r.content=[q,intro,next];next.unlock.conditions=[{blockId:intro.id,event:'complete',member:0}];
 const locked=newBlock();locked.answers=['YES'];locked.unlock.conditions=[{blockId:next.id,event:'complete',member:0}];r.content.push(locked);
 const sid=(await save(r)).sessionId;await as('anon');const a=await join(r,tokens[0],1),b=await join(r,tokens[1],2);await lobby(tokens[0],1);await lobby(tokens[1],1);
 await as('authenticated',A);await teacher('start',sid);await control(sid,'skip',{scope:'student',id:a.participantId});await as('anon');
 assert.equal((await play(tokens[0])).current.id,intro.id);assert.equal((await play(tokens[1])).current.id,q.id);
 await as('authenticated',A);await control(sid,'skip',{scope:'team',team:1});await as('anon');assert.notEqual((await play(tokens[1])).current?.id,q.id);
 await as('authenticated',A);await control(sid,'move',{scope:'student',id:b.participantId,block:locked.id});await as('anon');
 assert.equal((await play(tokens[1])).current.id,locked.id);assert.equal((await play(tokens[1])).current.id,locked.id);
 await as('authenticated',A);await control(sid,'skip',{scope:'student',id:b.participantId});await as('anon');assert.notEqual((await play(tokens[1])).current?.id,locked.id);
 await as('authenticated',A);assert.ok((await dash(sid)).actions.some(a=>a.action==='skip'));await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
// Drafts are allowed by the existing table; execution is rejected by the server.
for(const invalid of ['answer','media','background','qr','condition']){
 const {r,q,m}=fixture('individual','student','ANY');r.content=[q];
 if(invalid==='answer'){q.questionType='short';q.answers=[];}
 if(invalid==='media')q.media=[{type:'image',url:'javascript:evil'}];
 if(invalid==='background'){q.display='image';q.backgroundUrl='';}
 if(invalid==='qr')m.codes=[];
 if(invalid==='condition')q.unlock.conditions=[{blockId:crypto.randomUUID(),event:'complete'}];
 await as('authenticated',A);await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[r.id,A,r.roomCode,r.title,r]);
 await assert.rejects(teacher('open',r.id));await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
// Stored obsolete wait blocks and empty attachments are stripped for new sessions.
{
 const r=newRoom();const wait={...newBlock('guide'),type:'wait'};r.content.unshift(wait);r.content[1].media=[{type:'image',url:''}];r.content[1].unlock.conditions=[{blockId:wait.id,event:'complete'}];
 const sid=(await save(r)).sessionId;await as('postgres');const doc=(await db.query('select content_snapshot from public.escape_sessions where id=$1',[sid])).rows[0].content_snapshot;
 assert.equal(doc.content.length,1);assert.deepEqual(doc.content[0].media,[]);assert.deepEqual(doc.content[0].unlock.conditions,[]);
 await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_contents')).rows[0].n,0);
// A finished class is archived when starting the next class; repeated clicks reuse the new lobby.
{
 const r=newRoom();const sid=(await save(r)).sessionId;await as('anon');await join(r,tokens[0],1);await as('authenticated',A);await teacher('start',sid);await finish(sid);
 assert.deepEqual(await call('select public.escape_class_states() result'),[]);
 const next=await teacher('open',r.id);assert.notEqual(next.sessionId,sid);assert.equal(next.status,'lobby');assert.equal((await teacher('open',r.id)).sessionId,next.sessionId);assert.equal((await history(r.id)).length,1);
 await db.query('delete from public.escape_contents where id=$1',[r.id]);
}
if(process.argv.includes('--qr-ux')){
 const {r,q,m}=fixture('team','team','ALL');r.content=[q];m.codes=m.codes.slice(0,2);const sid=(await save(r)).sessionId;
 await as('anon');await join(r,tokens[0],1);await join(r,tokens[1],2);await lobby(tokens[0],1);await lobby(tokens[1],2);
 await as('authenticated',A);await teacher('start',sid);await as('anon');
 const first=await answerQr(tokens[0],q,m.codes[0]);assert.deepEqual(first.qrScan,{mode:'ALL',found:1,required:2,done:false});
 assert.equal((await play(tokens[1])).qr[0].found,0);const other=await scan(tokens[1],m.codes[0]);assert.equal(other.qrScan.found,1);
 const last=await answerQr(tokens[0],q,m.codes[1]);assert.deepEqual(last.qrScan,{mode:'ALL',found:2,required:2,done:true});assert.ok(last.game.result);assert.deepEqual(last.game.qr,[]);
 assert.equal((await play(tokens[1])).qr[0].found,1);await assert.rejects(scan(tokens[0],m.codes[1]));
 await assert.rejects(call('select escape_private.scan_current_qr($1,$2) result',[tokens[1],m.codes[1].token]),/permission denied/);
 assert.deepEqual(Object.keys(last.qrScan).sort(),['done','found','mode','required']);
 await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[r.id]);
 console.log('PASS 013 receipt: exact ANY/ALL/N/active UNIQUE_MEMBER counts, final result, direct URL, duplicate, separate teams, private grants');
}
await db.close();console.log('PASS draft/start boundary, wait removal, teacher skip/move precedence, class reuse and complete fixture cleanup');
