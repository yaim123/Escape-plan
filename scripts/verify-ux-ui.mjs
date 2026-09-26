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
  const {newRoom,newBlock}=await import('/src/core/model.js');window.room=newRoom('교실');room.content[0].display='immersive';room.content[0].title='숨긴 제목';room.content[0].body='눈앞에 문이 열렸다.';room.content[0].backgroundUrl=location.origin+'/fixture.svg';room.content.push(newBlock('guide'));
  window.app={repo:{mode:'local',list:async()=>[structuredClone(room)],save:async r=>r},navigate:r=>window.route=r};
  await (await import('/src/ui/editor.js')).renderEditor(document.querySelector('#view'),app,room.id);
 });
 assert.equal(await page.locator('[data-action="class"]').innerText(),'대기실 열기');assert.equal(await page.locator('[data-field="immersiveOverlay"]').isChecked(),true);
 assert.equal(await page.locator('.immersive-preview .immersive-subtitle').innerText(),'눈앞에 문이 열렸다.');
 await page.evaluate(async()=>{await app.cleanup();app.repo.mode='cloud';app.repo.classStates=async()=>[{contentId:room.id,status:'playing',sessionId:'keep'}];await (await import('/src/ui/editor.js')).renderEditor(document.querySelector('#view'),app,room.id);});
 assert.equal(await page.locator('[data-action="class"]').innerText(),'진행 상황');await page.locator('[data-action="class"]').click();assert.match(await page.evaluate(()=>route),/^lobby\//);
 await page.evaluate(async()=>{await app.cleanup();window.resetResult='pending';(await import('/src/ui/results.js')).resetChoice().then(r=>resetResult=r);});
 assert.equal(await page.locator('[name="keep"][value="no"]').isChecked(),true);await page.getByText('선택한 방식으로 초기화',{exact:true}).click();await page.waitForFunction(()=>resetResult!== 'pending');assert.equal(await page.evaluate(()=>resetResult),false);
 await page.evaluate(async()=>{window.resetResult='pending';(await import('/src/ui/results.js')).resetChoice().then(r=>resetResult=r);});await page.locator('[name="keep"][value="yes"]').check();await page.getByText('선택한 방식으로 초기화',{exact:true}).click();await page.waitForFunction(()=>resetResult!=='pending');assert.equal(await page.evaluate(()=>resetResult),true);
 await page.evaluate(async()=>{app.repo.mode='local';await (await import('/src/ui/player.js')).renderPlayer(document.querySelector('#view'),app,room.id);});
 const scene=page.locator('.immersive-full');await scene.waitFor();const box=await scene.boundingBox();assert.equal(box.width,1100);assert.equal(box.height,760);
 assert.equal(await page.locator('.immersive-info').count(),1);assert.equal(await page.locator('.player-top').isVisible(),false);assert.equal(await page.locator('.immersive-panel').isVisible(),false);
 await page.locator('[data-scene-info]').click();assert.equal(await page.locator('.immersive-panel').isVisible(),true);await page.locator('.immersive-panel h3').click();assert.equal(await scene.count(),1);await page.locator('[data-scene-close]').click();assert.equal(await scene.count(),1);
 await scene.click({position:{x:600,y:300}});assert.equal(await page.locator('.immersive-full').count(),0);assert.equal(await page.locator('#answer-form').count(),1);
 // Overlay OFF and image failure preserve controls and use the safe fallback.
 await page.evaluate(async()=>{await app.cleanup();const {immersiveHtml,mountImmersive}=await import('/src/ui/immersive.js');room.content[0].immersiveOverlay=false;document.querySelector('#view').innerHTML=immersiveHtml(room.content[0]);window.advanced=0;mountImmersive(document.querySelector('#view'),()=>advanced++);});
 assert.equal(await page.locator('.immersive-gradient').isVisible(),false);
 await page.locator('[data-scene-image]').evaluate(img=>img.dispatchEvent(new Event('error')));assert.equal(await page.locator('.image-failed').count(),1);
 await scene.focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>advanced),1);await page.locator('[data-scene-info]').click();await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>advanced),1);
 // Actual live renderer sends the existing server submit RPC; no local completion event.
 await page.evaluate(async()=>{
  window.WebSocket=class {send(){}close(){}};room.content[0].immersiveOverlay=true;
  window.calls=[];const first={...room.content[0],backgroundUrl:''},next=room.content[1];let game={status:'playing',revision:1,playMode:'individual',current:first,available:[first],progress:{completedCount:0,totalCount:2,wrongCounts:{}},timing:{elapsedMs:0},theme:room.theme};
  const lobby={repo:{config:{url:'https://fixture.invalid',key:'public'}},saved:()=>({token:'fixture-token'}),rpc:async(name,body)=>{calls.push({name,body});if(body.p_action==='submit'){game={...game,revision:2,current:next,available:[next],progress:{...game.progress,completedCount:1}};return {outcome:'correct',game};}return game;}};
  (await import('/src/ui/live-play.js')).mountLiveGame(document.querySelector('#view'),app,lobby,{title:room.title,topic:'fixture',sessionId:'fixture'},{code:'123456'});
 });
 await scene.waitFor();await page.locator('[data-scene-info]').click();assert.equal(await page.evaluate(()=>calls.filter(c=>c.body.p_action==='submit').length),0);await page.locator('[data-scene-close]').click();await scene.click({position:{x:500,y:250}});await page.locator('#live-answer').waitFor();
 const submitted=await page.evaluate(()=>calls.filter(c=>c.body.p_action==='submit'));assert.equal(submitted.length,1);assert.equal(submitted[0].name,'escape_student_play');assert.equal(submitted[0].body.p_input,null);assert.ok(submitted[0].body.p_request);
 await page.evaluate(()=>app.cleanup());
 // Lobby -> editor link is navigation only; keeping the old snapshot performs no write.
 await page.evaluate(async()=>{
  const info={version:'v1',changed:true,snapshotVersion:'s1',assetsAcknowledged:true,document:room,state:{sessionId:'existing-session',status:'lobby',title:room.title,playMode:'individual',participants:[],serverNow:new Date().toISOString(),topic:'fixture',teamCount:4}};
  window.teacherWrites=[];app.repo={mode:'cloud',config:{url:'https://fixture.invalid',key:'public'},requireUser:()=> 'teacher',get:async()=>({id:room.id,room_code:room.roomCode,document:room}),request:async(path,options)=>{if(path.endsWith('escape_lobby_snapshot')){teacherWrites.push(options.body.p_action);return info;}throw Error('Unexpected RPC');}};
  window.lobbyRendered=(await import('/src/ui/lobby.js')).renderTeacherLobby(document.querySelector('#view'),app,room.id);
 });
 await page.getByText('기존 내용 유지',{exact:true}).click();await page.evaluate(()=>lobbyRendered);
 assert.deepEqual(await page.evaluate(()=>teacherWrites),['inspect']);assert.equal(await page.getByText('방탈출 편집',{exact:true}).getAttribute('href'),'#/editor/'+await page.evaluate(()=>room.id));
 await page.evaluate(()=>app.cleanup());
 // Warning acceptance stays separate from hard errors and retains source data.
 await page.evaluate(async()=>{document.querySelector('#view').innerHTML='';const {newRoom}=await import('/src/core/model.js');window.warnRoom=newRoom();warnRoom.content[0].display='image';warnRoom.content[0].backgroundUrl='bad';window.canStart=(await import('/src/ui/validation.js')).canRun(warnRoom);});
 await page.getByText('문제 있는 자료 없이 시작',{exact:true}).click();assert.equal(await page.evaluate(()=>canStart),true);assert.equal(await page.evaluate(()=>warnRoom.content[0].backgroundUrl),'bad');
 // Full bootstrap callback cleans its URL before verifying, then preserves the login route.
 await page.route('https://rxknixllqewkvgfnpshu.supabase.co/auth/v1/user',r=>r.fulfill({status:200,json:{email_confirmed_at:'2026-01-01'}}));
 await page.goto(base+'/?auth=confirm#access_token=fixture&refresh_token=fixture&type=signup');await page.getByText('이메일 인증이 완료되었습니다.',{exact:true}).waitFor();assert.equal(page.url(),base+'/#/auth-confirm');await page.getByText('로그인하기',{exact:true}).click();await page.locator('#view').waitFor();assert.ok(page.url().endsWith('#/login'));
 await page.goto(base+'/?auth=confirm#error_code=otp_expired');await page.getByText('이메일 인증 링크 안내',{exact:true}).waitFor();assert.equal(page.url(),base+'/#/auth-confirm');
 assert.deepEqual(errors,[]);
 console.log('PASS local headless UI: editor labels/preview, reset default/opt-in, fullscreen/info isolation/click/keyboard/fallback, live server submit, auth bootstrap and no uncaught JS errors');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
