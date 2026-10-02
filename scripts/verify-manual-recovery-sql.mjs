import {normalizeStages} from '../src/core/stages.js';
process.on('uncaughtException',e=>{console.error(e.message,e.where||'');process.exit(1);});
import assert from 'node:assert/strict';import {sqlFixture} from './sql-fixture.mjs';
import {newRoom,newBlock,ensureBlockQr,normalizeRoom} from '../src/core/model.js';import {newQr} from '../src/core/qr.js';import {createParallel} from '../src/core/parallel.js';
const {db,teachers,query,rpc}=await sqlFixture();const tokens=Array.from({length:8},(_,i)=>(i+1).toString(16).repeat(64));let cases=0;
const teacher=(action,id)=>rpc('escape_teacher_lobby',{p_action:action,p_id:id},'authenticated');
const join=(r,i,token=tokens[i],name='학생'+i)=>rpc('escape_join_lobby',{p_code:r.roomCode,p_token:token,p_grade:2,p_class:1,p_number:i+1,p_name:name});
const play=(token,action='read',block=null,input=null)=>rpc('escape_student_play',{p_token:token,p_action:action,p_block:block,p_input:input,p_request:crypto.randomUUID()});
const save=async r=>{normalizeStages(r);await query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[r.id,teachers[0],r.roomCode,r.title,r],'authenticated');return (await teacher('open',r.id)).sessionId;};
const clean=r=>query('delete from public.escape_contents where id=$1',[r.id],'authenticated');
const team=(token,n=1)=>rpc('escape_student_lobby',{p_token:token,p_action:'team',p_team:n});
const scan=(token,b,q,manual)=>rpc(manual?'escape_answer_qr_manual':'escape_answer_qr',{p_token:token,p_block:b.id,...(manual?{p_code:q.manualCode.toLowerCase()}:{p_qr:q.token})});
const dash=sid=>rpc('escape_teacher_progress',{p_session:sid},'authenticated');
const control=async(sid,action,extra={})=>rpc('escape_teacher_control',{p_session:sid,p_action:action,p_scope:'team',p_team:1,p_revision:(await dash(sid)).revision,p_request:crypto.randomUUID(),...extra},'authenticated');
try{
 for(const mode of ['ANY','ALL','N_OF_M','UNIQUE_MEMBER'])for(const manual of [false,true]){
  const r=normalizeRoom(newRoom());r.playMode='team';const b=newBlock();b.questionType='qr';b.qrScope='team';r.content=[b,newBlock('guide')];const m=ensureBlockQr(r,b);m.mode=mode;m.count=2;m.codes=[newQr(),newQr(),newQr()];const sid=await save(r);for(let i=0;i<2;i++){await join(r,i);await team(tokens[i]);}await teacher('start',sid);
  assert(!JSON.stringify(await play(tokens[0])).includes(m.codes[0].manualCode));assert(!JSON.stringify(await play(tokens[0])).includes(m.codes[0].token));
  const before=(await query('select count(*) n from public.escape_events where session_id=$1',[sid],'postgres')).rows[0].n;assert((await rpc('escape_answer_qr_manual',{p_token:tokens[0],p_block:b.id,p_code:'AAAAAA'})).error);assert.equal((await query('select count(*) n from public.escape_events where session_id=$1',[sid],'postgres')).rows[0].n,before);
  await scan(tokens[0],b,m.codes[0],manual);
  if(mode==='UNIQUE_MEMBER'){await assert.rejects(scan(tokens[0],b,m.codes[1],manual),/이미 QR/);await assert.rejects(scan(tokens[1],b,m.codes[0],manual),/이미/);await scan(tokens[1],b,m.codes[1],manual);}
  else if(mode!=='ANY'){await scan(tokens[0],b,m.codes[0],manual);await scan(tokens[0],b,m.codes[1],manual);if(mode==='ALL')await scan(tokens[0],b,m.codes[2],manual);}
  assert.equal((await play(tokens[1])).current.id,r.content[1].id);await control(sid,'move',{p_block:b.id});assert.equal((await play(tokens[0])).current.id,b.id);await scan(tokens[0],b,m.codes[0],manual);await clean(r);cases++;
 }
 // Backfill: missing or duplicate manual codes become stable while token bytes stay intact.
 {
  const r=newRoom(),b=newBlock();b.questionType='qr';r.content=[b];const m=ensureBlockQr(r,b);delete m.codes[0].manualCode;const original=m.codes[0].token;await save(r);let stored=(await query('select document from public.escape_contents where id=$1',[r.id],'authenticated')).rows[0].document;assert.match(stored.qrMissions[0].codes[0].manualCode,/^[A-HJ-NP-Z2-9]{6}$/);assert.equal(stored.qrMissions[0].codes[0].token,original);await query('update public.escape_contents set document=$2 where id=$1',[r.id,r],'authenticated');assert.deepEqual((await query('select document from public.escape_contents where id=$1',[r.id],'authenticated')).rows[0].document.qrMissions,stored.qrMissions);await clean(r);cases++;
 }
 // AND/OR manual+camera requests follow the same lane/closure transaction.
 for(const mode of ['AND','OR']){
  const r=normalizeRoom(newRoom());r.playMode='team';Object.assign(r.teamSettings,{rolesEnabled:true,roleViewsEnabled:true,roles:['A','B']});r.content=[];const g=createParallel(r,r.stageGroups[0].id,newBlock);g.mode=mode;const blocks=[...r.content];for(const b of blocks){b.type='question';b.questionType='qr';b.qrScope='team';ensureBlockQr(r,b);}r.content.push(newBlock('guide'));const sid=await save(r);for(let i=0;i<2;i++){await join(r,i);await team(tokens[i]);}await teacher('start',sid);await Promise.all(blocks.map((b,i)=>scan(tokens[i],b,r.qrMissions[i].codes[0],i===0)));assert.equal((await play(tokens[1])).current.id,r.content[2].id);const claims=(await query('select count(*) n from public.escape_qr_scans where session_id=$1',[sid],'postgres')).rows[0].n;assert.equal(claims,mode==='OR'?1:2);assert.equal((await query('select count(*) n from escape_private.parallel_closures where session_id=$1 and retired_at is null',[sid],'postgres')).rows[0].n,1);await scan(tokens[1],blocks[1],r.qrMissions[1].codes[0],true);assert.equal((await query('select count(*) n from public.escape_qr_scans where session_id=$1',[sid],'postgres')).rows[0].n,claims);await clean(r);cases++;
 }
 // Recovery preserves every current state field and invalidates every old-token RPC family.
 {
  const r=normalizeRoom(newRoom());r.playMode='team';const b=newBlock();b.answers=['yes'];b.hints=['hint'];r.content=[b,newBlock('guide')];const sid=await save(r);const joined=await Promise.all([join(r,0),join(r,0)]);assert.equal(joined[0].participantId,joined[1].participantId);await team(tokens[0]);await teacher('start',sid);await play(tokens[0],'submit',b.id,'wrong');await play(tokens[0],'hint',b.id);const before=await play(tokens[0]);const conflict=await join(r,0,tokens[2]);assert(conflict.requiresRecovery);await assert.rejects(join(r,0,tokens[3],'다른 이름'),/이미 있습니다/);
  const recovered=await rpc('escape_recover_participant',{p_code:r.roomCode,p_token:tokens[2],p_challenge:conflict.challenge});assert.equal(recovered.participantId,joined[0].participantId);const after=await play(tokens[2]);assert.deepEqual(after.progress,before.progress);assert.deepEqual(after.revealedHints,before.revealedHints);assert.equal(recovered.participants.length,1);
  for(const name of ['escape_student_play','escape_student_lobby','escape_chat'])await assert.rejects(rpc(name,{p_token:tokens[0]}),/참가 기록/);
  assert.equal((await rpc('escape_recover_participant',{p_code:r.roomCode,p_token:tokens[2],p_challenge:conflict.challenge})).participantId,recovered.participantId);
  const c1=await join(r,0,tokens[3]),c2=await join(r,0,tokens[4]);await rpc('escape_recover_participant',{p_code:r.roomCode,p_token:tokens[3],p_challenge:c1.challenge});await assert.rejects(rpc('escape_recover_participant',{p_code:r.roomCode,p_token:tokens[4],p_challenge:c2.challenge}),/복구/);await clean(r);cases++;
 }
 // Explicit leave is not recovery; a reset is a separate session with no old participant.
 {
  const r=normalizeRoom(newRoom());const sid=await save(r);const old=await join(r,0);await rpc('escape_student_lobby',{p_token:tokens[0],p_action:'leave'});const next=await join(r,0,tokens[1]);assert(!next.requiresRecovery);assert.notEqual(next.participantId,old.participantId);await teacher('start',sid);await rpc('escape_finish_reset',{p_session:sid,p_action:'reset',p_keep:true,p_request:crypto.randomUUID(),p_confirm:true},'authenticated');const fresh=await join(r,0,tokens[2]);assert.notEqual(fresh.sessionId,sid);assert.equal(fresh.participants.length,1);await clean(r);cases++;
 }
 // Two new devices with the same identity still insert exactly one active row.
 {
  const r=normalizeRoom(newRoom());await save(r);const results=await Promise.all([join(r,0,tokens[0]),join(r,0,tokens[1])]);assert.equal(results.filter(x=>x.requiresRecovery).length,1);assert.equal((await query('select count(*) n from public.escape_participants where left_at is null',[],'postgres')).rows[0].n,1);await clean(r);cases++;
 }
 // A finished session is not a recovery target, including when its old token is still stored.
 {
  const r=normalizeRoom(newRoom());const sid=await save(r),old=await join(r,0);await teacher('start',sid);await rpc('escape_finish_reset',{p_session:sid,p_action:'finish',p_keep:true,p_request:crypto.randomUUID(),p_confirm:true},'authenticated');await teacher('open',r.id);const next=await join(r,0);assert(!next.requiresRecovery);assert.notEqual(next.participantId,old.participantId);assert.notEqual(next.sessionId,sid);await clean(r);cases++;
 }
 // Completed departures remain in results under 016, but are never recovered by name.
 {
  const r=normalizeRoom(newRoom()),sid=await save(r);await join(r,0);await teacher('start',sid);await play(tokens[0],'submit',r.content[0].id);await rpc('escape_student_lobby',{p_token:tokens[0],p_action:'leave'});await assert.rejects(join(r,0,tokens[1]),/이미 있습니다/);await assert.rejects(play(tokens[0]),/참가 기록/);assert.equal((await dash(sid)).summary.completed,1);await clean(r);cases++;
 }
 // Bad manual entry is bounded and adds no game events, claims or completion.
 {
  const r=normalizeRoom(newRoom()),b=newBlock();b.questionType='qr';r.content=[b];ensureBlockQr(r,b);const sid=await save(r);await join(r,0);await teacher('start',sid);for(let i=0;i<30;i++)assert.equal((await rpc('escape_answer_qr_manual',{p_token:tokens[0],p_block:b.id,p_code:'?'})).error,'코드를 확인해주세요.');assert.match((await rpc('escape_answer_qr_manual',{p_token:tokens[0],p_block:b.id,p_code:'?'})).error,/기다린/);assert.equal((await query('select count(*) n from public.escape_events where session_id=$1',[sid],'postgres')).rows[0].n,0);await clean(r);cases++;
 }
 await assert.rejects(query('select * from escape_private.participant_recovery_challenges'),/permission denied/);await assert.rejects(query('select * from escape_private.manual_qr_attempts'),/permission denied/);assert.equal((await query('select count(*) n from public.escape_contents',[],'postgres')).rows[0].n,0);console.log(`PASS 017/018: ${cases} SQL scenarios, QR camera/manual parity, AND/OR no-op, rewind, recovery/rotation/identity races, leave/reset, private access and cleanup`);
}finally{await db.close();}
