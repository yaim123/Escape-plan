import test from 'node:test';
import assert from 'node:assert/strict';
import { LobbyClient, makeRecoveryToken, codeFromUrl } from '../src/data/lobby.js';
import { watchLobby } from '../src/data/realtime.js';
const storage = () => { const map=new Map(); return { getItem:k=>map.get(k)||null, setItem:(k,v)=>map.set(k,v), removeItem:k=>map.delete(k) }; };
test('student URL supports Pages subpaths, direct codes and QR query parameters', () => {
  assert.equal(codeFromUrl('https://school.test/project/#/join/123456'),'123456');
  assert.equal(codeFromUrl('https://school.test/project/?code=123456'),'123456');
  assert.equal(codeFromUrl('https://school.test/project/#/join?code=123456'),'123456');
  assert.equal(codeFromUrl('https://school.test/?code=bad'),'');
});
test('lost admission response reuses persisted token and student calls never attach teacher auth', async () => {
  const saved=storage(), calls=[]; let failed=true;
  const repo={config:{url:'https://project.test'},request:async(path,opts)=>{ calls.push(opts); if(failed) {failed=false;throw Error('network');} return { participantId:'student',sessionId:'session' }; }};
  const client=new LobbyClient(repo,saved), identity={p_grade:2,p_class:6,p_number:1,p_name:'학생'};
  await assert.rejects(client.join('123456',identity));
  const token=client.saved('123456').token;
  assert.match(token,/^[a-f0-9]{64}$/);
  await new LobbyClient(repo,saved).join('123456',identity);
  await client.student('123456','team',{p_team:2});
  assert.ok(calls.every(c=>c.auth===false && c.body.p_token===token));
  assert.equal(client.saved('123456').participantId,'student');
  assert.equal(new LobbyClient({...repo,config:{url:'https://other.test'}},saved).saved('123456'),null);
  assert.notEqual(makeRecoveryToken(),token);
});
test('storage failure stops admission before any server write', async () => {
  let called=false;
  const client=new LobbyClient({config:{url:'https://p.test'},request:()=>{called=true;}},{getItem:()=>null,setItem:()=>{throw Error('storage');}});
  await assert.rejects(client.join('123456',{}),/storage/); assert.equal(called,false);
});
test('Realtime accepts only matching change signals and refetches after join', () => {
  let ws, changes=0; const statuses=[];
  class FakeSocket { constructor(url){this.url=url;ws=this;this.sent=[];} send(value){this.sent.push(JSON.parse(value));} close(){this.onclose?.();} }
  const stop=watchLobby({url:'https://project.test',key:'public'},'lobby:opaque',()=>changes++,s=>statuses.push(s),FakeSocket);
  try {
    ws.onopen(); assert.equal(ws.sent[0].payload.config.private,false);
    const message=m=>ws.onmessage({data:JSON.stringify(m)});
    message({topic:'realtime:lobby:opaque',event:'phx_reply',ref:'1',payload:{status:'ok'}});
    message({topic:'realtime:lobby:other',event:'broadcast',payload:{event:'changed'}});
    message({topic:'realtime:lobby:opaque',event:'broadcast',payload:{event:'fake',status:'playing'}});
    assert.equal(changes,1);
    message({topic:'realtime:lobby:opaque',event:'broadcast',payload:{event:'changed',status:'playing'}});
    assert.equal(changes,2); assert.ok(statuses.includes('connected'));
  } finally {stop();}
});
