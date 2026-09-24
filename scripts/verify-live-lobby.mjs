// Only use with a disposable teacher-created fixture, 3 teams, maxMembers=1.
// Reserves test student numbers 990/991 and team 2. Creates two test participants.
// Delete the fixture content with its owner afterward to cascade-clean records.
import assert from 'node:assert/strict';
import { SupabaseRepository } from '../src/data/supabase.js';
import { SUPABASE_CONFIG } from '../src/config.js';
import { makeRecoveryToken } from '../src/data/lobby.js';
const code=process.argv[2]; if(!/^\d{6}$/.test(code||'')) throw Error('Pass the disposable fixture room code');
const repo=new SupabaseRepository(SUPABASE_CONFIG,{storage:null});
const rpc=(name,body)=>repo.request('/rest/v1/rpc/'+name,{method:'POST',auth:false,body});
const tokens=[makeRecoveryToken(),makeRecoveryToken()];
const join=(token,n,c=code)=>rpc('escape_join_lobby',{p_code:c,p_token:token,p_grade:12,p_class:99,p_number:n,p_name:'API검증'+n});
const act=(token,action='read',team=null)=>rpc('escape_student_lobby',{p_token:token,p_action:action,p_team:team});
await assert.rejects(join(makeRecoveryToken(),992,'bad'));
for (const table of ['escape_contents','escape_sessions','escape_participants','escape_events']) {
  await assert.rejects(repo.request('/rest/v1/'+table+'?select=*&limit=1',{auth:false}),e=>e.code==='42501');
}
const states=await Promise.all(tokens.map((t,i)=>join(t,990+i)));
for(const s of states){
  assert.deepEqual(Object.keys(s).sort(),['sessionId','status','startedAt','serverNow','title','playMode','teamCount','maxMembers','topic','participantId','participants'].sort());
  for(const p of s.participants) assert.deepEqual(Object.keys(p).sort(),['id','grade','classroom','number','name','team','lastSeenAt'].sort());
}
const repeat=await join(tokens[0],990); assert.equal(repeat.participantId,states[0].participantId);
await assert.rejects(join(makeRecoveryToken(),990),/이미 참가/);
await assert.rejects(act(makeRecoveryToken()),e=>e.code==='42501');
const race=await Promise.allSettled(tokens.map(t=>act(t,'team',2)));
assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
assert.ok(race.find(x=>x.status==='rejected').reason.message.includes('정원이 찬'));
const winner=race.findIndex(x=>x.status==='fulfilled'), loser=1-winner;
await act(tokens[loser],'leave');
console.log('PASS: anonymous permissions, safe response whitelist, recovery, duplicate identity, concurrent team capacity. READY: start fixture in teacher UI.');
const deadline=Date.now()+180000;
while(Date.now()<deadline){
  const s=await act(tokens[winner]);
  if(s.status==='playing'){
    await assert.rejects(act(tokens[winner],'team',3),/게임 시작 후/);
    await assert.rejects(join(makeRecoveryToken(),992),/신규 입장/);
    assert.ok(s.startedAt);
    assert.equal((await join(tokens[winner],990+winner)).participantId,states[winner].participantId);
    console.log('PASS: server start timestamp, started session recovery, team mutation and new admission blocked after start. Fixture cleanup required.'); process.exit(0);
  }
  await new Promise(r=>setTimeout(r,1500));
}
throw Error('Timed out waiting for teacher start; delete fixture to clean test participants.');
