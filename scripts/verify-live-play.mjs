// Run only for the disposable 4-block play fixture described in docs/LIVE_PLAY.md.
// Joins team 2 as student 12-99-990. Delete the fixture with its owner afterward.
import assert from 'node:assert/strict';
import { SupabaseRepository } from '../src/data/supabase.js';
import { SUPABASE_CONFIG } from '../src/config.js';
import { makeRecoveryToken } from '../src/data/lobby.js';
const code=process.argv[2];
if(!/^\d{6}$/.test(code||'')) throw Error('Pass the disposable fixture room code');
const repo=new SupabaseRepository(SUPABASE_CONFIG,{storage:null});
const rpc=(name,body)=>repo.request('/rest/v1/rpc/'+name,{method:'POST',auth:false,body});
const token=makeRecoveryToken();
const read=()=>rpc('escape_student_play',{p_token:token});
const submit=(block,input,request=crypto.randomUUID())=>rpc('escape_student_play',{p_token:token,p_action:'submit',p_block:block,p_input:input,p_request:request});
const secret='청록열쇠-729';
function safe(game){
  assert.ok(!JSON.stringify(game).includes(secret));
  if(game.current) assert.deepEqual(Object.keys(game.current).sort(),['id','type','questionType','title','body','stage','display','buttonText','media','options','matchChoices'].sort());
}
for(const table of ['escape_contents','escape_sessions','escape_participants','escape_events','escape_block_progress','escape_submission_receipts']) {
  await assert.rejects(repo.request('/rest/v1/'+table+'?select=*&limit=1',{auth:false}),e=>e.code==='42501');
}
await assert.rejects(rpc('escape_student_play',{p_token:makeRecoveryToken()}),e=>e.code==='42501');
await rpc('escape_join_lobby',{p_code:code,p_token:token,p_grade:12,p_class:99,p_number:990,p_name:'서버플레이검증'});
await rpc('escape_student_lobby',{p_token:token,p_action:'team',p_team:2});
console.log('READY: anonymous table denial passed; team 2 test participant joined. Start the game in the teacher UI.');
let game,deadline=Date.now()+600000;
while(Date.now()<deadline){
  const state=await rpc('escape_student_lobby',{p_token:token,p_action:'touch'});
  if(state.status==='playing'){game=await read();break;}
  await new Promise(r=>setTimeout(r,2000));
}
assert.ok(game,'Teacher start timed out');safe(game);
assert.equal(game.progress.completedCount,0);
game=(await submit(game.current.id,null)).game;safe(game);
assert.equal(game.progress.completedCount,1);
const block=game.current.id,request=crypto.randomUUID();
let result=await submit(block,'의도한 오답',request);
assert.equal(result.outcome,'wrong');assert.equal(result.game.progress.wrongCounts[block],1);
result=await submit(block,'의도한 오답',request);
assert.equal(result.duplicate,true);assert.equal(result.game.progress.wrongCounts[block],1);
game=await read();safe(game);assert.equal(game.current.id,block);
game=(await submit(block,secret)).game;safe(game);assert.equal(game.progress.completedCount,2);
game=(await submit(game.current.id,'소장')).game;safe(game);assert.equal(game.progress.completedCount,3);
game=(await submit(game.current.id,'2413')).game;safe(game);assert.equal(game.progress.completedCount,4);
console.log('PASS: real RPC answer filtering, story/short/choice/cipher, wrong count, replay idempotency, progress recovery, completion. Waiting for fixture cleanup.');
deadline=Date.now()+900000;
while(Date.now()<deadline){
  try{await read();}catch(error){if(error.code==='42501'&&error.message.includes('참가 기록')){console.log('PASS: fixture cleanup verified by former participant token rejection.');process.exit(0);}throw error;}
  await new Promise(r=>setTimeout(r,3000));
}
throw Error('Fixture cleanup not observed; delete the disposable content using its owner.');
