// One isolated headless pass. Uses fixtures/mocked RPCs only, never production accounts or rows.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
let chromium;
try{({chromium}=await import('playwright'));}catch{({chromium}=await import(pathToFileURL(resolve(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'))));}
const root=resolve('.'),server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/fixture'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/experience.css"><main id="view"></main><dialog id="dialog"></dialog><div id="toast" hidden></div>');return;}
  if(path==='/fixture.svg'){res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="skyblue"/></svg>');return;}
  if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+sep))throw Error();
  res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'text/plain');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
let browser;const errors=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
 const page=await browser.newPage({viewport:{width:1100,height:760}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/fixture');
 await page.evaluate(async()=>{
  const {newRoom,newBlock,normalizeRoom,ensureBlockQr}=await import('/src/core/model.js');window.room=normalizeRoom(newRoom('채팅 제작'));room.playMode='team';room.teamSettings.rolesEnabled=true;room.teamSettings.roles=['A','B','C','D'];const b=newBlock();b.questionType='qr';b.qrScope='team';b.stageId=room.stageGroups[0].id;room.content=[b,newBlock('guide')];ensureBlockQr(room,b);window.app={repo:{mode:'local',list:async()=>[structuredClone(room)],save:async r=>{room=structuredClone(r);return r;}},navigate:()=>{}};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied=text}});
  await (await import('/src/ui/editor.js')).renderEditor(document.querySelector('#view'),app,room.id);
 });
 const token=await page.evaluate(()=>room.qrMissions[0].codes[0].token);const address=await page.locator('[data-qr-address]').inputValue();assert.equal(new URL(address).searchParams.get('qr'),token);assert.equal(await page.locator('[data-qr-address]').getAttribute('readonly'),'');await page.locator('[data-qr-copy]').click();assert.equal(await page.evaluate(()=>copied),address);
 await page.locator('[data-chat-enabled]').selectOption('on');await page.locator('[data-chat-new]').click();await page.locator('[data-chat-name]').fill('본관 조사팀');await page.locator('[data-chat-scope]').selectOption('roles');await page.locator('[data-chat-role=A]').check();await page.locator('[data-chat-role=B]').check();
 await page.locator('[data-action=save]').click();assert.deepEqual(await page.evaluate(()=>room.chatRooms[0].roles),['A','B']);const chatId=await page.evaluate(()=>room.chatRooms[0].id);
 await page.locator('[data-select]').nth(1).click();await page.locator('[data-chat-enabled]').selectOption('on');await page.locator('[data-chat-link]').check();await page.locator('[data-action=save]').click();assert.equal(await page.evaluate(()=>room.content[1].chatRoomIds[0]),chatId);assert.equal(await page.evaluate(()=>room.chatRooms.length),1);assert.equal(await page.evaluate(()=>room.qrMissions[0].codes[0].token),token);
 await page.evaluate(()=>app.cleanup());
 // Two isolated browser contexts, real UI + WebSocket invalidation handler; transport is a local fixture.
 const secondContext=await browser.newContext(),other=await secondContext.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(base+'/fixture');
 const pages=[page,other],messages=[],allowed=[true,true];let sequence=0;
 for(const [actor,p] of pages.entries()){
  await p.exposeFunction('chatFixture',async body=>{
   if(!allowed[actor]){if(body.p_action==='list')return {sessionId:'session',participantId:'actor'+actor,rooms:[]};throw Error('참여할 수 없는 채팅방입니다.');}
   const rooms=[{id:'ab',name:'본관 조사팀',topic:'chat:ab',count:messages.filter(m=>m.room==='ab').length},{id:'all',name:'팀 전체',topic:'chat:all',count:messages.filter(m=>m.room==='all').length}];
   if(body.p_action==='list')return {sessionId:'session',participantId:'actor'+actor,rooms};
   if(body.p_action==='send'&&!messages.some(m=>m.request===body.p_request)){
    messages.push({id:++sequence,room:body.p_room,actor,request:body.p_request,name:['A','B'][actor],text:body.p_text,at:new Date().toISOString()});
    setTimeout(()=>{for(const target of pages)target.evaluate(room=>{for(const s of window.sockets||[])if(s.topic==='realtime:chat:'+room)s.onmessage?.({data:JSON.stringify({topic:s.topic,event:'broadcast',payload:{event:'changed',payload:{}}})});},body.p_room).catch(()=>{});},0);
   }
   return {roomId:body.p_room,count:messages.filter(m=>m.room===body.p_room).length,messages:messages.filter(m=>m.room===body.p_room&&(!body.p_before||m.id<body.p_before)).map(m=>({id:m.id,name:m.name,text:m.text,at:m.at,mine:m.actor===actor}))};
  });
  await p.evaluate(async actor=>{
   window.sockets=[];window.WebSocket=class{constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}send(raw){const m=JSON.parse(raw);this.topic=m.topic;if(m.event==='phx_join')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({topic:m.topic,event:'phx_reply',ref:'1',payload:{status:'ok'}})}));}close(){this.closed=true;}};
   const {newRoom,newBlock}=await import('/src/core/model.js');const r=newRoom(),b=newBlock();b.questionType='qr';b.chatEnabled=true;b.title='팀원별 QR';
   window.game={sessionId:'session',status:'playing',revision:1,current:b,available:[b],playMode:'team',team:1,progress:{completedCount:0,totalCount:2,wrongCounts:{},role:['A','B'][actor]},timing:{elapsedMs:0},theme:r.theme,qr:[{mode:'UNIQUE_MEMBER',selfDone:false,found:0,required:2,total:4,done:false}]};window.app={};window.scanCalls=0;
   window.lobby={repo:{config:{url:'https://fixture.invalid',key:'public'}},saved:()=>({token:'fixture'}),student:async()=>({}),rpc:async(name,body)=>{if(name==='escape_chat')return chatFixture(body);if(name==='escape_answer_qr'){scanCalls++;game={...game,revision:game.revision+1,qr:[{...game.qr[0],selfDone:true,found:1}]};return {game:structuredClone(game),qrScan:{...game.qr[0]},completed:false};}return structuredClone(game);}};
   (await import('/src/ui/live-play.js')).mountLiveGame(document.querySelector('#view'),app,lobby,{title:'수업',topic:'lobby',sessionId:'session'},{code:'123456'});
  },actor);
  await p.locator('.chat-launch').waitFor();
 }
 await page.locator('.chat-launch').click();await page.locator('[data-chat-room=ab]').click();await page.locator('#chat-text').fill('<script>안녕하세요</script>');await page.locator('[data-chat-form] button').click();await page.locator('.chat-message.mine').waitFor();assert.equal(await page.locator('.chat-message p').innerText(),'<script>안녕하세요</script>');assert.equal(await page.locator('.chat-message script').count(),0);
 await other.getByRole('button',{name:'팀 채팅 · 읽지 않은 메시지 1개'}).waitFor();await other.locator('.chat-launch').click();await other.locator('[data-chat-room=ab]').click();assert.equal(await other.locator('.chat-message strong').innerText(),'A');assert.equal(await other.locator('.chat-message.mine').count(),0);await other.locator('#chat-text').fill('단서 발견');await other.locator('[data-chat-form] button').click();await page.getByText('단서 발견',{exact:true}).waitFor();assert.equal(messages.length,2);
 await page.locator('[data-chat-close]').click();await other.locator('[data-chat-close]').click();
 // Blocks with no chat hide the icon but do not remove server history; later blocks reconnect to the same room.
 allowed[0]=false;await page.evaluate(()=>{game={...game,revision:3,current:{...game.current,id:'no-chat'}};window.dispatchEvent(new Event('online'));});await page.locator('.chat-launch').waitFor({state:'hidden'});
 allowed[0]=true;await page.evaluate(()=>{game={...game,revision:4,current:{...game.current,id:'later'}};window.dispatchEvent(new Event('online'));});await page.locator('.chat-launch').waitFor();await page.locator('.chat-launch').click();await page.locator('[data-chat-room=ab]').click();assert.equal(await page.locator('.chat-message').count(),2);await page.locator('[data-chat-close]').click();
 // Scanner -> chat -> scanner uses different dialogs and cleanly disposes the scanner.
 await page.locator('[data-question-qr]').click();await page.locator('#qr-open-chat').click();await page.locator('.chat-drawer').waitFor();assert.equal(await page.locator('#dialog').isVisible(),false);await page.locator('[data-chat-close]').click();await page.locator('[data-question-qr]').click();
 await page.locator('#qr-link-form [name=link]').fill('a'.repeat(64));await page.locator('#qr-link-form button').click();await page.locator('#qr-retry').waitFor();assert.match(await page.locator('#scan-error-detail').innerText(),/내 QR 찾기 완료[\s\S]*현재 팀 진행: 1 \/ 2명/);await page.locator('#qr-retry').click();await page.locator('.qr-member-wait').waitFor();assert.equal(await page.locator('[data-question-qr]').count(),0);assert.equal(await page.evaluate(()=>scanCalls),1);
 await page.evaluate(()=>{game={...game,revision:game.revision+1,current:{...game.current,id:'next',questionType:'short',title:'다음 문제'},qr:[]};window.dispatchEvent(new Event('online'));});await page.waitForFunction(()=>document.querySelector('#live-content h2')?.textContent==='다음 문제');
 // Reconnect reads the same messages; closed unread is stored per participant/session/room.
 await other.evaluate(async()=>{app.cleanup();(await import('/src/ui/live-play.js')).mountLiveGame(document.querySelector('#view'),app,lobby,{title:'수업',topic:'lobby',sessionId:'session'},{code:'123456'});});await other.locator('.chat-launch').waitFor();assert.equal(await other.locator('.chat-launch').innerText(),'💬');await other.locator('.chat-launch').click();await other.locator('[data-chat-room=ab]').click();assert.equal(await other.locator('.chat-message').count(),2);
 await other.locator('[data-chat-close]').click();for(const p of pages)await p.evaluate(()=>app.cleanup());await secondContext.close();assert.deepEqual(errors,[]);
 console.log('PASS 014 UI: chat templates and shared block links, exact QR URL/copy, two-browser realtime text chat, escaping/unread/history/reconnect, block hiding, QR/chat lifecycle, UNIQUE_MEMBER wait and teammate advance');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
