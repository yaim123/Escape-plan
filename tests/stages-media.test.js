import test from 'node:test';
import assert from 'node:assert/strict';
import {newRoom,newBlock,normalizeRoom,duplicateRoom,ensureBlockQr,inspectForPlay,preparePlayRoom} from '../src/core/model.js';
import {addStage,moveStage,moveBlock,stageLabel} from '../src/core/stages.js';
import {createdOrder,displayPolicy,DISPLAY_FIELDS} from '../src/core/presentation.js';
import {informationRows,informationHtml} from '../src/ui/student-info.js';
import {setRoomField,roomSettingsHtml} from '../src/ui/room-settings.js';
import {FILE_LIMITS,validateFile,storagePath,collectStoragePaths,MediaStorage} from '../src/data/media-storage.js';
import {LocalRepository} from '../src/data/storage.js';
test('legacy stages retain distinct groups, optional names, stable IDs and old block ordering',()=>{
 const r=newRoom();r.content=[{...newBlock(),stage:'2'},{...newBlock('story'),stage:'1'},{...newBlock('guide'),stage:'2'}];
 const n=normalizeRoom(r);assert.equal(n.stageGroups.length,2);assert.deepEqual(n.content.map(b=>b.stage),['2','1','2']);assert.deepEqual(n.content.map(b=>b.id),r.content.map(b=>b.id));assert.deepEqual(normalizeRoom(n),n);assert.equal(n.stageGroups[0].name,'');
});
test('stage reorder and cross-stage moves renumber blocks without breaking QR or unlock references',()=>{
 const r=normalizeRoom(newRoom());const a=r.content[0],q=newBlock();q.questionType='qr';q.qrScope='team';q.stageId=a.stageId;r.content.push(q);const m=ensureBlockQr(r,q);a.unlock.conditions=[{blockId:m.id,event:'qr_complete'}];
 const stage=addStage(r);stage.name='과학실';moveBlock(r,q.id,stage.id);assert.equal(q.stage,'2');moveStage(r,stage.id,-1);assert.equal(q.stage,'1');assert.equal(a.stage,'2');assert.equal(r.content[0].id,q.id);assert.equal(stageLabel(r,stage.id),'스테이지 1 · 과학실');assert.equal(q.qrMissionId,m.id);assert.equal(m.blockId,q.id);assert.equal(a.unlock.conditions[0].blockId,m.id);
 const copy=duplicateRoom(r);assert.notEqual(copy.stageGroups[0].id,r.stageGroups[0].id);assert.equal(copy.content[0].stageId,copy.stageGroups[0].id);
});
test('creation order does not depend on edits and local repository preserves it',async()=>{
 const map=new Map(),repo=new LocalRepository({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)});const a=newRoom('A'),b=newRoom('B');a.createdAt='2026-01-01';b.createdAt='2026-01-02';await repo.save(b);await repo.save(a);a.description='편집';await repo.save(a);assert.deepEqual((await repo.list()).map(r=>r.title),['B','A']);assert.deepEqual([b,a].sort(createdOrder).map(r=>r.title),['B','A']);
});
test('display policies separate always/info/hidden; immersive moves always into info without exposing hidden',()=>{
 const settings=Object.fromEntries(Object.keys(DISPLAY_FIELDS).map(k=>[k,'hidden']));settings.title='always';settings.elapsed='info';const c={title:'VISIBLE',description:'SECRET',studentDisplaySettings:settings,progress:{completedCount:1,totalCount:2},elapsedMs:12000};
 assert.match(informationHtml(c,'always'),/VISIBLE/);assert.doesNotMatch(informationHtml(c,'info'),/VISIBLE|SECRET/);assert.match(informationHtml({...c,immersive:true},'info'),/VISIBLE/);assert.equal(informationHtml({...c,immersive:true},'always'),'');assert.equal(displayPolicy(undefined,'progress'),'always');assert.equal(informationRows(c).find(x=>x.key==='description').mode,'hidden');
});
test('room settings update real nested values and validate designs/sound; external defaults use warning fallback only',()=>{
 const r=normalizeRoom(newRoom());setRoomField(r,'description','카드 설명','text');setRoomField(r,'studentDisplaySettings.wrong','hidden','select');setRoomField(r,'teamSettings.maxMembers','','number');setRoomField(r,'teamSettings.roles','탐정, 기록자','text');setRoomField(r,'sound.volume','.5','range');
 assert.equal(r.description,'카드 설명');assert.equal(r.studentDisplaySettings.wrong,'hidden');assert.equal(r.teamSettings.maxMembers,null);assert.deepEqual(r.teamSettings.roles,['탐정','기록자']);assert.equal(r.sound.volume,.5);assert.match(roomSettingsHtml(r),/A\. 기본 정보/);assert.match(roomSettingsHtml(r),/F\. 소리/);
 r.theme.background='bad';r.theme.bgm='bad';assert.equal(inspectForPlay(r).warnings.length,2);assert.equal(preparePlayRoom(r).theme.background,'');assert.equal(r.theme.background,'bad');r.sound.volume=4;assert.match(inspectForPlay(r).errors.join(),/음악/);
});
test('file limits and MIME checks apply before upload, external URLs never become delete paths',()=>{
 for(const [type,mime] of [['image','image/png'],['audio','audio/mp4'],['video','video/mp4']]){assert.doesNotThrow(()=>validateFile({type:mime,size:FILE_LIMITS[type]},type));assert.throws(()=>validateFile({type:mime,size:FILE_LIMITS[type]+1},type),/MB/);}
 assert.throws(()=>validateFile({type:'image/svg+xml',size:100},'image'),/형식/);
 const config={url:'https://project.supabase.co'},path=`${crypto.randomUUID()}/${crypto.randomUUID()}/images/${crypto.randomUUID()}.png`,url=config.url+'/storage/v1/object/public/escape-media/'+path;
 assert.equal(storagePath(url,config),path);assert.equal(storagePath('https://outside.test/'+path,config),null);assert.deepEqual(collectStoragePaths({a:url,b:[url,'https://youtube.com/x']},config),[path]);
});
test('upload saves first, rolls back only confirmed unreferenced files, and tolerates ambiguous committed saves',async()=>{
 const asset={url:'https://asset',path:'own/path'},events=[];const storage=new MediaStorage({});storage.removeUnused=async paths=>events.push(['delete',paths]);
 await storage.commit(asset,async()=>events.push(['save']),async()=>false);assert.deepEqual(events,[['save']]);events.length=0;
 await assert.rejects(storage.commit(asset,async()=>{throw Error('save failed');},async()=>false),/save failed/);assert.deepEqual(events,[['delete',['own/path']]]);events.length=0;
 assert.equal(await storage.commit(asset,async()=>{throw Error('lost response');},async()=>true),asset);assert.deepEqual(events,[]);
 await assert.rejects(storage.commit(asset,async()=>{throw Error('offline');},async()=>{throw Error('offline');}),/보존/);assert.deepEqual(events,[]);
});
test('Storage cleanup asks server for unused objects; referenced paths never sent to delete',async()=>{
 const calls=[],repo={mode:'cloud',request:async(path,opts)=>{calls.push([path,opts]);return path.includes('escape_unused_media')?['unused']:[];}};const storage=new MediaStorage(repo);await storage.removeUnused(['shared','unused']);assert.deepEqual(calls[1][1].body,{prefixes:['unused']});calls.length=0;await storage.removeUnused([]);assert.equal(calls.length,0);
});
test('upload uses teacher JWT, unique own path, progress and original image/audio/video bytes',async()=>{
 for(const [kind,mime] of [['image','image/png'],['audio','audio/mpeg'],['video','video/webm']]){
  let sent;const headers={},progress=[];const owner=crypto.randomUUID(),room=crypto.randomUUID();const xhr={upload:{},open(method,url){assert.equal(method,'POST');assert.ok(url.includes(owner+'/'+room+'/'+(kind==='image'?'images':kind)));},setRequestHeader(k,v){headers[k]=v;},send(blob){sent=blob;this.status=200;this.upload.onprogress({lengthComputable:true,loaded:5,total:10});this.onload();}};
  const file=new File(['data'],'original',{type:mime}),store=new MediaStorage({mode:'cloud',requireUser:()=>owner,session:{access_token:'teacher',expires_at:Date.now()/1000+3600},config:{url:'https://project.supabase.co',key:'publishable'}},{xhrFactory:()=>xhr});
  const uploaded=await store.upload(room,file,kind,{mode:'original',onProgress:n=>progress.push(n)});assert.equal(sent,file);assert.equal(headers.Authorization,'Bearer teacher');assert.equal(headers['x-upsert'],'false');assert.ok(uploaded.url.includes(uploaded.path));assert.deepEqual(progress,[50,100]);
 }
});
