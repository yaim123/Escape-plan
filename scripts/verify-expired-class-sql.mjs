import assert from 'node:assert/strict';
import {sqlFixture} from './sql-fixture.mjs';
import {newRoom,newBlock,normalizeRoom,ensureBlockQr} from '../src/core/model.js';
import {newChatRoom} from '../src/core/chat.js';
process.on('uncaughtException',e=>{console.error(e.message,e.where||'',e.stack?.split('\n').filter(s=>s.includes('verify-expired')).join('\n'));process.exit(1);});
const {db,teachers,query,rpc}=await sqlFixture();let cases=0;
const admin=(sql,args=[])=>query(sql,args,'postgres');
const teacher=(action,id)=>rpc('escape_teacher_lobby',{p_action:action,p_id:id},'authenticated');
const reset=()=>admin('select escape_private.reset_expired_classes() n');
const play=(token,action='read',block=null,input=null)=>rpc('escape_student_play',{p_token:token,p_action:action,p_block:block,p_input:input,p_request:crypto.randomUUID()});
const age=(sid,started=true,hours=25)=>admin(`update public.escape_sessions set created_at=now()-interval '26 hours',started_at=${started?"now()-($2*interval '1 hour')":'null'} where id=$1`,started?[sid,hours]:[sid]);
const join=(r,token)=>rpc('escape_join_lobby',{p_code:r.roomCode,p_token:token,p_grade:2,p_class:6,p_number:1,p_name:'학생'});
async function create(mode='individual'){
 const r=normalizeRoom(newRoom('자동 초기화 검증'));r.playMode=mode;
 const q=newBlock(),qr=newBlock();q.answers=['ok'];q.hints=['hint'];qr.questionType='qr';qr.qrScope=mode==='team'?'team':'student';r.content=[q,qr,newBlock('guide')];const mission=ensureBlockQr(r,qr);r.chatRooms=[newChatRoom()];q.chatEnabled=true;q.chatRoomIds=[r.chatRooms[0].id];const doc=normalizeRoom(r);Object.assign(r,doc);
 await query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[r.id,teachers[0],r.roomCode,r.title,r],'authenticated');
 const sid=(await teacher('open',r.id)).sessionId,token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');await join(r,token);
 if(mode==='team')await rpc('escape_student_lobby',{p_token:token,p_action:'team',p_team:1});
 return {r,sid,token,q,qr,mission};
}
async function assertClean(f){
 const {r,sid,token}=f;
 const sessions=(await admin('select * from public.escape_sessions where content_id=$1',[r.id])).rows;assert.equal(sessions.length,1);const fresh=sessions[0];assert.notEqual(fresh.id,sid);assert.equal(fresh.status,'lobby');assert.equal(fresh.started_at,null);assert.equal(fresh.ended_at,null);assert.equal(+fresh.progress_revision,0);assert.equal(+fresh.paused_ms,0);
 // All FK descendants of the old class (including private QR/recovery/parallel data) disappear.
 const refs=(await admin(`select n.nspname schema,t.relname name,a.attname column from pg_constraint fk join pg_class t on t.oid=fk.conrelid join pg_namespace n on n.oid=t.relnamespace join pg_attribute a on a.attrelid=t.oid and a.attnum=fk.conkey[1] where fk.contype='f' and fk.confrelid='public.escape_sessions'::regclass`)).rows;
 for(const ref of refs)assert.equal(+(await admin(`select count(*) n from "${ref.schema}"."${ref.name}" where "${ref.column}"=$1`,[sid])).rows[0].n,0,ref.name);
 assert.equal((await query('select document,room_code from public.escape_contents where id=$1',[r.id],'authenticated')).rows[0].room_code,r.roomCode);
 const doc=(await query('select document from public.escape_contents where id=$1',[r.id],'authenticated')).rows[0].document;assert.equal(doc.qrMissions[0].codes[0].token,r.qrMissions[0].codes[0].token);assert.equal(doc.title,r.title);
 assert((await admin('select * from realtime.test_messages where topic=$1 and payload=$2',[f.topic||'',{}])).rows.every(x=>JSON.stringify(x.payload)==='{}'));
 for(const name of ['escape_student_play','escape_student_lobby','escape_chat'])await assert.rejects(rpc(name,{p_token:token}),/참가 기록/);
 const redirected=await teacher('read',sid);assert.equal(redirected.sessionId,fresh.id);assert.equal(redirected.status,'lobby');assert.equal((await rpc('escape_teacher_progress',{p_session:sid},'authenticated')).sessionId,fresh.id);
 await assert.rejects(rpc('escape_teacher_progress',{p_session:sid},'authenticated',teachers[1]),/본인/);await assert.rejects(rpc('escape_teacher_lobby',{p_action:'read',p_id:sid},'authenticated',teachers[1]),/본인/);
 assert.equal((await join(r,token)).sessionId,fresh.id);assert.equal((await teacher('read',fresh.id)).participants.length,1);
}
try{
 const job=(await admin('select * from cron.job')).rows;assert.equal(job.length,1);assert.equal(job[0].schedule,'*/5 * * * *');assert.equal(job[0].command,'select escape_private.reset_expired_classes();');cases++;
 // Seed a real older archived class, then play another team class under the same code.
 const f=await create('team');await teacher('start',f.sid);await play(f.token,'submit',f.q.id,'ok');await rpc('escape_answer_qr_manual',{p_token:f.token,p_block:f.qr.id,p_code:f.mission.codes[0].manualCode});await play(f.token,'submit',f.r.content[2].id);
 await rpc('escape_finish_reset',{p_session:f.sid,p_action:'reset',p_keep:true,p_request:crypto.randomUUID(),p_confirm:true},'authenticated');
 const archive=(await admin('select * from public.escape_result_archives')).rows;
 f.sid=(await join(f.r,f.token)).sessionId;await rpc('escape_student_lobby',{p_token:f.token,p_action:'team',p_team:1});await teacher('start',f.sid);
 const chats=await rpc('escape_chat',{p_token:f.token});await rpc('escape_chat',{p_token:f.token,p_action:'send',p_room:chats.rooms[0].id,p_text:'단서',p_request:crypto.randomUUID()});
 await play(f.token,'submit',f.q.id,'not stored');await play(f.token,'hint',f.q.id);await play(f.token,'submit',f.q.id,'ok');await rpc('escape_answer_qr_manual',{p_token:f.token,p_block:f.qr.id,p_code:f.mission.codes[0].manualCode});
 const dashboard=await rpc('escape_teacher_progress',{p_session:f.sid},'authenticated');await rpc('escape_teacher_control',{p_session:f.sid,p_action:'unlock',p_scope:'team',p_team:1,p_block:f.r.content[2].id,p_revision:dashboard.revision,p_request:crypto.randomUUID()},'authenticated');
 f.topic=(await admin('select lobby_topic from public.escape_sessions where id=$1',[f.sid])).rows[0].lobby_topic;await age(f.sid);assert.equal(+(await reset()).rows[0].n,1);await assertClean(f);assert.deepEqual((await admin('select * from public.escape_result_archives')).rows,archive);assert((await admin('select * from realtime.test_messages where topic=$1',[f.topic])).rows.length>0);cases++;
 for(const status of ['playing-completed','paused','finished','lobby','empty-lobby']){
  const g=await create();if(!['lobby','empty-lobby'].includes(status))await teacher('start',g.sid);
  if(status==='playing-completed'){await play(g.token,'submit',g.q.id,'ok');await rpc('escape_answer_qr',{p_token:g.token,p_block:g.qr.id,p_qr:g.mission.codes[0].token});await play(g.token,'submit',g.r.content[2].id);assert((await play(g.token)).result);}
  if(status==='paused'){const d=await rpc('escape_teacher_progress',{p_session:g.sid},'authenticated');await rpc('escape_teacher_control',{p_session:g.sid,p_action:'pause',p_scope:'session',p_revision:d.revision,p_request:crypto.randomUUID()},'authenticated');}
  if(status==='finished')await rpc('escape_finish_reset',{p_session:g.sid,p_action:'finish',p_confirm:true},'authenticated');
  if(status==='empty-lobby')await admin('delete from public.escape_participants where session_id=$1',[g.sid]);
  await age(g.sid,!['lobby','empty-lobby'].includes(status));assert.equal(+(await reset()).rows[0].n,1);await assertClean(g);cases++;
 }
 // A newly started class in an old lobby is measured from its actual start.
 const fresh=await create();await teacher('start',fresh.sid);await age(fresh.sid,true,1);assert.equal(+(await reset()).rows[0].n,0);assert.equal((await teacher('read',fresh.sid)).status,'playing');cases++;
 // An old finished session must not reset a newer, currently running class.
 const oldFinished=(await admin("insert into public.escape_sessions(content_id,owner_id,content_snapshot,status,created_at,started_at,ended_at) values($1,$2,$3,'finished',now()-interval '26 hours',now()-interval '25 hours',now()-interval '1 hour') returning id",[fresh.r.id,teachers[0],fresh.r])).rows[0].id;
 assert.equal(+(await reset()).rows[0].n,1);assert.equal((await teacher('read',fresh.sid)).status,'playing');const redirected=await rpc('escape_teacher_progress',{p_session:oldFinished},'authenticated');assert.equal(redirected.sessionId,fresh.sid);assert.equal(redirected.status,'playing');assert(redirected.contents);cases++;
 // Database time boundary: just short of 24h is kept, exactly 24h is expired.
 await age(fresh.sid,true,23.999);assert.equal(+(await reset()).rows[0].n,0);
 await db.transaction(async tx=>{await tx.query("update public.escape_sessions set started_at=now()-interval '24 hours' where id=$1",[fresh.sid]);assert.equal(+(await tx.query('select escape_private.reset_expired_classes() n')).rows[0].n,1);});cases++;
 assert.equal(+(await reset()).rows[0].n,0);cases++;
 // Only administrators can run global cleanup; students cannot read reset mapping.
 for(const role of ['anon','authenticated']){await assert.rejects(query('select escape_private.reset_expired_classes()',[],role),/permission denied/);await assert.rejects(query('select * from public.escape_reset_receipts',[],role),/permission denied/);}cases++;
 assert.deepEqual((await admin('select * from public.escape_result_archives')).rows,archive);await admin('delete from public.escape_contents');assert.equal(+(await admin('select count(*) n from public.escape_participants')).rows[0].n,0);
 console.log(`PASS 019: ${cases} SQL scenarios: server schedule, 24h boundary, active/paused/completed/finished/lobby reset, cascades, retained archives/content/code/QR, owner redirect, same-code admission, retry/security/cleanup. Cron worker itself requires hosted pg_cron.`);
}finally{await db.close();}
