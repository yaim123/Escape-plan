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
  const {newRoom,newBlock,normalizeRoom,ensureBlockQr}=await import('/src/core/model.js');
  window.room=normalizeRoom(newRoom('QR UX'));const b=newBlock();b.questionType='qr';b.title='현재 QR 문제';b.stageId=room.stageGroups[0].id;room.content=[b];const m=ensureBlockQr(room,b);m.codes[0].name='과학실:문?';
  window.app={repo:{mode:'local',list:async()=>[structuredClone(room)],save:async r=>{room=structuredClone(r);return r;}},navigate:()=>{}};
  await (await import('/src/ui/editor.js')).renderEditor(document.querySelector('#view'),app,room.id);
 });
 for(const grade of ['고1','고2','고3','중2']){
  await page.locator('[data-action=room-settings]').click();await page.locator('[data-room-field="metadata.grade"]').selectOption(grade);await page.locator('[data-action=save]').click();assert.equal(await page.evaluate(()=>room.metadata.grade),grade);
  await page.evaluate(async()=>{await app.cleanup();await (await import('/src/ui/library.js')).renderLibrary(document.querySelector('#view'),app);});
  await page.locator('[data-room-filter=grade]').selectOption(grade);assert.equal(await page.locator('.room-card').count(),1);assert.ok((await page.locator('.tiny-badge').allTextContents()).includes(grade));assert.equal(await page.locator('.new-room-card').count(),0);
  await page.locator('[data-room-filter=grade]').selectOption(grade==='고1'?'고2':'고1');assert.equal(await page.locator('.room-card').count(),0);
  await page.evaluate(async()=>{await (await import('/src/ui/editor.js')).renderEditor(document.querySelector('#view'),app,room.id);});
 }
 await page.locator('[data-select]').first().click();await page.locator('[data-qr-preview] svg').waitFor();
 assert.equal(await page.locator('[data-qr-download]').first().innerText(),'PNG 저장');assert.equal(await page.locator('[data-qr-format=png]').getAttribute('class'),'btn small primary');
 const before=await page.evaluate(()=>JSON.stringify(room));const images={};
 for(const format of ['png','svg']){
  const waiting=page.waitForEvent('download');await page.locator(`[data-qr-format=${format}]`).first().click();const download=await waiting;
  assert.equal(download.suggestedFilename(),`과학실문_QR.${format}`);images[format]=(await readFile(await download.path())).toString('base64');
 }
 const imageChecks=await page.evaluate(async images=>{
  await (await import('/src/ui/qr.js')).qrLibrary('jsqr');const out={};
  for(const [format,data] of Object.entries(images)){
   const img=new Image();img.src=`data:image/${format==='svg'?'svg+xml':'png'};base64,${data}`;await img.decode();
   const c=document.createElement('canvas');c.width=c.height=format==='png'?img.naturalWidth:900;c.getContext('2d').drawImage(img,0,0,c.width,c.height);
   const px=c.getContext('2d').getImageData(0,0,c.width,c.height);out[format]={payload:jsQR(px.data,px.width,px.height)?.data,width:img.naturalWidth,height:img.naturalHeight};
   if(format==='png'){
    const {qrRasterLayout}=await import('/src/core/qr-download.js');const q=qrcode(0,'M');q.addData(out.png.payload);q.make();const margin=qrRasterLayout(q.getModuleCount()).margin;
    let white=true,binary=true;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;const edge=x<margin||y<margin||x>=c.width-margin||y>=c.height-margin;if(edge&&px.data[i]!==255)white=false;if(![0,255].includes(px.data[i])||px.data[i]!==px.data[i+1]||px.data[i]!==px.data[i+2]||px.data[i+3]!==255)binary=false;}
    out.png.quietWhite=white;out.png.binary=binary;
   }
  }return out;
 },images);
 assert.equal(imageChecks.png.payload,imageChecks.svg.payload);assert.ok(imageChecks.png.width>=800);assert.equal(imageChecks.png.width,imageChecks.png.height);assert.equal(imageChecks.png.quietWhite,true);assert.equal(imageChecks.png.binary,true);assert.equal(await page.evaluate(()=>JSON.stringify(room)),before);
 assert.equal(new URL(imageChecks.png.payload).searchParams.get('qr'),await page.evaluate(()=>room.qrMissions[0].codes[0].token));
 await page.evaluate(()=>app.cleanup());
 // Real live renderer, mocked transport only: completion and realtime happen before acknowledgement.
 async function mount(mode='ANY'){
  await page.evaluate(async mode=>{
   await app.cleanup?.();window.WebSocket=class{send(){}close(){}};
   const b={...room.content[0],id:'first'},next={...b,id:'second',title:'다음 콘텐츠',questionType:'short',body:'다음 설명'};
   window.calls=[];window.found=0;window.finishAt=mode==='ANY'?1:2;window.mode=mode;
   window.serverGame={status:'playing',revision:1,playMode:'team',team:1,current:b,available:[b],progress:{completedCount:0,totalCount:2,wrongCounts:{}},timing:{elapsedMs:0},theme:room.theme,qr:[]};
   window.advance=()=>{serverGame={...serverGame,revision:serverGame.revision+1,current:next,available:[next],progress:{...serverGame.progress,completedCount:1}};};
   const seen=new Set();window.lobby={repo:{config:{url:'https://fixture.invalid',key:'public'}},saved:()=>({token:'fixture-token'}),student:async()=>({}),rpc:async(name,body)=>{
    calls.push({name,body});if(name==='escape_answer_qr'){
     if(body.p_qr==='f'.repeat(64))throw Error('이 문제의 QR코드가 아닙니다.');
     const duplicate=seen.has(body.p_qr);if(!duplicate){seen.add(body.p_qr);found++;serverGame.revision++;}const done=found>=finishAt;
     if(done)advance();return {duplicate,message:duplicate?'다른 팀원이 이미 찾은 QR입니다.':'성공',completed:done,qrScan:{mode,found,required:finishAt,done},game:structuredClone(serverGame)};
    }return structuredClone(serverGame);
   }};
   (await import('/src/ui/live-play.js')).mountLiveGame(document.querySelector('#view'),app,lobby,{title:'수업',topic:'fixture',sessionId:'fixture'},{code:'123456'});
  },mode);await page.locator('[data-question-qr]').waitFor();await page.locator('[data-question-qr]').click();
 }
 const scan=async token=>{await page.locator('#qr-link-form [name=link]').fill(token);await page.locator('#qr-link-form button').click();await page.locator('.scanner-error:not([hidden])').waitFor();};
 for(const mode of ['ANY','ALL','N_OF_M','UNIQUE_MEMBER']){
  await mount(mode);await scan('f'.repeat(64));assert.equal(await page.locator('#scan-error-detail').innerText(),'이 문제의 QR코드가 아닙니다.');assert.equal(await page.evaluate(()=>found),0);await page.locator('#qr-retry').click();
  await scan('a'.repeat(64));assert.equal(await page.locator('#scan-error-title').innerText(),'QR을 찾았습니다!');assert.equal(await page.locator('#scan-error-detail').innerText(),mode==='ANY'?'':'현재 1 / 2개 발견');
  assert.equal(await page.locator('#live-content h2').innerText(),'현재 QR 문제');assert.equal(await page.evaluate(()=>document.activeElement.id),'qr-retry');
  const count=await page.evaluate(()=>calls.length);await page.evaluate(()=>document.querySelector('#qr-link-form').dispatchEvent(new Event('submit',{cancelable:true})));assert.equal(await page.evaluate(()=>calls.length),count);await page.keyboard.press('Escape');assert.equal(await page.locator('#dialog').isVisible(),true);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'qr-retry');
  if(mode!=='ANY'){
   await page.locator('#qr-retry').click();assert.equal(await page.locator('#dialog').isVisible(),true);
   await scan('a'.repeat(64));assert.equal(await page.locator('#scan-error-title').innerText(),'이미 찾은 QR입니다.');assert.equal(await page.locator('#scan-error-detail').innerText(),'다른 팀원이 이미 찾은 QR입니다.');assert.equal(await page.evaluate(()=>found),1);await page.locator('#qr-retry').click();
   await scan('b'.repeat(64));assert.equal(await page.locator('#scan-error-detail').innerText(),'현재 2 / 2개 발견');assert.equal(await page.locator('#live-content h2').innerText(),'현재 QR 문제');
  }
  // A fresh server read (same callback used by realtime) must not jump past the receipt.
  const reads=await page.evaluate(()=>calls.filter(c=>c.name==='escape_student_play').length);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(n=>calls.filter(c=>c.name==='escape_student_play').length>n,reads);
  assert.equal(await page.locator('#live-content h2').innerText(),'현재 QR 문제');await page.locator('#qr-retry').click();await page.waitForFunction(()=>document.querySelector('#live-content h2')?.textContent==='다음 콘텐츠');assert.equal(await page.locator('#dialog').isVisible(),false);
 }
 // Re-mounting after a reconnect reads committed progress, without replaying the QR request.
 const scanCalls=await page.evaluate(()=>calls.filter(c=>c.name==='escape_answer_qr').length);
 await page.evaluate(async()=>{app.cleanup();(await import('/src/ui/live-play.js')).mountLiveGame(document.querySelector('#view'),app,lobby,{title:'수업',topic:'fixture',sessionId:'fixture'},{code:'123456'});});
 await page.waitForFunction(()=>document.querySelector('#live-content h2')?.textContent==='다음 콘텐츠');assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='escape_answer_qr').length),scanCalls);
 // A teacher pause overrides presentation hold, and recovery displays the server's actual position.
 await mount('ALL');await scan('a'.repeat(64));await page.evaluate(()=>{serverGame.status='paused';serverGame.revision++;window.dispatchEvent(new Event('online'));});await page.locator('.pause-screen').waitFor();assert.equal(await page.locator('#dialog').isVisible(),false);
 await page.evaluate(()=>{serverGame.status='playing';serverGame.revision++;window.dispatchEvent(new Event('online'));});await page.locator('[data-question-qr]').waitFor();
 // Camera frames are decoded by actual jsQR. Repeated frames cannot issue extra RPCs while a result is open.
 await mount('ALL');await page.evaluate(async payload=>{
  await (await import('/src/ui/qr.js')).qrLibrary('jsqr');const c=document.createElement('canvas');c.width=c.height=400;window.cameraCanvas=c;
  const q=qrcode(0,'M');q.addData(payload);q.make();const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(q.createSvgTag({cellSize:4,margin:16}));await img.decode();c.getContext('2d').drawImage(img,0,0,400,400);
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{const stream=c.captureStream(10);window.cameraTimer=setInterval(()=>c.getContext('2d').drawImage(img,0,0,400,400),100);return stream;}});
 },'a'.repeat(64));
 await page.locator('#qr-camera').click();await page.locator('.scanner-error[data-result=success]').waitFor();
 const cameraCount=await page.evaluate(()=>calls.filter(c=>c.name==='escape_answer_qr').length);
 await page.waitForTimeout(850);assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='escape_answer_qr').length),cameraCount);
 await page.locator('#qr-retry').click();await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='escape_answer_qr').length),cameraCount);
 await page.locator('#dialog .modal-close').click();await page.evaluate(()=>{clearInterval(cameraTimer);app.cleanup();});
 assert.deepEqual(errors,[]);
 console.log('PASS QR UX: real PNG/SVG downloads and decoding, quiet zone, read-only tokens, high-school save/filter/badges, all four scan confirmations, failure/duplicate constraints, realtime hold, pause override, focus, camera frame suppression');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
