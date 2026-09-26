import test from 'node:test';
import assert from 'node:assert/strict';
import {newRoom,newBlock,normalizeRoom} from '../src/core/model.js';
import {addStage,moveBlock,moveStage} from '../src/core/stages.js';
import {buildStoryTextExport,cleanStoryText,storyExportFilename} from '../src/core/story-export.js';
import {storyTextFile,copyStoryText} from '../src/data/story-export.js';

function fixture(){
 const room=newRoom('학교탈출');room.content=[newBlock('story'),newBlock('question'),newBlock('guide'),newBlock('story')];
 ['학교 정문','보관함 암호','활동 안내','이상한 복도'].forEach((title,i)=>Object.assign(room.content[i],{title,body:['학교 앞에 도착했다.\n\n정문은 굳게 닫혀 있다.','비밀번호를 입력하세요.','함께 단서를 찾으세요.','복도에는 아무도 없다.'][i]}));
 room.content[1].answers=['1234'];return normalizeRoom(room);
}
test('story export defaults to stories, numbers use whole-content positions across filtered blocks',()=>{
 const r=fixture(),text=buildStoryTextExport(r);
 assert.equal(text,'1. 학교 정문\n\n학교 앞에 도착했다.\n\n정문은 굳게 닫혀 있다.\n\n\n4. 이상한 복도\n\n복도에는 아무도 없다.');
 assert.doesNotMatch(text,/활동 안내|보관함 암호|1234|스테이지/);
});
test('story plus guide excludes questions; all includes question label with answers opt-in only',()=>{
 const r=fixture();assert.match(buildStoryTextExport(r,{scope:'story-guide'}),/3\. 활동 안내/);assert.doesNotMatch(buildStoryTextExport(r,{scope:'story-guide'}),/보관함 암호/);
 const all=buildStoryTextExport(r,{scope:'all'});assert.match(all,/2\. 보관함 암호/);assert.match(all,/\[문제 유형: 단답형\]/);assert.doesNotMatch(all,/1234|\[정답\]/);
 assert.match(buildStoryTextExport(r,{scope:'all',answers:true}),/\[정답\]\n1234/);assert.doesNotMatch(buildStoryTextExport(r,{scope:'story-guide',answers:true}),/1234/);
});
test('stage and block moves use editor group order, names and whole-content numbering',()=>{
 const r=fixture(),id=r.content[3].id,stage=addStage(r);stage.name='본관 복도';moveBlock(r,id,stage.id);moveStage(r,stage.id,-1);
 const text=buildStoryTextExport(r,{stages:true});assert.ok(text.startsWith('[스테이지 1 · 본관 복도]\n\n\n1. 이상한 복도'));assert.match(text,/\[스테이지 2\]\n\n\n2\. 학교 정문/);
 const noNumbers=buildStoryTextExport(r,{numbers:false});assert.ok(noNumbers.startsWith('이상한 복도\n'));assert.doesNotMatch(noNumbers,/\d+\. |스테이지/);
});
test('block order within one stage survives export; empty stages do not emit empty headings',()=>{
 const r=fixture();moveBlock(r,r.content[3].id,r.stageGroups[0].id,r.content[0].id);addStage(r);
 const text=buildStoryTextExport(r,{stages:true});assert.ok(text.indexOf('이상한 복도')<text.indexOf('학교 정문'));assert.doesNotMatch(text,/스테이지 2/);
});
test('legacy stages are readable without requiring document migration',()=>{
 const r=fixture();delete r.stageGroups;r.content.forEach((b,i)=>{delete b.stageId;b.stage=i<3?'1':'2';});
 assert.match(buildStoryTextExport(r,{stages:true}),/\[스테이지 2\]/);
});
test('choices and multiple accepted answers are human-readable without internal fields',()=>{
 const r=fixture(),q=r.content[1];q.questionType='choice';q.options=['산소','이산화탄소','질소'];q.answers=['포도당','glucose','글루코스'];
 const hidden=buildStoryTextExport(r,{scope:'all'});assert.match(hidden,/\[선택지\]\n1\. 산소\n2\. 이산화탄소\n3\. 질소/);assert.doesNotMatch(hidden,/glucose/);
 assert.match(buildStoryTextExport(r,{scope:'all',answers:true}),/\[정답\]\n- 포도당\n- glucose\n- 글루코스/);
});
test('ordered/matching answers preserve ordering; QR and approval never export stale answer strings/tokens',()=>{
 const r=fixture(),q=r.content[1];q.questionType='order';q.answers=['둘째','첫째'];assert.match(buildStoryTextExport(r,{scope:'all',answers:true}),/\[정답\]\n1\. 둘째\n2\. 첫째/);
 q.questionType='match';q.options=['태양','달'];q.answers=['낮','밤'];assert.match(buildStoryTextExport(r,{scope:'all',answers:true}),/- 태양 → 낮\n- 달 → 밤/);
 for(const [kind,label] of [['qr','QR 스캔'],['approval','교사 승인']]){q.questionType=kind;q.answers=['DO_NOT_EXPORT'];q.qrId='PRIVATE_QR';const text=buildStoryTextExport(r,{scope:'all',answers:true});assert.ok(text.includes(`[완료 방식: ${label}]`));assert.doesNotMatch(text,/DO_NOT_EXPORT|PRIVATE_QR/);}
});
test('plain text cleanup preserves wording, Korean and sensible line breaks; HTML is never emitted as markup',()=>{
 assert.equal(cleanStoryText('  학교\r\n\r\n\r\n\r\n문 앞.  '),'학교\n\n문 앞.');
 assert.equal(cleanStoryText('<p>학교 <b>정문</b> &amp; 복도</p><p>1 &lt; 2<br>계속 &#54620;&#xAE00;</p><script>alert(1)</script>'),'학교 정문 & 복도\n\n1 < 2\n계속 한글');
 assert.equal(cleanStoryText('<img src="https://hidden.test" alt="a > b"><a href="https://hidden.test">문</a>'),'문');
 const r=fixture();r.content[0].body='';assert.ok(buildStoryTextExport(r).startsWith('1. 학교 정문\n\n\n4.'));assert.equal(buildStoryTextExport({...r,content:[]}), '');
});
test('export is pure and excludes UUID, QR token, media, conditions, scoring and assignment data',()=>{
 const r=fixture();r.content[0].media=[{url:'https://PRIVATE_MEDIA',type:'image'}];r.qrMissions=[{id:'PRIVATE_QR',codes:[{token:'PRIVATE_TOKEN'}]}];
 const before=structuredClone(r);const freeze=x=>{if(x&&typeof x==='object'){Object.freeze(x);Object.values(x).forEach(freeze);}};freeze(r);
 const text=buildStoryTextExport(r);assert.deepEqual(r,before);assert.doesNotMatch(text,/PRIVATE_|https:|assignment|completion|unlock|updatedAt|stageId|"id"/);for(const b of r.content)assert.ok(!text.includes(b.id));assert.ok(!text.includes(r.id));
});
test('UTF-8 TXT content is identical to preview and filename is safe while preserving Korean',async()=>{
 const r=fixture(),preview=buildStoryTextExport(r,{stages:true}),file=storyTextFile(r.title,preview);
 assert.equal(file.filename,'학교탈출_스토리.txt');assert.equal(file.blob.type,'text/plain;charset=utf-8');assert.equal(await file.blob.text(),preview);assert.deepEqual([...new Uint8Array(await file.blob.arrayBuffer()).slice(0,3)],[239,187,191]);
 assert.equal(storyExportFilename('학교/탈출:1'),'학교_탈출_1_스토리.txt');assert.equal(storyExportFilename(''),'방탈출_스토리.txt');
});
test('clipboard success and permission fallback copy the exact preview; total failure leaves manual selection',async()=>{
 const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');let copied='',selected=false;
 const preview={value:'한글\n\n본문',focus(){},select(){selected=true;}};
 try{
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{copied=text;}}}});await copyStoryText(preview);assert.equal(copied,preview.value);assert.equal(selected,false);
  navigator.clipboard.writeText=async()=>{throw Error('denied');};Object.defineProperty(globalThis,'document',{configurable:true,value:{execCommand:command=>{assert.equal(command,'copy');return true;}}});await copyStoryText(preview);assert.equal(selected,true);
  document.execCommand=()=>false;await assert.rejects(copyStoryText(preview),/Ctrl\+C/);
 }finally{if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete globalThis.document;}
});
