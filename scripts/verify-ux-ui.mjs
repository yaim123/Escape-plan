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
 await page.locator('[data-action=fullscreen]').click();await page.locator('#dialog [data-scene-info]').click();assert.equal(await page.locator('#dialog [data-info-key=blockTitle] span').innerText(),'숨긴 제목');await page.locator('#dialog .modal-close').click();
 await page.evaluate(async()=>{await app.cleanup();app.repo.mode='cloud';app.repo.classStates=async()=>[{contentId:room.id,status:'playing',sessionId:'keep'}];await (await import('/src/ui/editor.js')).renderEditor(document.querySelector('#view'),app,room.id);});
 assert.equal(await page.locator('[data-action="class"]').innerText(),'진행 상황');await page.locator('[data-action="class"]').click();assert.match(await page.evaluate(()=>route),/^lobby\//);
 await page.evaluate(async()=>{await app.cleanup();window.resetResult='pending';(await import('/src/ui/results.js')).resetChoice().then(r=>resetResult=r);});
 assert.equal(await page.locator('[name="keep"][value="no"]').isChecked(),true);await page.getByText('선택한 방식으로 초기화',{exact:true}).click();await page.waitForFunction(()=>resetResult!== 'pending');assert.equal(await page.evaluate(()=>resetResult),false);
 await page.evaluate(async()=>{window.resetResult='pending';(await import('/src/ui/results.js')).resetChoice().then(r=>resetResult=r);});await page.locator('[name="keep"][value="yes"]').check();await page.getByText('선택한 방식으로 초기화',{exact:true}).click();await page.waitForFunction(()=>resetResult!=='pending');assert.equal(await page.evaluate(()=>resetResult),true);
 await page.evaluate(async()=>{app.repo.mode='local';await (await import('/src/ui/player.js')).renderPlayer(document.querySelector('#view'),app,room.id);});
 const scene=page.locator('.immersive-full');await scene.waitFor();const box=await scene.boundingBox();assert.equal(box.width,1100);assert.equal(box.height,760);
 assert.equal(await page.locator('.immersive-info').count(),1);assert.equal(await page.locator('.player-top').isVisible(),false);assert.equal(await page.locator('.immersive-panel').isVisible(),false);
 await page.locator('[data-scene-info]').click();assert.equal(await page.locator('.immersive-panel').isVisible(),true);await page.locator('.immersive-panel [data-info-key=blockTitle]').click();assert.equal(await scene.count(),1);await page.locator('[data-scene-close]').click();assert.equal(await scene.count(),1);
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
 assert.deepEqual(await page.evaluate(()=>teacherWrites),['inspect']);assert.equal(await page.getByText('← 방탈출 편집',{exact:true}).getAttribute('href'),'#/editor/'+await page.evaluate(()=>room.id));
 await page.evaluate(()=>app.cleanup());
 // Warning acceptance stays separate from hard errors and retains source data.
 await page.evaluate(async()=>{document.querySelector('#view').innerHTML='';const {newRoom}=await import('/src/core/model.js');window.warnRoom=newRoom();warnRoom.content[0].display='image';warnRoom.content[0].backgroundUrl='bad';window.canStart=(await import('/src/ui/validation.js')).canRun(warnRoom);});
 await page.getByText('문제 있는 자료 없이 시작',{exact:true}).click();assert.equal(await page.evaluate(()=>canStart),true);assert.equal(await page.evaluate(()=>warnRoom.content[0].backgroundUrl),'bad');

 // Stage groups, room-wide center settings and fixed library order use the real renderers.
 await page.evaluate(async()=>{
  const {newRoom,newBlock,normalizeRoom}=await import('/src/core/model.js');window.rooms=[normalizeRoom(newRoom('A')),normalizeRoom(newRoom('B'))];rooms[0].createdAt='2026-01-01';rooms[1].createdAt='2026-01-02';rooms[0].description='실제 카드 설명';rooms[0].theme.color='#215544';rooms[1].playMode='team';
  app.repo={mode:'local',list:async()=>[rooms[1],rooms[0]],save:async r=>{const i=rooms.findIndex(x=>x.id===r.id);rooms[i]=structuredClone(r);return {...r,updatedAt:new Date().toISOString()};}};
  await (await import('/src/ui/library.js')).renderLibrary(document.querySelector('#view'),app);
 });
 assert.equal(await page.locator('#room-grid > :first-child').getAttribute('data-action'),'create');assert.deepEqual(await page.locator('.room-card-body h3').allTextContents(),['A','B']);assert.equal(await page.locator('.room-description').innerText(),'실제 카드 설명');assert.equal(await page.getByText('새로운 이야기를 채워주세요.').count(),0);assert.equal(await page.locator('.card-room-code').count(),2);
 await page.locator('#search-rooms').fill('B');assert.equal(await page.locator('.new-room-card').count(),0);assert.equal(await page.locator('.room-card-body h3').innerText(),'B');await page.locator('#search-rooms').fill('');await page.locator('[data-filter=team]').click();assert.equal(await page.locator('.new-room-card').count(),0);await page.locator('[data-filter=all]').click();assert.equal(await page.locator('#room-grid > :first-child').getAttribute('data-action'),'create');
 await page.evaluate(async()=>{await (await import('/src/ui/editor.js')).renderEditor(document.querySelector('#view'),app,rooms[0].id);});
 assert.equal(await page.locator('[data-field=stage]').count(),0);assert.equal(await page.locator('.block-sidebar > :first-child').innerText(),'방탈출 전체 설정');
 await page.locator('[data-action=add-stage]').click();assert.equal(await page.locator('.stage-group').count(),2);await page.locator('[data-stage-name]').nth(1).fill('과학실');await page.locator('[data-action=save]').click();
 await page.locator('[data-add-stage-block]').nth(1).click();await page.locator('#dialog [data-type=guide]').click();assert.equal(await page.locator('[data-field=stageId]').inputValue(),await page.locator('.stage-group').nth(1).getAttribute('data-stage-group'));
 await page.locator('[data-stage-move="-1"]').nth(1).click();assert.match(await page.locator('[data-fold]').first().innerText(),/스테이지 1 · 과학실/);await page.locator('[data-fold]').first().click();assert.equal(await page.locator('.stage-blocks').first().isVisible(),false);await page.locator('[data-fold]').first().click();
 await page.locator('[data-action=room-settings]').click();assert.equal(await page.locator('#edit-fields > h2').innerText(),'방탈출 전체 설정');await page.locator('[data-room-field=description]').fill('수정 설명');await page.locator('[data-action=save]').click();assert.equal(await page.evaluate(()=>rooms[0].description),'수정 설명');assert.equal(await page.evaluate(()=>rooms[0].stageGroups[0].name),'과학실');assert.equal(await page.evaluate(()=>rooms[0].content[0].stage),'1');
 // Drag across groups updates the same block's stage and preserves its identity.
 await page.setViewportSize({width:1100,height:1200});await page.evaluate(()=>window.scrollTo(0,0));
 const source=page.locator('.stage-group').first().locator('[data-block]').first(),target=page.locator('.stage-group').nth(1).locator('[data-add-stage-block]');
 const moved=await source.getAttribute('data-block');const from=await source.boundingBox(),to=await target.boundingBox();
 await page.mouse.move(from.x+3,from.y+3);await page.mouse.down();await page.mouse.move(from.x+15,from.y+3,{steps:4});await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:12});await page.mouse.up();
 await page.locator('[data-action=save]').click();assert.equal(await page.evaluate(id=>rooms[0].content.find(b=>b.id===id).stage,moved),'2');
 await page.evaluate(()=>app.cleanup());
 // Read-only story export uses current stage order; copy and actual TXT download match the preview.
 await page.evaluate(async()=>{await (await import('/src/ui/editor.js')).renderEditor(document.querySelector('#view'),app,rooms[0].id);window.exportBefore=JSON.stringify(rooms[0]);window.exportSaves=0;const save=app.repo.save;app.repo.save=async(...args)=>{exportSaves++;return save(...args);};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copiedStory=text}});});
 assert.equal(await page.locator('[data-action=export]').innerText(),'JSON 내보내기');await page.getByText('스토리 텍스트로 내보내기',{exact:true}).click();
 assert.equal(await page.locator('[name=story-scope][value=story]').isChecked(),true);assert.equal(await page.locator('[data-story-numbers]').isChecked(),true);assert.equal(await page.locator('[data-story-stages]').isChecked(),false);assert.equal(await page.locator('[data-story-answers]').isChecked(),false);assert.equal(await page.locator('[data-story-answers]').isDisabled(),true);
 assert.doesNotMatch(await page.locator('[data-story-preview]').inputValue(),/새로운 안내/);await page.locator('[name=story-scope][value=all]').check();assert.match(await page.locator('[data-story-preview]').inputValue(),/새로운 안내/);assert.equal(await page.locator('[data-story-answers]').isDisabled(),false);await page.locator('[data-story-stages]').check();
 const textPreview=await page.locator('[data-story-preview]').inputValue();await page.getByText('전체 복사',{exact:true}).click();assert.equal(await page.evaluate(()=>copiedStory),textPreview);
 const downloaded=page.waitForEvent('download');await page.getByText('TXT로 저장',{exact:true}).click();const txt=await downloaded;assert.equal(txt.suggestedFilename(),'A_스토리.txt');assert.equal((await readFile(await txt.path(),'utf8')).replace(/^\ufeff/,''),textPreview);
 assert.equal(await page.evaluate(()=>exportSaves),0);assert.equal(await page.evaluate(()=>JSON.stringify(rooms[0])===exportBefore),true);await page.locator('#dialog .modal-close').click();await page.evaluate(()=>app.cleanup());
 // Real player keeps essential question/input/actions while three-way metadata policy hides optional text.
 await page.evaluate(async()=>{const {newBlock}=await import('/src/core/model.js');const {DISPLAY_FIELDS}=await import('/src/core/presentation.js');const q=newBlock();q.body='필수 문제 본문';q.answers=['정답'];rooms[0].content=[q];rooms[0].studentDisplaySettings=Object.fromEntries(Object.keys(DISPLAY_FIELDS).map(k=>[k,'hidden']));rooms[0].studentDisplaySettings.title='info';rooms[0].studentDisplaySettings.progress='always';await (await import('/src/ui/player.js')).renderPlayer(document.querySelector('#view'),app,rooms[0].id);});
 assert.equal(await page.locator('.student-always [data-info-key=progress]').count(),1);assert.equal(await page.locator('.student-always [data-info-key=title]').count(),0);assert.equal(await page.locator('#student-meta [data-info-key=description]').count(),0);assert.equal(await page.locator('#answer-form [name=answer]').isVisible(),true);assert.equal(await page.getByText('필수 문제 본문',{exact:true}).isVisible(),true);
 await page.locator('[data-info-open]').click();assert.equal(await page.locator('[data-info-panel] [data-info-key=title]').isVisible(),true);assert.equal(await page.locator('#answer-form').count(),1);await page.locator('[data-info-close]').click();assert.equal(await page.locator('#answer-form').count(),1);await page.evaluate(()=>app.cleanup());
 // Browser canvas optimization preserves alpha and never enlarges a small image.
 const optimized=await page.evaluate(async()=>{const {optimizeImage}=await import('/src/data/media-storage.js');const canvas=document.createElement('canvas');canvas.width=2200;canvas.height=1200;const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,1000,1200);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const file=new File([blob],'transparent.png',{type:'image/png'});const result=await optimizeImage(file,'recommended');const img=await createImageBitmap(result);const out=document.createElement('canvas');out.width=img.width;out.height=img.height;out.getContext('2d').drawImage(img,0,0);const alpha=out.getContext('2d').getImageData(img.width-1,0,1,1).data[3];const dims=[img.width,img.height];img.close();return {dims,alpha,type:result.type};});
 assert.ok(optimized.dims[0]<=1600);assert.equal(optimized.alpha,0);assert.ok(['image/png','image/webp'].includes(optimized.type));
 // Shared upload component uses XHR progress and leaves external URL inputs unchanged.
 await page.evaluate(async()=>{
  window.NativeXHR=XMLHttpRequest;window.XMLHttpRequest=class{upload={};status=200;open(method,url){window.uploadPath=url;}setRequestHeader(){}send(blob){window.uploadedBlob=blob;queueMicrotask(()=>{this.upload.onprogress?.({lengthComputable:true,loaded:blob.size,total:blob.size});this.onload();});}};
  const {uploadDialog}=await import('/src/ui/upload.js');const repo={mode:'cloud',requireUser:()=> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',config:{url:location.origin,key:'public'},session:{access_token:'test-teacher',expires_at:Date.now()/1000+3600}};
  window.uploadCommitted=null;window.uploadFinished=uploadDialog(repo,rooms[0].id,{kind:'audio',onCommit:async asset=>{uploadCommitted=asset;},verify:async()=>false});
 });
 await page.locator('[data-upload-file]').setInputFiles({name:'lesson.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('test-audio')});await page.getByText('완료',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>uploadCommitted.name),'lesson.mp3');assert.ok((await page.evaluate(()=>uploadPath)).includes('/audio/'));await page.getByText('완료',{exact:true}).click();await page.evaluate(async()=>{await uploadFinished;window.XMLHttpRequest=NativeXHR;});
 // Full bootstrap callback cleans its URL before verifying, then preserves the login route.
 await page.route('https://rxknixllqewkvgfnpshu.supabase.co/auth/v1/user',r=>r.fulfill({status:200,json:{email_confirmed_at:'2026-01-01'}}));
 await page.goto(base+'/?auth=confirm#access_token=fixture&refresh_token=fixture&type=signup');await page.getByText('이메일 인증이 완료되었습니다.',{exact:true}).waitFor();assert.equal(page.url(),base+'/#/auth-confirm');await page.getByText('로그인하기',{exact:true}).click();await page.locator('#view').waitFor();assert.ok(page.url().endsWith('#/login'));
 await page.goto(base+'/?auth=confirm#error_code=otp_expired');await page.getByText('이메일 인증 링크 안내',{exact:true}).waitFor();assert.equal(page.url(),base+'/#/auth-confirm');
 assert.deepEqual(errors,[]);
 console.log('PASS local headless UI 010/011: session navigation, reset choices, stage create/name/reorder/drag/fold/save, fixed library cards, room settings, three-way metadata/required controls, fullscreen/info isolation, immersive server submit/fallback, alpha optimization, shared upload, read-only story export/copy/TXT, auth bootstrap, no uncaught JS errors');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
