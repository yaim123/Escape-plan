// Disposable phase-006 fixture only. Public key, no teacher credentials.
import assert from 'node:assert/strict';
import {SupabaseRepository} from '../src/data/supabase.js';
import {SUPABASE_CONFIG} from '../src/config.js';
import {makeRecoveryToken} from '../src/data/lobby.js';
const code=process.argv[2];assert.match(code||'',/^\d{6}$/);
const repo=new SupabaseRepository(SUPABASE_CONFIG,{storage:null});
const rpc=(name,body)=>repo.request('/rest/v1/rpc/'+name,{method:'POST',body,auth:false});
const token=makeRecoveryToken();const read=()=>rpc('escape_student_play',{p_token:token});
const p=await rpc('escape_join_lobby',{p_code:code,p_token:token,p_grade:12,p_class:99,p_number:990,p_name:'결과API검증'});
await rpc('escape_student_lobby',{p_token:token,p_action:'team',p_team:1});
for(const table of ['escape_results','escape_hint_uses','escape_result_archives','escape_reset_receipts']){
 const filter=['escape_results','escape_hint_uses'].includes(table)?'session_id=eq.'+p.sessionId:'content_id=eq.'+crypto.randomUUID();
 for(const method of ['GET','PATCH','DELETE'])await assert.rejects(repo.request('/rest/v1/'+table+'?'+filter,{auth:false,method,...(method==='PATCH'?{body:{}}:{})}),e=>e.code==='42501');
}
await assert.rejects(rpc('escape_finish_reset',{p_session:p.sessionId,p_action:'reset',p_keep:false,p_confirm:true,p_request:crypto.randomUUID()}),e=>e.code==='42501');
console.log('READY: API student joined team 1. Direct table mutation and teacher reset denied. Start class.');
const until=async predicate=>{const deadline=Date.now()+1200000;while(Date.now()<deadline){const v=await read();if(predicate(v))return v;await new Promise(r=>setTimeout(r,1000));}throw Error('Teacher action timeout');};
const g=await until(v=>v.status==='playing'&&v.current);assert.ok(!JSON.stringify(g).includes('"answers"'));assert.ok(!JSON.stringify(g).includes('"recovery_hash"'));
await rpc('escape_student_play',{p_token:token,p_action:'submit',p_block:g.current.id,p_input:'열쇠',p_request:crypto.randomUUID()});
console.log('PASS: API member submitted. Team must wait for browser member A.');
const done=await until(v=>v.result);const fixed=done.result;
await assert.rejects(rpc('escape_student_play',{p_token:token,p_action:'submit',p_block:g.current.id,p_input:'열쇠',p_request:crypto.randomUUID()}),/탈출을 완료/);
await assert.rejects(rpc('escape_student_play',{p_token:token,p_action:'hint',p_block:g.current.id,p_request:crypto.randomUUID()}),/탈출을 완료/);
assert.equal((await read()).result.arrivedAt,fixed.arrivedAt);console.log('PASS: team arrival fixed, completed submissions/hints rejected.',JSON.stringify({arrivedAt:fixed.arrivedAt,elapsedMs:fixed.elapsedMs,pausedMs:fixed.pausedMs,hintCount:fixed.hintCount}));
for(let end=Date.now()+1200000;Date.now()<end;){try{await read();}catch(e){if(e.code==='42501'&&e.message.includes('참가 기록')){console.log('PASS: old token revoked after reset/cleanup.');process.exit(0);}throw e;}await new Promise(r=>setTimeout(r,1500));}throw Error('Cleanup not observed');
