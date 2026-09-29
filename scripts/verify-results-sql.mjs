import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { newRoom,newBlock } from '../src/core/model.js';
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
for(const file of ['001_foundation','002_live_lobby','003_live_play','004_teacher_controls','005_teacher_team_event_fix','006_results_and_reset']) await db.exec(await readFile(`supabase/${file}.sql`,'utf8'));
if(process.argv.includes('--qr-question')||process.argv.includes('--editor-flow'))for(const file of ['007_qr_interaction','008_qr_question_type'])await db.exec(await readFile(`supabase/${file}.sql`,'utf8'));
if(process.argv.includes('--editor-flow'))await db.exec(await readFile('supabase/009_editor_flow_and_block_qr.sql','utf8'));
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
const room=newRoom('도착 결과 검증');const q=newBlock();q.answers=['SECRET'];q.hints=['hint one','hint two'];q.points=100;room.content=[q];
Object.assign(room.rules,{ranking:'combined',rankVisibility:'end',scoreEnabled:true,wrongPenaltyType:'time',wrongPenalty:10,hintPenaltyType:'score',hintPenalty:15,hints:'individual',hintLimit:1});
let sid=(await save(room)).sessionId;await as('anon');const p1=await join(room,tokens[0],1);await join(room,tokens[1],2);
await as('authenticated',A);await teacher('start',sid);
await as('anon');await play(tokens[0],'hint',q.id,null,crypto.randomUUID());assert.deepEqual((await play(tokens[0])).revealedHints,['hint one']);
await assert.rejects(play(tokens[0],'hint',q.id,null,crypto.randomUUID()),/모두 사용/);assert.deepEqual((await play(tokens[1])).revealedHints,[]);
assert.equal((await play(tokens[0])).hasMoreHints,false);
await submit(tokens[0],q,'WRONG_NOT_SAVED');const finalRequest=crypto.randomUUID();await submit(tokens[0],q,'SECRET',finalRequest);let r1=(await play(tokens[0])).result;
assert.equal((await submit(tokens[0],q,'SECRET',finalRequest)).duplicate,true);
assert.ok(r1.arrivedAt);assert.equal(r1.wrongCount,1);assert.equal(r1.hintCount,1);assert.equal(r1.score,85);assert.equal(r1.penaltyMs,10000);assert.equal(r1.rank,undefined);
assert.ok(!JSON.stringify(await play(tokens[0])).includes('SECRET'));await assert.rejects(submit(tokens[0],q,'SECRET'),/탈출을 완료/);
await assert.rejects(play(tokens[0],'hint',q.id,null,crypto.randomUUID()),/탈출을 완료/);
await submit(tokens[1],q,'SECRET');assert.equal((await play(tokens[0])).result.arrivedAt,r1.arrivedAt);
await as('authenticated',A);let d=await dash(sid);assert.equal(d.summary.allComplete,true);assert.equal(d.summary.completed,2);
assert.equal(d.summary.results.find(r=>r.memberIds.includes(p1.participantId)).rank,2);
await finish(sid);await as('anon');assert.equal((await play(tokens[0])).result.rank,2);assert.equal((await play(tokens[0])).leaderboard.length,2);
await as('authenticated',B);await assert.rejects(finish(sid),/본인/);await assert.rejects(history(room.id),/본인/);
await as('authenticated',A);const resetId=crypto.randomUUID();const next=await finish(sid,'reset',true,resetId);assert.equal(next.status,'lobby');assert.notEqual(next.sessionId,sid);
assert.equal((await finish(sid,'reset',true,resetId)).sessionId,next.sessionId);assert.equal((await history(room.id)).length,1);
await as('anon');await assert.rejects(play(tokens[0]),/참가 기록/);await join(room,tokens[0],1);
await as('authenticated',A);await teacher('start',next.sessionId);await as('anon');assert.equal((await play(tokens[0])).result,null);assert.deepEqual((await play(tokens[0])).revealedHints,[]);
await as('authenticated',A);await finish(next.sessionId,'reset',false);assert.equal((await history(room.id)).length,1);
await db.query('delete from public.escape_contents where id=$1',[room.id]);

const team=newRoom('팀 도착');team.playMode='team';const t=newBlock();t.answers=['T'];t.hints=['shared'];t.completion.mode='all';team.content=[t];Object.assign(team.rules,{ranking:'time',rankVisibility:'live',hints:'team',hintLimit:1});
sid=(await save(team)).sessionId;await as('anon');await join(team,tokens[0],1);await join(team,tokens[1],2);await join(team,tokens[2],3);await lobby(tokens[0],1);await lobby(tokens[1],1);await lobby(tokens[2],2);
await as('authenticated',A);await teacher('start',sid);await as('anon');await play(tokens[0],'hint',t.id,null,crypto.randomUUID());assert.deepEqual((await play(tokens[1])).revealedHints,['shared']);
await submit(tokens[0],t,'T');assert.equal((await play(tokens[0])).result,null);await submit(tokens[1],t,'T');const tr=(await play(tokens[0])).result;assert.equal(tr.arrivedAt,(await play(tokens[1])).result.arrivedAt);assert.equal(tr.hintCount,1);assert.equal(tr.rank,1);
assert.equal((await play(tokens[2])).result,null);await submit(tokens[2],t,'T');assert.equal((await play(tokens[2])).result.rank,2);
await as('authenticated',A);d=await dash(sid);assert.equal(d.summary.total,2);assert.equal(d.summary.allComplete,true);
await as('anon');for(const table of ['escape_results','escape_hint_uses','escape_result_archives','escape_reset_receipts']){await assert.rejects(db.query(`select * from public.${table}`),/permission denied/);await assert.rejects(db.query(`delete from public.${table}`),/permission denied/);}
await assert.rejects(finish(sid),/permission denied/);
await as('authenticated',A);await finish(sid,'reset',false);assert.deepEqual(await history(team.id),[]);await db.query('delete from public.escape_contents where id=$1',[team.id]);
// Server ordering and visibility use deterministic values, including equal timestamps.
const ranked=newRoom('순위 조합 검증');const rq=newBlock();rq.answers=['R'];ranked.content=[rq];
sid=(await save(ranked)).sessionId;await as('anon');const a=await join(ranked,tokens[0],1);const b=await join(ranked,tokens[1],2);
await as('authenticated',A);await teacher('start',sid);await as('anon');await submit(tokens[0],rq,'R');await submit(tokens[1],rq,'R');await as('postgres');
await db.query('update public.escape_results set elapsed_ms=1000,wrong_penalty_ms=5000,hint_penalty_ms=1000,final_score=10 where session_id=$1 and $2=any(member_ids)',[sid,a.participantId]);
await db.query('update public.escape_results set elapsed_ms=2000,wrong_penalty_ms=0,hint_penalty_ms=8000,final_score=20 where session_id=$1 and $2=any(member_ids)',[sid,b.participantId]);
for(const [mode,winner] of [['time',a],['score',b],['time_wrong',b],['time_hint',a],['combined',a],['none',a]]){
 await db.query("update public.escape_sessions set content_snapshot=jsonb_set(content_snapshot,'{rules,ranking}',to_jsonb($2::text)) where id=$1",[sid,mode]);
 const board=await call('select escape_private.result_board($1) result',[sid]);assert.ok(board[0].memberIds.includes(winner.participantId));assert.equal(board[0].rank,mode==='none'?null:1);
}
await db.query("update public.escape_sessions set content_snapshot=jsonb_set(jsonb_set(content_snapshot,'{rules,ranking}','\"time\"'),'{rules,rankVisibility}','\"teacher\"') where id=$1",[sid]);
await as('anon');assert.equal((await play(tokens[0])).rankVisible,false);assert.deepEqual((await play(tokens[0])).leaderboard,[]);
await as('authenticated',A);await finish(sid);await as('anon');assert.equal((await play(tokens[0])).result.rank,undefined);
await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[ranked.id]);

// A designated final block may finish before later content. Paused duration stays excluded.
const finalRoom=newRoom('최종 조건과 일시정지');const fq=newBlock();fq.answers=['F'];const later=newBlock();later.answers=['L'];finalRoom.content=[fq,later];Object.assign(finalRoom.rules,{finishMode:'final',finalBlockId:fq.id});
sid=(await save(finalRoom)).sessionId;await as('anon');const fp=await join(finalRoom,tokens[0],1);await join(finalRoom,tokens[1],2);await as('authenticated',A);await teacher('start',sid);
await as('postgres');await db.query("update public.escape_sessions set started_at=now()-interval '60 seconds',paused_ms=20000 where id=$1",[sid]);
await as('anon');await submit(tokens[0],fq,'F');const fr=(await play(tokens[0])).result;assert.ok(fr.elapsedMs>=40000&&fr.elapsedMs<42000);assert.equal(fr.pausedMs,20000);
await as('authenticated',A);await finish(sid,'reset',true);const archived=(await history(finalRoom.id))[0].summary;assert.equal(archived.completed,1);assert.equal(archived.unfinished.length,1);assert.equal(archived.allComplete,false);
await db.query('delete from public.escape_contents where id=$1',[finalRoom.id]);
await as('postgres');for(const table of ['escape_sessions','escape_participants','escape_events','escape_hint_uses','escape_results','escape_result_archives','escape_reset_receipts'])assert.equal((await db.query(`select count(*) n from public.${table}`)).rows[0].n,0);
await db.close();console.log('PASS: individual/team immutable arrival, all-member team condition, hint quotas/sharing, penalties, ranking visibility, completion lock, archive/reset idempotency, same-code new class isolation, owner/anon RLS and cleanup');
