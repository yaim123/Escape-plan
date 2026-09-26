import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { newRoom,newBlock,ensureBlockQr } from '../src/core/model.js';
import { isComplete,isUnlocked,assignedMembers } from '../src/core/conditions.js';
import { checkAnswer } from '../src/core/answers.js';
process.on('uncaughtException',error=>{console.error(error.message,error.where||'',error.stack?.split('\n').filter(s=>s.includes('verify-ux-sql')).join('\n')||'');process.exit(1);});
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
if(process.argv.includes('--media')){await (await import('./storage-fixture.mjs')).storageFixture(db);await db.exec(await readFile('supabase/011_stages_display_and_media.sql','utf8'));}
if(process.argv.includes('--tools'))await db.exec(await readFile('supabase/012_analysis_print_and_block_library.sql','utf8'));
if(process.argv.includes('--qr-ux'))await db.exec(await readFile('supabase/013_qr_scan_receipt.sql','utf8'));
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


const snapshot=(r,action='inspect',info={},allow=true,failed=[])=>call('select public.escape_lobby_snapshot($1,$2,$3,$4,$5,$6,$7) result',[r.id,action,info.state?.sessionId||null,info.version||null,info.snapshotVersion||null,allow,failed]);
const update=async r=>db.query('update public.escape_contents set document=$2 where id=$1',[r.id,r]);
const r=newRoom('몰입형 수업');r.playMode='team';r.content[0].display='immersive';r.content[0].body='영화 자막';r.content[0].backgroundUrl='bad';r.content[0].media=[{type:'image',url:'bad'}];r.content.push(newBlock('guide'));
await as('authenticated',A);
await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[r.id,A,r.roomCode,r.title,r]);
let info=await snapshot(r);await assert.rejects(snapshot(r,'open',info,false),/자료/);
const state=await snapshot(r,'open',info);const sid=state.sessionId;
assert.deepEqual((await db.query('select document from public.escape_contents where id=$1',[r.id])).rows[0].document,r);
info=await snapshot(r);assert.equal(info.changed,false);assert.equal(info.snapshot.content[0].backgroundUrl,'');assert.equal(info.snapshot.content[0].display,'immersive');assert.deepEqual(info.snapshot.content[0].media,[]);
await as('anon');const a=await join(r,tokens[0],1),b=await join(r,tokens[1],2);await lobby(tokens[0],1);await lobby(tokens[1],2);
await assert.rejects(snapshot(r),/permission denied/);
await as('authenticated',B);await assert.rejects(snapshot(r),/본인/);
await as('authenticated',A);
r.content[0].body='새 자막';await update(r);info=await snapshot(r);assert.equal(info.changed,true);
const refreshed=await snapshot(r,'refresh',info);assert.equal(refreshed.sessionId,sid);assert.equal(refreshed.participants.length,2);assert.deepEqual(refreshed.participants.map(p=>p.team).sort(),[1,2]);assert.equal((await snapshot(r)).changed,false);
// A second author edit invalidates a pending confirmation.
info=await snapshot(r);r.content[0].body='세 번째 자막';await update(r);await assert.rejects(snapshot(r,'refresh',info),/다시 변경/);
info=await snapshot(r);await snapshot(r,'refresh',info);
// Preserve teams instead of silently dropping/reassigning existing members.
r.teamSettings.teamCount=1;await update(r);info=await snapshot(r);await assert.rejects(snapshot(r,'refresh',info),/팀 편성/);
r.teamSettings.teamCount=4;await update(r);info=await snapshot(r);await snapshot(r,'refresh',info);
info=await snapshot(r);await teacher('start',sid);await assert.rejects(snapshot(r,'refresh',info),/대기 상태/);
assert.equal((await snapshot(r)).snapshot,null);
await as('anon');let game=await play(tokens[0]);assert.equal(game.current.display,'immersive');assert.equal(game.current.immersiveOverlay,true);assert.equal(game.current.body,'세 번째 자막');assert.ok(!JSON.stringify(game).includes('answers'));
await submit(tokens[0],r.content[0],null);assert.equal((await play(tokens[0])).current.id,r.content[1].id);assert.equal((await play(tokens[1])).current.id,r.content[0].id);await submit(tokens[1],r.content[0],null);
await as('authenticated',A);
await call("select public.escape_teacher_control($1,'pause','session',null,null,null,null,null,$2,$3) result",[sid,(await dash(sid)).revision,crypto.randomUUID()]);
await assert.rejects(snapshot(r,'refresh',info),/대기 상태/);
// Reset transaction and historical archives remain independent.
await finish(sid);const next=await finish(sid,'reset',true);assert.equal(next.status,'lobby');assert.equal((await history(r.id)).length,1);
info=await snapshot(r);await snapshot(r,'assets',info);await as('anon');await join(r,tokens[0],1);await lobby(tokens[0],1);await as('authenticated',A);await teacher('start',next.sessionId);await finish(next.sessionId);await finish(next.sessionId,'reset',false);assert.equal((await history(r.id)).length,1);
await db.query('delete from public.escape_contents where id=$1',[r.id]);
// Hard errors and display type restrictions must also be enforced for direct RPC callers.
for(const invalid of ['answer','question-immersive','guide-immersive','condition']){
 const x=newRoom();x.content=[newBlock(invalid==='guide-immersive'?'guide':'question')];const q=x.content[0];q.answers=['A'];
 if(invalid==='answer')q.answers=[];
 if(invalid.endsWith('immersive'))q.display='immersive';
 if(invalid==='condition')q.unlock.conditions=[{blockId:crypto.randomUUID(),event:'complete'}];
 await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[x.id,A,x.roomCode,x.title,x]);
 await assert.rejects(snapshot(x,'open',await snapshot(x)));
 await db.query('delete from public.escape_contents where id=$1',[x.id]);
}
// Actual browser failures may drop only the listed assets; the source is untouched.
const x=newRoom();x.content[0].display='image';x.content[0].backgroundUrl='https://example.test/missing.png';x.content[0].media=[{type:'audio',url:'https://example.test/missing.mp3'}];
await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[x.id,A,x.roomCode,x.title,x]);
await snapshot(x,'open',await snapshot(x),true,[x.content[0].backgroundUrl,x.content[0].media[0].url]);info=await snapshot(x);assert.equal(info.snapshot.content[0].display,'theme');assert.deepEqual(info.snapshot.content[0].media,[]);assert.deepEqual(info.document,x);
await db.query('delete from public.escape_contents where id=$1',[x.id]);
await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_contents')).rows[0].n,0);await db.close();
console.log('PASS 010: warning consent, source immutability, lobby refresh/team preservation, stale/running guards, immersive server progression, RLS, reset/archive isolation and fixture cleanup');
