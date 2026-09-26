import test from 'node:test';
import assert from 'node:assert/strict';
import {newRoom,newBlock,normalizeRoom,ensureBlockQr,inspectForPlay} from '../src/core/model.js';
import {parseTags,classification,matchesRoom,delayMinutes} from '../src/core/classification.js';
import {blockLibraryPayload,importLibraryBlock} from '../src/core/block-library.js';
import {LocalRepository} from '../src/data/storage.js';
import {BlockLibrary} from '../src/data/block-library.js';
import {qrPrintItems,qrPrintLayout} from '../src/core/qr-print.js';
import {qrPrintPages,QR_PRINT_CSS} from '../src/ui/qr-print.js';
import {hardestQuestions,delayedSubjects} from '../src/core/analysis.js';
import {questionAnalysisHtml} from '../src/ui/analysis.js';
test('classification preserves legacy subject, never invents grade/genre, and allows explicit unclassified subject',()=>{
 const old=newRoom();old.subject='과학';assert.deepEqual(classification(old),{grade:'',subject:'과학',genres:[],tags:[]});old.metadata={subject:''};assert.equal(classification(old).subject,'');old.subject='생물 탐험';delete old.metadata;assert.equal(classification(old).subject,'');assert.equal(matchesRoom(old,{grade:'중2'}),false);assert.equal(matchesRoom(old),true);
});
test('classification combines search/mode/grade/subject/genre/tags; tags trim and deduplicate',()=>{
 const r=newRoom('과학실');r.metadata={grade:'중2',subject:'과학',genres:['공포','추리','공포'],tags:parseTags(' 소화, QR\n소화,qr,협동 ')};
 assert.deepEqual(classification(r).tags,['소화','QR','협동']);assert.deepEqual(classification(r).genres,['공포','추리']);assert.equal(matchesRoom(r,{query:'소화',grade:'중2',subject:'과학',genre:'공포',tag:'협동'}),true);assert.equal(matchesRoom(r,{query:'과학실',grade:'중3'}),false);assert.equal(matchesRoom(r,{genre:'코믹'}),false);assert.equal(matchesRoom(r,{mode:'team'}),false);
});
test('delay defaults to three minutes, validates settings, suppresses paused/completed and deduplicates teams',()=>{
 const r=newRoom();delete r.rules.delayMinutes;assert.equal(delayMinutes(r),3);r.rules.delayMinutes=0;assert.equal(delayMinutes(r),0);r.rules.delayMinutes=11;assert.match(inspectForPlay(r).errors.join(),/진행 지연/);
 const state={thresholdMs:180000,elapsedMs:179000,rows:[{subject:'t:1',lastActivityMs:0},{subject:'t:1',lastActivityMs:10000},{subject:'t:2',lastActivityMs:100000}]};assert.equal(delayedSubjects(state,'playing').length,0);assert.equal(delayedSubjects(state,'playing',2000).length,1);assert.equal(delayedSubjects(state,'paused',999999).length,0);assert.equal(delayedSubjects({...state,thresholdMs:0},'playing',999999).length,0);assert.equal(delayedSubjects({...state,rows:[]},'playing',999999).length,0);assert.equal(delayedSubjects(state,'playing',200000)[0].strong,true);
});
test('TOP3 is deterministic and unknown timing is never presented as a zero duration',()=>{
 const questions=Array.from({length:4},(_,i)=>({blockId:String(i),title:'문제'+i,wrongTotal:i,hintTotal:0,averageSolveMs:i===3?null:100000-i*1000,total:2,completed:1,wrongAverage:i/2,timedCount:i===3?0:1}));const a={unit:'team',questions};assert.deepEqual(hardestQuestions(a).map(x=>x.blockId),['3','2','1']);assert.match(questionAnalysisHtml(a),/시간 기록 없음/);assert.match(questionAnalysisHtml(),/이전 보관 기록/);assert.deepEqual(hardestQuestions({questions:[]}),[]);
});
test('block library saves independent snapshots and imports new block/QR identities preserving content/media/settings',()=>{
 const r=normalizeRoom(newRoom()),q=newBlock();q.title='단서 찾기';q.questionType='qr';q.qrScope='team';q.stageId=r.stageGroups[0].id;q.media=[{type:'image',url:'https://asset.example/image.png'}];r.content.push(q);const m=ensureBlockQr(r,q);m.mode='ALL';q.unlock.conditions=[{blockId:r.content[0].id,event:'complete'}];
 const saved=blockLibraryPayload(r,q.id),before=structuredClone(saved),imported=importLibraryBlock(saved,'destination');assert.notEqual(imported.block.id,q.id);assert.equal(imported.block.stageId,'destination');assert.notEqual(imported.qrMissions[0].id,m.id);assert.notEqual(imported.qrMissions[0].codes[0].id,m.codes[0].id);assert.notEqual(imported.qrMissions[0].codes[0].token,m.codes[0].token);assert.equal(imported.qrMissions[0].mode,'ALL');assert.equal(imported.qrMissions[0].blockId,imported.block.id);assert.deepEqual(imported.block.media,q.media);assert.equal(imported.removedConditions,1);assert.equal(imported.block.unlock.conditions.length,0);imported.block.title='독립 수정';assert.deepEqual(saved,before);q.title='원본 수정';assert.equal(saved.block.title,'단서 찾기');
});
test('local block library lives outside room documents and delete cannot mutate imported blocks',async()=>{
 const mem=new Map(),repo=new LocalRepository({getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,v)}),lib=new BlockLibrary(repo),r=newRoom();const entry=await lib.save(blockLibraryPayload(r,r.content[0].id),'중2, 실험,중2');assert.deepEqual(entry.tags,['중2','실험']);assert.equal((await lib.list()).length,1);assert.equal((await repo.list()).length,0);const imported=importLibraryBlock(entry.payload,'stage');await lib.remove(entry);assert.equal((await lib.list()).length,0);assert.equal(imported.block.title,r.content[0].title);
});
function qrFixture(){const r=normalizeRoom(newRoom());for(let i=0;i<2;i++){const b=newBlock();b.title='QR 문제'+i;b.questionType='qr';b.qrScope='student';b.stageId=r.stageGroups[0].id;r.content.push(b);const m=ensureBlockQr(r,b);m.codes[0].name='단서'+i;}return r;}
test('QR print selection/quantities duplicate the same QR token without changing room data',()=>{
 const r=qrFixture(),before=structuredClone(r),items=qrPrintItems(r);const plan=qrPrintLayout(items,{selected:[items[0].id],quantities:{[items[0].id]:4}});assert.equal(plan.total,4);assert.ok(plan.pages.flat().every(q=>q.token===items[0].token));assert.ok(plan.pages.flat().every(q=>q.id!==items[1].id));assert.deepEqual(r,before);assert.equal(qrPrintLayout(items,{selected:[]}).pages.length,0);
});
test('QR A4 layout supports 4/6/8/custom size and pagination keeps each card within paper bounds',()=>{
 const items=qrPrintItems(qrFixture()),quantities=Object.fromEntries(items.map(q=>[q.id,30]));let lastCapacity=Infinity;
 for(const size of [4,6,8,9.5]){const p=qrPrintLayout(items,{size,quantities});assert.equal(p.total,60);assert.ok(p.pages.length>1);assert.ok(p.columns*p.width+(p.columns-1)*4<=190);assert.ok(p.rows*p.height+(p.rows-1)*4<=277);assert.ok(p.rows*p.columns<=lastCapacity);lastCapacity=p.rows*p.columns;assert.ok(p.pages.every(page=>page.length<=p.rows*p.columns));}
 assert.throws(()=>qrPrintLayout(items,{size:2}),/3~10/);assert.throws(()=>qrPrintLayout(items,{quantities:{[items[0].id]:0}}),/1~30/);
});
test('QR print name/number/cut toggles and print CSS use actual dimensions without plaintext token',()=>{
 const items=qrPrintItems(qrFixture()),modules=Object.fromEntries(items.map(q=>[q.id,41])),svgs=Object.fromEntries(items.map(q=>[q.id,'<svg></svg>']));const plan=qrPrintLayout(items,{names:false,numbers:false,cuts:false},modules),html=qrPrintPages(plan,svgs,modules);assert.doesNotMatch(html,/단서0|QR 01|class="qr-print-card cut"/);assert.ok(!html.includes(items[0].token));const visible=qrPrintPages(qrPrintLayout(items,{},modules),svgs,modules);assert.match(visible,/단서0|QR 01/);assert.match(visible,/qr-print-card cut/);assert.match(QR_PRINT_CSS,/@page\{size:A4/);assert.match(QR_PRINT_CSS,/break-inside:avoid/);
});
