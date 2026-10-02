// node scripts/load-30.mjs [--staging] --report=artifacts/load-30.json
// Promise batches issue concurrent requests; local PGlite serializes database transactions.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {newRoom,newBlock,normalizeRoom,ensureBlockQr,inspectForPlay} from '../src/core/model.js';
import {newQr} from '../src/core/qr.js';
import {createParallel} from '../src/core/parallel.js';
import {newChatRoom} from '../src/core/chat.js';
import {normalizeStages} from '../src/core/stages.js';
import {loadBackend} from './load-backend.mjs';
process.on('uncaughtException',e=>{console.error(e.message,e.where||'',e.stack?.split('\n').filter(x=>x.includes('load-30')).join('\n'));process.exit(1);});
if(process.argv.slice(2).some(a=>a!=='--staging'&&!a.startsWith('--report=')))throw Error('Unknown argument (no target URL is accepted on the command line).');
const backend=await loadBackend(process.argv.includes('--staging')),metrics=[],checks=[],created=[];
const report={backend:backend.kind,simulatedUsers:30,realRealtimeLatencyMs:null,privateDatabaseAudit:!!backend.query};
const token=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
async function rpc(name,args={},teacher=false,expectedError){
 const start=performance.now();let status='success';
 try{const value=await backend.rpc(name,args,teacher?'authenticated':'anon');if(value?.error)throw Error(value.error);if(expectedError instanceof RegExp)throw Error('Expected rejection was accepted: '+name);return value;}
 catch(e){if(expectedError&&(expectedError.pattern||expectedError).test(e.message)){status='expected rejection';return {rejected:true};}status='failure';throw e;}
 finally{metrics.push({name,status,ms:performance.now()-start});}
}
const check=label=>{checks.push(label);console.log('PASS '+label);};
const callTeacher=(action,id)=>rpc('escape_teacher_lobby',{p_action:action,p_id:id},true);
const join=(r,a,expectedError)=>rpc('escape_join_lobby',{p_code:r.roomCode,p_token:a.token,p_grade:2,p_class:6,p_number:a.number,p_name:a.name},false,expectedError);
const play=(a,action='read',b=null,input=null,request=crypto.randomUUID(),expectedError)=>rpc('escape_student_play',{p_token:a.token,p_action:action,p_block:b?.id||null,p_input:input,p_request:request},false,expectedError);
const scan=(a,b,q,manual=false,expectedError)=>rpc(manual?'escape_answer_qr_manual':'escape_answer_qr',{p_token:a.token,p_block:b.id,...manual?{p_code:q.manualCode}:{p_qr:q.token}},false,expectedError);
const dash=sid=>rpc('escape_teacher_progress',{p_session:sid},true);
const chat=(a,action='list',room=null,text=null,request=crypto.randomUUID(),expectedError)=>rpc('escape_chat',{p_token:a.token,p_action:action,p_room:room,p_text:text,p_request:request},false,expectedError);
const finish=(sid,keep)=>rpc('escape_finish_reset',{p_session:sid,p_action:'reset',p_keep:keep,p_confirm:true,p_request:crypto.randomUUID()},true);
const history=r=>rpc('escape_result_history',{p_content:r.id},true);
const team=(a,n)=>rpc('escape_student_lobby',{p_token:a.token,p_action:'team',p_team:n});
const control=(sid,action,revision,extra={},expectedError)=>rpc('escape_teacher_control',{p_session:sid,p_action:action,p_scope:'team',p_team:1,p_revision:revision,p_request:crypto.randomUUID(),...extra},true,expectedError);
const sql=async(text,args=[])=>backend.query?(await backend.query(text,args,'postgres')).rows:null;
const scalar=async(text,args)=>+(await sql(text,args))?.[0]?.n;
const save=async r=>{normalizeStages(r);assert.deepEqual(inspectForPlay(r).errors,[]);created.push(r);await backend.create(r);return(await callTeacher('open',r.id)).sessionId;};
function question(title){const b=newBlock();b.title=title;b.answers=['ok'];b.hints=['읽어보세요'];return b;}
try{
 const r=normalizeRoom(newRoom('[LOAD TEST] 30 users '+Date.now()));r.playMode='team';Object.assign(r.teamSettings,{teamCount:6,maxMembers:5,rolesEnabled:true,roleViewsEnabled:true,roles:['A','A','A','B','B']});r.rules.scoreEnabled=true;
 const q1=question('공통 문제 1'),q2=question('공통 문제 2'),unique=question('다섯 QR');unique.questionType='qr';unique.qrScope='team';r.content=[q1,q2,unique];
 const mission=ensureBlockQr(r,unique);mission.mode='UNIQUE_MEMBER';mission.codes=Array.from({length:5},newQr);
 const and=createParallel(r,r.stageGroups[0].id,newBlock),andBlocks=r.content.filter(b=>and.steps[0].cells.some(c=>c.blockId===b.id));for(const b of andBlocks){b.type='question';b.answers=['ok'];}
 const common=newBlock('story');common.title='공통 합류';r.content.push(common);
 const or=createParallel(r,r.stageGroups[0].id,newBlock);or.mode='OR';const orBlocks=r.content.filter(b=>or.steps[0].cells.some(c=>c.blockId===b.id));for(const b of orBlocks){b.type='question';b.questionType='qr';b.qrScope='team';ensureBlockQr(r,b);}
 const last=newBlock('guide');last.title='도착';r.content.push(last);
 r.chatRooms=[{...newChatRoom(),name:'팀'},{...newChatRoom(),name:'A 역할',scope:'roles',roles:['A']}];for(const b of r.content){b.chatEnabled=true;b.chatRoomIds=r.chatRooms.map(c=>c.id);b.stageId=r.stageGroups[0].id;}
 const sid=await save(r),actors=Array.from({length:30},(_,i)=>({number:i+1,name:'가상학생'+(i+1),token:token(),team:Math.floor(i/5)+1}));
 const joined=await Promise.all(actors.map(a=>join(r,a)));joined.forEach((p,i)=>actors[i].id=p.participantId);assert.equal(new Set(actors.map(a=>a.id)).size,30);assert.equal((await dash(sid)).participants.length,30);
 const repeats=await Promise.all([join(r,actors[0]),join(r,actors[0])]);assert(repeats.every(s=>s.participantId===actors[0].id));const duplicate={...actors[0],token:token()};assert((await join(r,duplicate)).requiresRecovery);await join(r,{...duplicate,name:'다른 이름'},/이미 있습니다/);
 await Promise.all(actors.map(a=>team(a,a.team)));await callTeacher('start',sid);const initial=await dash(sid);assert.equal(initial.participants.length,30);actors.forEach(a=>a.role=initial.participants.find(p=>p.id===a.id).role);
 const teams=Array.from({length:6},(_,i)=>actors.filter(a=>a.team===i+1)),lane=(t,i)=>t.find(a=>a.role===['A','B'][i]);check('30 concurrent joins, identity retries: exactly 30; six full teams and roles');
 const lists=await Promise.all(actors.map(a=>chat(a)));lists.forEach((s,i)=>{actors[i].chat=s.rooms.find(c=>c.name==='팀').id;actors[i].roleChat=s.rooms.find(c=>c.name==='A 역할')?.id;});assert.equal(new Set(actors.map(a=>a.chat)).size,6);
 await Promise.all(actors.map(a=>chat(a,'send',a.chat,'team '+a.team)));await Promise.all(actors.filter(a=>a.role==='A').map(a=>chat(a,'send',a.roleChat,'role A team '+a.team)));
 for(const t of teams){const messages=await chat(t[0],'read',t[0].chat);assert.equal(messages.count,5);assert(messages.messages.every(m=>m.text===undefined?m.message==='team '+t[0].team:m.text==='team '+t[0].team));await chat(lane(t,1),'read',lane(t,0).roleChat,null,crypto.randomUUID(),/참여할 수 없는/);}
 await chat(actors[5],'read',actors[0].chat,null,crypto.randomUUID(),/참여할 수 없는/);const chatRequest=crypto.randomUUID();await Promise.all([chat(actors[0],'send',actors[0].chat,'retry',chatRequest),chat(actors[0],'send',actors[0].chat,'retry',chatRequest)]);assert.equal((await chat(actors[0],'read',actors[0].chat)).count,6);check('30 team / 18 role messages, access isolation, identical request deduplication');
 const answerRequest=crypto.randomUUID();await play(actors[0],'submit',q1,'wrong');await play(actors[0],'hint',q1);await Promise.all(teams.slice(0,3).flatMap(t=>t.map(a=>play(a,'submit',q1,'ok',a===actors[0]?answerRequest:crypto.randomUUID()))));
 await Promise.all([...teams.slice(0,3).flatMap(t=>t.map(a=>play(a,'submit',q2,'ok'))),...teams.slice(3).flatMap(t=>t.map(a=>play(a,'submit',q1,'ok')))]);await play(actors[0],'submit',q1,'ok',answerRequest);await Promise.all(teams.slice(3).flatMap(t=>t.map(a=>play(a,'submit',q2,'ok'))));
 // Each shared ANY completion is represented once per team, never once per request.
 if(backend.query){const n=await scalar("select count(*) n from public.escape_events where session_id=$1 and block_id=any($2::uuid[]) and event_type='complete' and retired_at is null",[sid,[q1.id,q2.id]]);report.normalCompletion={expected:12,actual:n};assert.equal(n,12);}
 check('simultaneous same-team / different-block submissions; stable completions and retry');
 await Promise.all(teams.map(t=>scan(t[0],unique,mission.codes[0],true)));await Promise.all(teams.flatMap(t=>[scan(t[0],unique,mission.codes[1],false,/이미 QR/),scan(t[1],unique,mission.codes[0],true,/이미/)]));await Promise.all(teams.flatMap(t=>t.slice(1).map((a,i)=>scan(a,unique,mission.codes[i+1],i%2===0))));
 const qrStates=await Promise.all(actors.map(a=>play(a)));assert(qrStates.every(s=>s.progress.completedIds.includes(unique.id)));if(backend.query)assert.equal(await scalar('select count(*) n from public.escape_qr_scans where session_id=$1 and mission_id=$2 and retired_at is null',[sid,mission.id]),30);check('UNIQUE_MEMBER: 30 claims, one per member, duplicate code/member rejection, independent teams');
 await Promise.all(teams.map(t=>play(lane(t,0),'submit',andBlocks[0],'ok')));const waiting=await play(lane(teams[0],0));assert.equal(waiting.current,null);assert.equal(waiting.waiting.found,1);assert.equal((await play(lane(teams[0],1))).current.id,andBlocks[1].id);
 // Reconnect without polling interval assumptions; new device requires explicit confirmation.
 const recovering=lane(teams[0],0),old={...recovering},priorChat=await chat(recovering);const candidate={...recovering,token:token()},challenge=await join(r,candidate);assert(challenge.requiresRecovery);const restored=await rpc('escape_recover_participant',{p_code:r.roomCode,p_token:candidate.token,p_challenge:challenge.challenge});recovering.token=candidate.token;assert.equal(restored.participantId,old.id);const after=await play(recovering);for(const k of ['progress','waiting','qr','revealedHints'])assert.deepEqual(after[k],waiting[k]);assert.equal((await chat(recovering)).rooms.length,priorChat.rooms.length);await play(old,'read',null,null,crypto.randomUUID(),/참가 기록/);assert.equal((await dash(sid)).participants.length,30);
 await Promise.all(teams.map(t=>play(lane(t,1),'submit',andBlocks[1],'ok')));assert((await Promise.all(actors.map(a=>play(a)))).every(s=>s.current.id===common.id));check('AND waiting/release; recovery retains identity, lane, QR, wrong/hints and chat access');
 await Promise.all(teams.map(t=>play(t[0],'submit',common)));const orCodes=orBlocks.map(b=>r.qrMissions.find(m=>m.blockId===b.id).codes[0]);await Promise.all(teams.flatMap(t=>orBlocks.map((b,i)=>scan(lane(t,i),b,orCodes[i],i===0))));
 const postOr=await Promise.all(actors.map(a=>play(a)));assert(postOr.every(s=>s.current.id===last.id));const doneCounts=postOr.map(s=>s.progress.completedIds.filter(id=>orBlocks.some(b=>b.id===id)).length);assert(doneCounts.every(n=>n<=1));assert(teams.every(t=>new Set(t.flatMap(a=>postOr[actors.indexOf(a)].progress.completedIds.filter(id=>orBlocks.some(b=>b.id===id)))).size===1));
 const scores=postOr.map(s=>s.displayStats.score);await Promise.all(teams.flatMap(t=>orBlocks.map((b,i)=>scan(lane(t,i),b,orCodes[i],i!==0))));assert.deepEqual((await Promise.all(actors.map(a=>play(a)))).map(s=>s.displayStats.score),scores);
 if(backend.query){assert.equal(await scalar('select count(*) n from escape_private.parallel_closures where session_id=$1 and retired_at is null',[sid]),12);assert.equal(await scalar('select count(*) n from public.escape_qr_scans where session_id=$1 and mission_id<>$2 and retired_at is null',[sid,mission.id]),6);assert.equal(await scalar('select count(*) n from (select event_team,qr_id from public.escape_qr_scans where session_id=$1 and retired_at is null group by event_team,qr_id having count(*)>1) d',[sid]),0);}
 report.parallelClosures={expected:12,actual:backend.query?12:null};check('OR simultaneous camera/manual: one winner, no false completion, no repeated points/claims');
 // Rewind + late request, then student submit racing a teacher move and a team reset.
 await Promise.all([control(sid,'move',(await dash(sid)).revision,{p_block:orBlocks[0].id}),scan(lane(teams[0],1),orBlocks[1],orCodes[1],true)]);
 await control(sid,'move',(await dash(sid)).revision,{p_block:q1.id});
 for(const action of ['move','reset']){
  const revision=(await dash(sid)).revision;
  // Both orderings are valid: stale teacher revision may reject, then retry explicitly.
  await Promise.all([play(teams[0][0],'submit',q1,'ok',crypto.randomUUID(),{pattern:/공개|현재|완료/}),control(sid,action,revision,{p_block:andBlocks[0].id},{pattern:/진행 상태가 바뀌었습니다/})]);
  await control(sid,action,(await dash(sid)).revision,{p_block:andBlocks[0].id});
 }
 if(backend.query){assert.equal(await scalar('select count(*) n from (select participant_id,block_id,event_type from public.escape_events where session_id=$1 and retired_at is null group by participant_id,block_id,event_type having count(*)>1) d',[sid]),0);assert.equal(await scalar('select count(*) n from (select team_number,group_id from escape_private.parallel_closures where session_id=$1 and retired_at is null group by team_number,group_id having count(*)>1) d',[sid]),0);}
 check('teacher rewind / move / reset overlap: safe serialized outcomes and unique active events');
 if(backend.query){const broadcasts=await sql('select count(*) n,count(*) filter(where payload<>\'{}\'::jsonb) leaks from realtime.test_messages');assert.equal(+broadcasts[0].leaks,0);report.realtimeInvalidations=+broadcasts[0].n;}
 report.finalParticipants=(await dash(sid)).participants.length;assert.equal(report.finalParticipants,30);
 await finish(sid,true);const archived=await history(r);assert.equal(archived.length,1);const nextActors=actors.map(a=>({...a,token:token()})),nextJoined=await Promise.all(nextActors.map(a=>join(r,a))),nextSid=nextJoined[0].sessionId;assert.notEqual(nextSid,sid);assert.equal(new Set(nextJoined.map(s=>s.participantId)).size,30);assert(!nextJoined.some(s=>actors.some(a=>a.id===s.participantId)));
 if(backend.query)for(const table of ['escape_participants','escape_events','escape_qr_scans','escape_chat_rooms','escape_teacher_actions'])assert.equal(await scalar(`select count(*) n from public.${table} where session_id=$1`,[sid]),0);
 await Promise.all(nextActors.map(a=>team(a,a.team)));await callTeacher('start',nextSid);assert.equal((await chat(nextActors[0],'read',(await chat(nextActors[0])).rooms.find(c=>c.name==='팀').id)).count,0);assert.equal((await play(nextActors[0])).progress.completedIds.length,0);await finish(nextSid,false);assert.equal((await history(r)).length,1);check('archive/reset with 30, same code next class, fresh identities/chat/progress, delete reset');
 // Individual regression through the same public endpoints and latest migrations.
 const solo=normalizeRoom(newRoom('[LOAD TEST] individual'));const sq=question('개인'),qb=question('개인 QR');qb.questionType='qr';qb.qrScope='student';solo.content=[sq,qb];const qm=ensureBlockQr(solo,qb);const soloSid=await save(solo),sa={number:1,name:'개인',token:token()};await join(solo,sa);await callTeacher('start',soloSid);await play(sa,'submit',sq,'wrong');await play(sa,'hint',sq);await play(sa,'submit',sq,'ok');await scan(sa,qb,qm.codes[0],true);const result=(await play(sa)).result;assert(result);assert.deepEqual((await play(sa)).result,result);await play(sa,'submit',sq,'ok',crypto.randomUUID(),/완료|끝/);check('individual play, wrong/hint, manual QR, stable arrival and post-completion guard');
 report.integrity='PASS';
}finally{
 const cleanupErrors=[];for(const r of created)try{await backend.remove(r);}catch(e){cleanupErrors.push(e.message);}try{await backend.close();}catch(e){cleanupErrors.push(e.message);}
 const times=metrics.map(m=>m.ms).sort((a,b)=>a-b),p=q=>+times[Math.max(0,Math.ceil(times.length*q)-1)]?.toFixed(2),round=n=>+n.toFixed(2);
 Object.assign(report,{checks:checks.length,totalRequests:metrics.length,success:metrics.filter(m=>m.status==='success').length,expectedRejections:metrics.filter(m=>m.status.startsWith('expected')).length,unexpectedFailures:metrics.filter(m=>m.status==='failure').length,latencyMs:{mean:round(times.reduce((a,b)=>a+b,0)/(times.length||1)),p50:p(.5),p95:p(.95),max:p(1)},slowest:metrics.reduce((max,m)=>m.ms>max.ms?{rpc:m.name,ms:round(m.ms)}:max,{ms:0}),cleanup:cleanupErrors.length?cleanupErrors:'created test content removed',note:'RPC latencies include queue time; setup/SQL audit/cleanup excluded. Realtime delivery requires separate integration/device checks.'});
 const path=process.argv.find(a=>a.startsWith('--report='))?.slice(9);if(path){await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report,null,2));
 if(cleanupErrors.length)throw Error('Cleanup requires attention: '+cleanupErrors.join('; '));
}
