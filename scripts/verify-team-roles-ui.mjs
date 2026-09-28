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
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/fixture');
 await page.evaluate(async()=>{
  const {newRoom,newBlock,normalizeRoom}=await import('/src/core/model.js');window.room=normalizeRoom(newRoom('팀 설정 검증'));room.playMode='team';Object.assign(room.teamSettings,{rolesEnabled:true,roleViewsEnabled:true,roles:['탐색자','탐색자','분석가','분석가']});
  const a=newBlock('story'),b=newBlock('story'),end=newBlock('guide');a.title='탐색 경로';a.body='탐색자 비밀 내용';a.assignment.visibleRoles=['탐색자'];b.title='분석 경로';b.assignment.visibleRoles=['분석가'];room.content=[a,b,end];
  window.app={repo:{mode:'local',list:async()=>[structuredClone(room)],save:async r=>{room=structuredClone(r);return r;}},navigate:()=>{}};await (await import('/src/ui/editor.js')).renderEditor(document.querySelector('#view'),app,room.id);
 });
 assert.equal(await page.locator('.role-badge').count(),2);assert.equal(await page.locator('[data-role-filter]').count(),3);
 await page.locator('[data-role-filter="탐색자"]').click();assert.equal(await page.locator('.block-item.role-dimmed').count(),1);assert.equal(await page.locator('.block-item').count(),3);
 await page.locator('[data-preview-role]').selectOption('분석가');assert.match(await page.locator('#preview-content').innerText(),/현재 선택한 역할에게 표시되지/);assert(!(await page.locator('#preview-content').innerText()).includes('탐색자 비밀 내용'));
 await page.locator('[data-preview-role]').selectOption('탐색자');assert.match(await page.locator('#preview-content').innerText(),/탐색자 비밀 내용/);
 await page.locator('[data-visible-role="분석가"]').check();await page.locator('[data-preview-role]').selectOption('분석가');assert.match(await page.locator('#preview-content').innerText(),/탐색자 비밀 내용/);
 await page.locator('[data-action=room-settings]').click();assert.equal(await page.locator('[data-role-row]').count(),2);assert.equal(await page.locator('[data-role-count]').first().inputValue(),'2');
 await page.locator('[data-room-field=playMode]').selectOption('individual');assert.equal(await page.locator('#team-settings').count(),0);
 await page.locator('[data-room-field=playMode]').selectOption('team');assert.equal(await page.locator('[data-role-count]').first().inputValue(),'2');
 await page.locator('[data-room-field="teamSettings.rolesEnabled"]').uncheck();assert.equal(await page.locator('[data-role-row]').count(),0);assert.equal(await page.locator('[data-room-field="teamSettings.roleViewsEnabled"]').count(),0);
 await page.locator('[data-room-field="teamSettings.rolesEnabled"]').check();await page.locator('[data-room-field="teamSettings.roleViewsEnabled"]').uncheck();assert.equal(await page.locator('[data-role-filter]').count(),0);assert.equal(await page.locator('[data-preview-role]').count(),0);
 await page.locator('[data-room-field="teamSettings.roleViewsEnabled"]').check();assert.equal(await page.locator('[data-preview-role]').count(),1);
 await page.locator('[data-room-field="teamSettings.chatEnabled"]').uncheck();assert.equal(await page.locator('#chat-settings').count(),0);await page.locator('[data-select]').first().click();assert.equal(await page.locator('[data-chat-enabled]').count(),0);
 await page.locator('[data-action=room-settings]').click();await page.locator('[data-room-field="teamSettings.chatEnabled"]').check();await page.getByText('채팅방 관리',{exact:true}).click();await page.locator('[data-chat-new]').click();await page.getByText('채팅방 관리',{exact:true}).click();await page.locator('[data-chat-name]').fill('탐색자 회의');await page.locator('[data-chat-scope]').selectOption('roles');await page.getByText('채팅방 관리',{exact:true}).click();assert.equal(await page.locator('[data-chat-role]').count(),2);await page.locator('[data-chat-role="탐색자"]').check();
 await page.locator('[data-room-field="teamSettings.waiting.title"]').fill('조사 완료!');await page.locator('[data-room-field="teamSettings.waiting.body"]').fill('팀원을 기다려주세요.');await page.locator('[data-room-field="teamSettings.waiting.showCounts"]').uncheck();assert(!(await page.locator('#team-wait-preview').innerText()).includes('2 / 4'));
 await page.locator('[data-role-count]').first().fill('3');await page.locator('[data-role-count]').first().press('Tab');await page.locator('[data-action=save]').click();assert.deepEqual(await page.evaluate(()=>room.teamSettings.roles),['탐색자','탐색자','탐색자','분석가','분석가']);
 // Duplicate row names are rejected, references are never silently migrated.
 await page.locator('[data-role-name]').last().fill('탐색자');await page.locator('[data-role-name]').last().press('Tab');assert.match(await page.locator('#toast').innerText(),/같은 역할/);
 await page.locator('[data-role-delete="0"]').click();await page.locator('#dialog[open]').waitFor();assert.match(await page.locator('#dialog').innerText(),/블록과 1개의 채팅방/);await page.getByRole('button',{name:'취소',exact:true}).click();assert.equal(await page.locator('[data-role-row]').count(),2);
 await page.evaluate(()=>app.cleanup());// Real student renderer consumes server waiting counts and honors global chat/count OFF.
 await page.evaluate(async()=>{
  const {newRoom,newBlock}=await import('/src/core/model.js');const r=newRoom(),b=newBlock();b.questionType='qr';b.chatEnabled=true;
  window.game={status:'playing',sessionId:'fixture',revision:1,current:b,available:[b],playMode:'team',team:1,teamChatEnabled:false,progress:{completedCount:0,totalCount:2,wrongCounts:{},role:'탐색자'},timing:{elapsedMs:0},theme:r.theme,qr:[{mode:'UNIQUE_MEMBER',selfDone:true,found:2,required:4,total:6,done:false}],waiting:{blockId:b.id,found:2,required:4},waitingSettings:{title:'조사 끝!',body:'동료들을 기다려요.',showCounts:false}};
  window.WebSocket=class{send(){}close(){}};
  window.app={};const lobby={repo:{config:{url:'https://fixture.invalid',key:'public'}},saved:()=>({token:'fixture'}),rpc:async()=>structuredClone(game)};
  (await import('/src/ui/live-play.js')).mountLiveGame(document.querySelector('#view'),app,lobby,{title:'수업',topic:'fixture',sessionId:'fixture'},{code:'123456'});
 });
 await page.locator('.team-wait').waitFor();assert.match(await page.locator('.team-wait').innerText(),/조사 끝!/);assert.match(await page.locator('.team-wait').innerText(),/동료들을 기다려요/);assert(!(await page.locator('.team-wait').innerText()).includes('2 / 4'));assert.equal(await page.locator('#qr-progress').innerText(),'');assert.equal(await page.locator('[data-question-qr]').count(),0);assert.equal(await page.locator('.chat-launch:visible').count(),0);await page.evaluate(()=>app.cleanup());
 assert.deepEqual(errors,[]);console.log('PASS 015 headless editor: mode/toggle retention, grouped roles/count/duplicates/reference confirmation, role audience/filter/preview, chat manager/global hiding, waiting text/counts, no JS errors');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
