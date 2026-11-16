// Local headless UI fixtures. No remote accounts, production RPCs or student records.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {newRoom,newBlock,normalizeRoom} from '../src/core/model.js';
import {sqlFixture} from './sql-fixture.mjs';
let chromium;try{({chromium}=await import('playwright'));}catch{({chromium}=await import(pathToFileURL(resolve(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'))));}
const root=resolve('.'),server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/fixture'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/experience.css"><main id="view"></main><dialog id="dialog"></dialog><div id="toast" hidden></div>');return;}if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}const file=resolve(root,'.'+path);if(!file.startsWith(root+sep))throw Error();res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'text/plain');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
let browser;const errors=[];let checks=0;
const fixture=await sqlFixture(),{db,teachers,query,rpc}=fixture;
const rooms=[];
try{
 for(const playing of [true,false]){
  const room=normalizeRoom(newRoom(playing?'진행 중 자동 정리':'대기실 자동 정리'));await query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[room.id,teachers[0],room.roomCode,room.title,room],'authenticated');
  const sid=(await rpc('escape_teacher_lobby',{p_action:'open',p_id:room.id},'authenticated')).sessionId,token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');const joined=await rpc('escape_join_lobby',{p_code:room.roomCode,p_token:token,p_grade:2,p_class:6,p_number:1,p_name:'학생'});
  if(playing)await rpc('escape_teacher_lobby',{p_action:'start',p_id:sid},'authenticated');rooms.push({room,sid,token,participantId:joined.participantId});
 }
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
 const teacher=await browser.newPage(),student=await browser.newPage(),waitingStudent=await browser.newPage();
 for(const [index,p] of [teacher,student,waitingStudent].entries()){
  p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/fixture');
  await p.exposeFunction('fixtureRpc',async(name,args)=>{try{return {data:await rpc(name,args,index===0?'authenticated':'anon')};}catch(error){return {error:{message:error.message,code:error.code}};}});
  await p.evaluate(async({index,f,user})=>{
   window.WebSocket=class{constructor(){window.sock=this;}send(){}close(){}};
   window.sqlRpc=async(name,args)=>{const result=await fixtureRpc(name,args);if(result.error)throw Object.assign(new Error(result.error.message),{code:result.error.code});return result.data;};
   window.invalidate=()=>sock?.onmessage?.({data:JSON.stringify({topic:sockTopic,event:'broadcast',payload:{event:'changed'}})});
   // Keep the actual Realtime client; intercept only the transport and record its topic.
   WebSocket.prototype.send=function(text){const frame=JSON.parse(text);if(frame.event==='phx_join')window.sockTopic=frame.topic;};
   window.app={repo:{mode:'cloud',config:{url:'https://fixture.invalid',key:'public'},requireUser:()=>user,get:async()=>({id:f.room.id,room_code:f.room.roomCode,document:f.room}),request:(path,{body})=>sqlRpc(path.split('/').at(-1),body)}};
   const {setConfig}=await import('/src/data/config.js');setConfig('https://fixture.supabase.co','sb_publishable_fixture');
   const {LobbyClient}=await import('/src/data/lobby.js');LobbyClient.prototype.rpc=(name,body)=>sqlRpc(name,body);
   const lobby=await import('/src/ui/lobby.js');
   if(index===0)await lobby.renderTeacherLobby(document.querySelector('#view'),app,f.room.id);
   else {const c=new LobbyClient();localStorage.setItem(c.key(f.room.roomCode),JSON.stringify({token:f.token,participantId:f.participantId,sessionId:f.sid}));await lobby.renderStudentEntry(document.querySelector('#view'),app,f.room.roomCode);}
  },{index,f:rooms[index===2?1:0],user:teachers[0]});
 }
 await teacher.locator('#pause-session').waitFor();await student.locator('#live-answer button').waitFor();await waitingStudent.locator('#lobby-state').waitFor();
 await query("update public.escape_sessions set created_at=now()-interval '25 hours',started_at=case when status='playing' then now()-interval '25 hours' end",[],'postgres');assert.equal(+(await query('select escape_private.reset_expired_classes() n',[],'postgres')).rows[0].n,2);
 for(const p of [teacher,student,waitingStudent])await p.evaluate(()=>window.dispatchEvent(new Event('online')));
 await teacher.locator('#lobby-state').waitFor();assert.match(await teacher.locator('#lobby-state').innerText(),/모두 모이면/);assert.equal(await teacher.locator('#game-progress').count(),0);assert.equal(+(await query('select count(*) n from public.escape_participants',[],'postgres')).rows[0].n,0);await teacher.locator('#entry-qr svg').waitFor();checks++;
 for(const p of [student,waitingStudent]){await p.locator('#student-join').waitFor();assert.equal(await p.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('escape-studio:participant:'))),false);assert.equal(await p.locator('[name=name]').inputValue(),'');checks++;}
 // The original code admits a genuinely fresh participant after cleanup.
 for(const [name,value] of Object.entries({grade:'2',classroom:'6',number:'1',name:'다음 반 학생'}))await student.locator(`[name=${name}]`).fill(value);await student.locator('#student-join button[type=submit]').click();await student.locator('#lobby-state').waitFor();assert.match(await student.locator('#lobby-state').innerText(),/다음 반 학생/);checks++;
 for(const p of [teacher,student,waitingStudent])await p.evaluate(()=>app.cleanup?.());assert.deepEqual(errors,[]);console.log(`PASS 019 UI: ${checks} scenarios using actual local SQL RPCs: teacher lobby + QR return, playing and waiting student credential cleanup, same-code next class, no JS errors`);
}catch(error){console.error('Browser errors:',errors);for(const context of browser?.contexts()||[])for(const p of context.pages())console.error(await p.locator('body').innerText());throw error;}finally{await browser?.close();await new Promise(r=>server.close(r));await db.close();}
