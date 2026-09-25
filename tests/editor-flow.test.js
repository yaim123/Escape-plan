import test from 'node:test';
import assert from 'node:assert/strict';
import {newRoom,newBlock,normalizeRoom,validateForPlay,ensureBlockQr,duplicateRoom,BLOCK_TYPES} from '../src/core/model.js';
import {newQr,newQrMission} from '../src/core/qr.js';
import {createTestSession,submitTestQr,blockCompleted} from '../src/core/session.js';
import {LocalRepository} from '../src/data/storage.js';
import {pendingLocalDrafts,importLocalDrafts} from '../src/data/local-import.js';
import {SupabaseRepository} from '../src/data/supabase.js';
import {studentJoinUrl,codeFromUrl} from '../src/data/lobby.js';
import {contrastInk,displayAttributes} from '../src/ui/display.js';
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('draft persists invalid URLs, incomplete answer/condition/QR; empty media removed; execution names blocks',async()=>{
 const r=newRoom(),b=newBlock();b.title='미완성 문제';b.media=[{type:'image',url:''},{type:'video',url:'bad URL'}];b.display='image';b.backgroundUrl='';b.unlock.conditions=[{blockId:'',event:'complete'}];r.content=[b];
 const repo=new LocalRepository(memory());await repo.save(r);const saved=(await repo.list())[0];assert.equal(saved.content[0].media.length,1);
 const errors=validateForPlay(saved).join('\n');assert.match(errors,/미완성 문제.*정답/);assert.match(errors,/미완성 문제.*배경/);assert.match(errors,/미완성 문제.*URL/);assert.match(errors,/공개 조건/);
 b.questionType='qr';const m=ensureBlockQr(r,b);m.codes=[];await repo.save(r);assert.match(validateForPlay(r).join(),/QR/);
});
test('obsolete wait removal preserves other blocks and clears dependencies; full converts to theme',()=>{
 const r=newRoom(),w={...newBlock('guide'),type:'wait'};r.content[0].display='full';r.content[0].unlock.conditions=[{blockId:w.id,event:'complete'}];r.content.unshift(w);r.rules.finishMode='final';r.rules.finalBlockId=w.id;
 const doc=normalizeRoom(r);assert.equal(doc.content.length,1);assert.deepEqual(doc.content[0].unlock.conditions,[]);assert.equal(doc.content[0].display,'theme');assert.equal(doc.rules.finishMode,'all');assert.equal(BLOCK_TYPES.wait,undefined);assert.throws(()=>newBlock('wait'));
});
test('local import confirms server writes, preserves local originals, retries only failures per account',async()=>{
 const storage=memory(),local=new LocalRepository(storage),r1=newRoom('성공'),r2=newRoom('실패');await local.save(r1);await local.save(r2);
 const repo={config:{url:'https://project.test'},requireUser:()=> 'A',importDraft:async r=>{if(r.id===r2.id)throw Error('network');return r;}};
 const result=await importLocalDrafts(repo,await pendingLocalDrafts(repo,storage),storage);assert.equal(result.imported.length,1);assert.equal(result.failed.length,1);assert.equal((await local.list()).length,2);
 assert.deepEqual((await pendingLocalDrafts(repo,storage)).map(r=>r.id),[r2.id]);repo.importDraft=async r=>r;await importLocalDrafts(repo,await pendingLocalDrafts(repo,storage),storage);assert.equal((await pendingLocalDrafts(repo,storage)).length,0);
 repo.requireUser=()=> 'B';assert.equal((await pendingLocalDrafts(repo,storage)).length,2);
});
test('existing same-ID server content is never overwritten by local import; failed read-back not marked successful',async()=>{
 const room=newRoom();let writes=0;const repo=Object.create(SupabaseRepository.prototype);repo.get=async()=>({document:{title:'SERVER'}});repo.request=async()=>{writes++;};
 assert.equal((await repo.importDraft(room)).document.title,'SERVER');assert.equal(writes,0);
 repo.get=async()=>null;repo.requireUser=()=> 'A';await assert.rejects(repo.importDraft(room),/서버 저장/);assert.equal(writes,1);
});
test('block QR multiple claims are per scanner or per team and room duplication remaps ownership',()=>{
 const r=newRoom();r.playMode='team';const b=newBlock();b.questionType='qr';b.qrScope='student';r.content=[b,newBlock('story')];const m=ensureBlockQr(r,b);m.mode='ALL';m.codes.push(newQr());
 const s=createTestSession(r,Date.now(),2);submitTestQr(r,s,b,1,m.codes[0].id);assert.equal(blockCompleted(r,s,b,1),false);submitTestQr(r,s,b,1,m.codes[1].id);assert.equal(blockCompleted(r,s,b,1),true);assert.equal(blockCompleted(r,s,b,2),false);
 submitTestQr(r,s,b,2,m.codes[0].id);assert.equal(blockCompleted(r,s,b,2),false);submitTestQr(r,s,b,2,m.codes[1].id);assert.equal(blockCompleted(r,s,b,2),true);assert.equal(s.qrScans.length,4);
 const copy=duplicateRoom(r);assert.equal(copy.qrMissions[0].blockId,copy.content[0].id);assert.equal(copy.content[0].qrMissionId,copy.qrMissions[0].id);assert.notEqual(copy.qrMissions[0].codes[0].token,m.codes[0].token);
});
test('entry QR URL keeps Pages path without private/query data and auto-fills room code',()=>{
 const url=studentJoinUrl('964693','https://yaim123.github.io/Escape-plan/?qr=abc#/editor/123');assert.equal(url,'https://yaim123.github.io/Escape-plan/#/join?code=964693');assert.equal(codeFromUrl(url),'964693');
});
test('old standalone mission becomes a block before its dependent content without changing printed QR',()=>{
 const r=newRoom(),m=newQrMission();r.qrMissions=[m];r.content[0].unlock.conditions=[{blockId:m.id,event:'qr_complete'}];
 const doc=normalizeRoom(r);assert.equal(doc.content[0].questionType,'qr');assert.equal(doc.content[0].qrMissionId,m.id);assert.equal(doc.qrMissions[0].codes[0].token,m.codes[0].token);assert.equal(doc.content[1].unlock.conditions[0].blockId,m.id);
 doc.content[0].unlock.conditions=[{blockId:m.id,event:'qr_complete'}];assert.match(validateForPlay(doc).join(),/순환/);
});
test('common display has safe URL/contrast for all blocks; image background required only for execution',()=>{
 assert.equal(contrastInk('#ffffff'),'#111111');assert.equal(contrastInk('#000000'),'#ffffff');
 for(const type of Object.keys(BLOCK_TYPES)){const b=newBlock(type);b.display='image';b.backgroundUrl='javascript:evil()';const html=displayAttributes(b,{color:'#ffffff'});assert.doesNotMatch(html,/javascript:/);assert.match(html,/display-image/);}
});
