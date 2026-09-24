// Disposable teacher-controls fixture only. Reserves student 12-99-990 in team 2.
import assert from 'node:assert/strict';
import { SupabaseRepository } from '../src/data/supabase.js';
import { SUPABASE_CONFIG } from '../src/config.js';
import { makeRecoveryToken } from '../src/data/lobby.js';
const code=process.argv[2];if(!/^\d{6}$/.test(code||''))throw Error('Pass disposable fixture code');
const repo=new SupabaseRepository(SUPABASE_CONFIG,{storage:null});
const rpc=(name,body)=>repo.request('/rest/v1/rpc/'+name,{method:'POST',auth:false,body});
const token=makeRecoveryToken(),wait=ms=>new Promise(r=>setTimeout(r,ms));
const read=()=>rpc('escape_student_play',{p_token:token});
const actor=await rpc('escape_join_lobby',{p_code:code,p_token:token,p_grade:12,p_class:99,p_number:990,p_name:'제어API검증'});
await rpc('escape_student_lobby',{p_token:token,p_action:'team',p_team:2});
for(const table of ['escape_progress_overrides','escape_teacher_actions'])await assert.rejects(repo.request('/rest/v1/'+table+'?select=*&limit=1',{auth:false}),e=>e.code==='42501');
await assert.rejects(rpc('escape_teacher_control',{p_session:actor.sessionId,p_action:'complete',p_scope:'student',p_participant:actor.participantId,p_revision:0,p_request:crypto.randomUUID()}),e=>e.code==='42501');
console.log('READY: management RPC and direct table access denied to student/anon; team 2 joined. Start then pause with teacher.');
let first,paused,deadline=Date.now()+600000;
while(Date.now()<deadline){const v=await read();if(v.status==='playing'&&v.current)first=v;if(v.status==='paused'){paused=v;break;}await wait(500);}
assert.ok(first&&paused,'Need start followed by pause');
await assert.rejects(rpc('escape_student_play',{p_token:token,p_action:'submit',p_block:first.current.id,p_input:null,p_request:crypto.randomUUID()}),/진행 중/);
await assert.rejects(rpc('escape_student_play',{p_token:token,p_action:'select',p_block:first.current.id}),/진행 중/);
await assert.rejects(rpc('escape_student_lobby',{p_token:token,p_action:'team',p_team:1}),/게임 시작 후/);
assert.equal(paused.current,null);await wait(1500);const still=await read();assert.equal(still.status,'paused');assert.equal(still.timing.elapsedMs,paused.timing.elapsedMs);
console.log('PASS: paused server rejects submit/select/team, hides current content, effective elapsed clock frozen. Resume with teacher.');
deadline=Date.now()+600000;let resumed;
while(Date.now()<deadline){const v=await read();if(v.status==='playing'){resumed=v;break;}await wait(500);}
assert.ok(resumed);assert.equal(resumed.current.id,first.current.id);
assert.ok(resumed.timing.pausedMs>1500);assert.ok(resumed.timing.elapsedMs-paused.timing.elapsedMs<3000);
console.log('PASS: resume kept current position; paused duration excluded:',resumed.timing.pausedMs,'ms. Waiting for cleanup.');
deadline=Date.now()+1200000;
while(Date.now()<deadline){try{await read();}catch(e){if(e.code==='42501'&&e.message.includes('참가 기록')){console.log('PASS: old participant rejected after fixture cleanup.');process.exit(0);}throw e;}await wait(2000);}
throw Error('Fixture still exists; owner cleanup required.');
