import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { newRoom,newBlock } from '../src/core/model.js';
import { isComplete,isUnlocked,assignedMembers } from '../src/core/conditions.js';
import { checkAnswer } from '../src/core/answers.js';
process.on('uncaughtException',error=>{console.error(error.message,error.where||'',error.stack?.split('\n').filter(s=>s.includes('verify-play-sql')).join('\n')||'');process.exit(1);});
let PGlite; try { ({PGlite}=await import('@electric-sql/pglite')); } catch { ({PGlite}=await import('../artifacts/pglite/package/dist/index.js')); }
const db=new PGlite(); const A=crypto.randomUUID(), B=crypto.randomUUID();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema realtime;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create table realtime.test_messages(payload jsonb);
create function realtime.send(p jsonb,e text,t text,b boolean) returns void language sql as $$ insert into realtime.test_messages values(p) $$;`);
await db.query('insert into auth.users values($1),($2)',[A,B]);
for(const file of ['001_foundation','002_live_lobby','003_live_play']) await db.exec(await readFile(`supabase/${file}.sql`,'utf8'));
if(process.argv.includes('--controls')) for(const file of ['004_teacher_controls','005_teacher_team_event_fix']) await db.exec(await readFile(`supabase/${file}.sql`,'utf8'));
if(process.argv.includes('--results'))await db.exec(await readFile('supabase/006_results_and_reset.sql','utf8'));
if(process.argv.includes('--qr-question')||process.argv.includes('--editor-flow'))for(const file of ['007_qr_interaction','008_qr_question_type'])await db.exec(await readFile(`supabase/${file}.sql`,'utf8'));
if(process.argv.includes('--editor-flow'))await db.exec(await readFile('supabase/009_editor_flow_and_block_qr.sql','utf8'));
if(process.argv.includes('--ux'))await db.exec(await readFile('supabase/010_lobby_assets_and_immersive.sql','utf8'));
if(process.argv.includes('--media')){await (await import('./storage-fixture.mjs')).storageFixture(db);await db.exec(await readFile('supabase/011_stages_display_and_media.sql','utf8'));}
if(process.argv.includes('--tools'))await db.exec(await readFile('supabase/012_analysis_print_and_block_library.sql','utf8'));
const as=async(role,uid='')=>{await db.exec(`reset role; set role ${role};`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);};
const call=async(sql,args=[])=>(await db.query(sql,args)).rows[0].result;
const teacher=(action,id)=>call('select public.escape_teacher_lobby($1,$2) result',[action,id]);
const join=(r,t,n)=>call('select public.escape_join_lobby($1,$2,2,6,$3,$4) result',[r.roomCode,t,n,`학생${n}`]);
const lobby=(t,team)=>call("select public.escape_student_lobby($1,'team',$2) result",[t,team]);
const play=(t,action='read',block=null,input=null,request=null)=>call('select public.escape_student_play($1,$2,$3,$4,$5) result',[t,action,block,input===null?null:JSON.stringify(input),request]);
const submit=(t,b,input,request=crypto.randomUUID())=>play(t,'submit',b.id,input,request);
const save=async r=>{await as('authenticated',A); await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[r.id,A,r.roomCode,r.title,r]); return teacher('open',r.id);};
const tokens=['a','b','c'].map(x=>x.repeat(64));

// Compare all existing assignment/completion/condition modes with the JS engine.
const block=newBlock(), members=[{id:'a',member:1,role:'조장'},{id:'b',member:2,role:'조원'},{id:'c',member:3,role:'조원'}];
const events=[1,2].map(member=>({blockId:block.id,type:'complete',member,role:members[member-1].role}));
for(const assignment of ['all','auto','member','role']) {
  block.assignment={mode:assignment,member:2,role:'조장'};
  for(const completion of ['any','all','n','member','role','assigned']) {
    block.completion={mode:completion,count:2,member:2,role:'조원'};
    assert.equal(await call('select escape_private.completed($1,$2,1,false) result',[block,{members,events}]),isComplete(block,events,members,1));
  }
  for(const m of members) assert.equal(await call('select escape_private.assigned($1,$2,$3,1) result',[block,m,members]),assignedMembers(block,members,1).some(x=>x.id===m.id));
}
for(const mode of ['AND','OR','N']) {
  const unlock={mode,count:2,conditions:[{blockId:block.id,event:'complete',member:1},{blockId:block.id,event:'complete',role:'조원'},{blockId:block.id,event:'button'}]};
  assert.equal(await call('select escape_private.unlocked($1,$2) result',[unlock,events]),isUnlocked(unlock,events));
}
for(const [kind,answers,inputs] of [
  ['short',['포도당','glucose'],[' Glucose ','wrong']],['cipher',['ABC123'],['abc123','no']],['number',['2.5'],['2.50','2.6','']],
  ['choice',['나'],['가','나']],['ox',['O'],['O','X']],['multi',['a','b'],[['b','a'],['a','a'],['a']]],
  ['order',['b','a'],[['b','a'],['a','b']]],['match',['right2','right1'],[['right2','right1'],['right1','right2']]],['switch',[],[true,false]],['approval',[],[true]],['condition',[],[true]]]) {
  const b={...newBlock(),questionType:kind,answers};
  for(const input of inputs) assert.equal(await call('select escape_private.answer_correct($1,$2) result',[b,JSON.stringify(input)]),checkAnswer(b,input),kind);
}
const normalized={...newBlock(),answers:['가abc'],normalization:{trim:true,spaces:true,case:true,punctuation:true}};
assert.equal(await call('select escape_private.answer_correct($1,$2) result',[normalized,JSON.stringify('  가ＡＢＣ ★+!💡©—  ')]),checkAnswer(normalized,'  가ＡＢＣ ★+!💡©—  '));

const individual=newRoom('개인전 SQL 검증');
const intro=newBlock('story'), q=newBlock(), q2=newBlock(); q.answers=['SECRET_ANSWER']; q2.answers=['둘']; q2.questionType='choice'; q2.options=['하나','둘','셋'];
individual.content=[intro,q,q2];
let opened=await save(individual); await as('anon');
const pa=await join(individual,tokens[0],1); await join(individual,tokens[1],2);
await assert.rejects(submit(tokens[0],q,'SECRET_ANSWER'),/진행 중/);
await as('authenticated',A); await teacher('start',opened.sessionId); await as('anon');
let view=await play(tokens[0]); assert.equal(view.current.id,intro.id); assert.ok(!JSON.stringify(view).includes('SECRET_ANSWER'));
await assert.rejects(submit(tokens[0],q,'SECRET_ANSWER'),/공개되지/);
await submit(tokens[0],intro,null); view=await play(tokens[0]); assert.equal(view.current.id,q.id);
assert.equal((await play(tokens[1])).current.id,intro.id); // individual isolation
const request=crypto.randomUUID(); let result=await submit(tokens[0],q,'DO_NOT_STORE_THIS_WRONG_INPUT',request);
assert.equal(result.outcome,'wrong'); assert.equal(result.game.progress.wrongCounts[q.id],1);
result=await submit(tokens[0],q,'DO_NOT_STORE_THIS_WRONG_INPUT',request); assert.equal(result.game.progress.wrongCounts[q.id],1);
result=await submit(tokens[0],q,'SECRET_ANSWER'); assert.equal(result.game.current.id,q2.id);
assert.ok(!JSON.stringify(result).includes('SECRET_ANSWER')); assert.ok(!('answers' in result.game.current));
await submit(tokens[0],q2,'둘'); assert.equal((await play(tokens[0])).current,null);
await as('authenticated',B); await assert.rejects(call('select public.escape_teacher_progress($1) result',[opened.sessionId]),/본인 수업/);
await as('authenticated',A); const dashboard=await call('select public.escape_teacher_progress($1) result',[opened.sessionId]);
assert.equal(dashboard.participants.find(p=>p.id===pa.participantId).progress.completedCount,3);
await as('postgres');
for(const table of ['escape_block_progress','escape_submission_receipts','escape_events','escape_participants']) {
  assert.ok(!JSON.stringify((await db.query(`select * from public.${table}`)).rows).includes('DO_NOT_STORE_THIS_WRONG_INPUT'));
}
await as('authenticated',A); await db.query('delete from public.escape_contents where id=$1',[individual.id]);

const team=newRoom('협동 SQL 검증'); team.playMode='team'; team.teamSettings.rolesEnabled=true;
const shared=newBlock('story'), taskA=newBlock(),taskB=newBlock(),gate=newBlock(),approval=newBlock();
shared.completion.mode='all'; taskA.answers=['A']; taskA.assignment={mode:'member',member:1}; taskA.completion={mode:'assigned'};
taskB.answers=['B']; taskB.assignment={mode:'role',role:'조원'}; taskB.completion={mode:'assigned'};
taskB.unlock={mode:'AND',conditions:[{blockId:shared.id,event:'complete',member:1},{blockId:shared.id,event:'complete',member:2}]};
gate.answers=['G']; gate.unlock={mode:'N',count:2,conditions:[{blockId:taskA.id,event:'complete',member:1},{blockId:taskB.id,event:'complete',role:'조원'}]};
approval.questionType='approval'; team.content=[shared,taskA,taskB,gate,approval];
opened=await save(team); await as('anon');
const teamA=await join(team,tokens[0],1),teamB=await join(team,tokens[1],2); await join(team,tokens[2],3);
await lobby(tokens[0],1); await lobby(tokens[1],1); await lobby(tokens[2],2);
await as('authenticated',A); await teacher('start',opened.sessionId); await as('anon');
await submit(tokens[0],shared,null); assert.equal((await play(tokens[0])).current,null);
await submit(tokens[1],shared,null); assert.equal((await play(tokens[0])).current.id,taskA.id); assert.equal((await play(tokens[1])).current.id,taskB.id);
assert.equal((await play(tokens[2])).current.id,shared.id); // other team isolation
await assert.rejects(submit(tokens[0],taskB,'B'),/배정되지/);
await submit(tokens[0],taskA,'A'); assert.equal((await play(tokens[0])).current,null);
await submit(tokens[1],taskB,'B'); assert.equal((await play(tokens[0])).current.id,gate.id);
await submit(tokens[0],gate,'G'); assert.equal((await play(tokens[1])).current.id,approval.id);
await assert.rejects(submit(tokens[1],approval,true),/교사 승인/);
await as('authenticated',A); await call("select public.escape_teacher_progress($1,'approve',$2,$3) result",[opened.sessionId,teamA.participantId,approval.id]);
await as('anon'); assert.equal((await play(tokens[1])).progress.completedCount,5);
await assert.rejects(play('d'.repeat(64)),/참가 기록/);
for(const table of ['escape_contents','escape_sessions','escape_participants','escape_events','escape_block_progress','escape_submission_receipts']) await assert.rejects(db.query(`select * from public.${table}`),/permission denied/);
await assert.rejects(db.query('select escape_private.play_state($1)',[teamA.participantId]),/permission denied/);
await as('authenticated',A); await db.query('delete from public.escape_contents where id=$1',[team.id]);
await as('postgres');
for(const table of ['escape_sessions','escape_participants','escape_events','escape_block_progress','escape_submission_receipts']) assert.equal((await db.query(`select * from public.${table}`)).rows.length,0);
assert.ok((await db.query('select * from realtime.test_messages')).rows.every(r=>JSON.stringify(r.payload)==='{}'));
await db.close(); console.log('PASS: migration, JS engine parity, all answer types, individual/team isolation, assignment/conditions/completion, wrong retry idempotency, safe projection, teacher approval, RLS and cascade cleanup');
