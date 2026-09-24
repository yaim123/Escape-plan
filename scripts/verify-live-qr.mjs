// Disposable QR test room only; never uses teacher credentials.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {SupabaseRepository} from '../src/data/supabase.js';import {SUPABASE_CONFIG} from '../src/config.js';import {makeRecoveryToken} from '../src/data/lobby.js';
const code=process.argv[2],content=process.argv[3];assert.match(code||'',/^\d{6}$/);assert.match(content||'',/^[a-f0-9-]{36}$/);
const ids=JSON.parse(await readFile('artifacts/qr/live-tokens.json','utf8'));const repo=new SupabaseRepository(SUPABASE_CONFIG,{storage:null});
const rpc=(name,body)=>repo.request('/rest/v1/rpc/'+name,{method:'POST',body,auth:false});
const tokens=[makeRecoveryToken(),makeRecoveryToken()];let session;
for(const [i,t] of tokens.entries()){session=(await rpc('escape_join_lobby',{p_code:code,p_token:t,p_grade:12,p_class:99,p_number:990+i,p_name:'QR API '+i})).sessionId;await rpc('escape_student_lobby',{p_token:t,p_action:'team',p_team:2});}
const read=(i=0)=>rpc('escape_student_play',{p_token:tokens[i]});const scan=(i,q)=>rpc('escape_scan_qr',{p_token:tokens[i],p_qr:q});
await assert.rejects(repo.request('/rest/v1/escape_qr_scans?session_id=eq.'+session,{auth:false}),e=>e.code==='42501');
for(const method of ['PATCH','DELETE'])await assert.rejects(repo.request('/rest/v1/escape_contents?id=eq.'+content,{auth:false,method,...(method==='PATCH'?{body:{document:{qrMissions:[]}}}:{})}),e=>e.code==='42501');
await assert.rejects(repo.request('/rest/v1/escape_qr_scans?session_id=eq.'+session,{auth:false,method:'DELETE'}),e=>e.code==='42501');
console.log('READY: two API participants team 2. Anonymous QR config and claim management denied.');
for(let deadline=Date.now()+1200000;Date.now()<deadline;){if((await read()).status==='playing')break;await new Promise(r=>setTimeout(r,1000));}
const foreign='09ad5e694cee3c653bc051a6d071ab4fab41a62ed022fe2c6cc94dee4655f574';await assert.rejects(scan(0,foreign),e=>e.code==='42501');
for(let m=0;m<4;m++){
 await scan(0,ids[m*3]);assert.equal((await scan(1,ids[m*3])).duplicate,true);let v=await read(1);assert.equal(v.qr[m].found,1);assert.equal(v.qr[m].done,m===0);
 if(m>0){await scan(0,ids[m*3+1]);v=await read(1);assert.equal(v.qr[m].done,m===2);}
 if(m===1)await scan(0,ids[m*3+2]);if(m===3){assert.equal((await read()).current,null);await scan(1,ids[m*3+2]);}
 assert.equal((await read()).qr[m].done,true);
}
const v=await read();assert.equal(v.current.title,'QR 협동 완료');for(const token of ids)assert.ok(!JSON.stringify(v).includes(token));
console.log('PASS: live ANY/ALL/N_OF_M/UNIQUE_MEMBER, duplicate and foreign QR denial, team shared progress, gated story unlocked, no QR capability disclosure.');
for(let deadline=Date.now()+1200000;Date.now()<deadline;){try{await read();}catch(e){if(e.code==='42501'&&e.message.includes('참가 기록')){console.log('PASS: QR participants revoked on cleanup/reset.');process.exit(0);}throw e;}await new Promise(r=>setTimeout(r,1500));}throw Error('Cleanup timeout');
