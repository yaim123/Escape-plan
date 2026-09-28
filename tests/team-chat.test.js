import test from 'node:test';
import assert from 'node:assert/strict';
import {newChatRoom,validateChat} from '../src/core/chat.js';
import {newRoom,newBlock,ensureBlockQr,duplicateRoom} from '../src/core/model.js';
import {createTestSession,submitTestQr,blockCompleted} from '../src/core/session.js';
import {newQr,qrTestState} from '../src/core/qr.js';
import {createdOrder} from '../src/core/presentation.js';
import {matchesRoom} from '../src/core/classification.js';
import {blockLibraryPayload,importLibraryBlock} from '../src/core/block-library.js';
import {qrSuccessDetail} from '../src/core/qr-feedback.js';
import {liveAnswerControls} from '../src/ui/live-play.js';
test('four members contribute four distinct codes out of six; waiting is per actor',()=>{
 const r=newRoom();r.playMode='team';const b=newBlock();b.questionType='qr';b.qrScope='team';r.content=[b];const m=ensureBlockQr(r,b);m.mode='UNIQUE_MEMBER';m.codes=Array.from({length:6},newQr);const s=createTestSession(r,0,4);
 submitTestQr(r,s,b,1,m.codes[0].id);assert.throws(()=>submitTestQr(r,s,b,1,m.codes[1].id),/이미 QR/);assert.throws(()=>submitTestQr(r,s,b,2,m.codes[0].id),/다른 팀원/);
 const state=qrTestState(r,s,1)[0];assert.equal(state.required,4);assert.equal(state.found,1);assert.equal(state.selfDone,true);assert.match(liveAnswerControls(b,[state]),/내 할 일을 완료했습니다/);assert.ok(!liveAnswerControls(b,[state]).includes('data-question-qr'));
 assert.match(qrSuccessDetail(state),/현재 팀 진행: 1 \/ 4명/);for(let i=2;i<=4;i++)submitTestQr(r,s,b,i,m.codes[i-1].id);assert.equal(blockCompleted(r,s,b,4),true);
});
test('ALL and N_OF_M still allow one member to scan multiple codes',()=>{
 for(const mode of ['ALL','N_OF_M']){const r=newRoom();r.playMode='team';const b=newBlock();b.questionType='qr';b.qrScope='team';r.content=[b];const m=ensureBlockQr(r,b);m.mode=mode;m.count=2;m.codes=[newQr(),newQr()];const s=createTestSession(r,0,4);for(const q of m.codes)submitTestQr(r,s,b,1,q.id);assert.equal(blockCompleted(r,s,b,3),true);}
});
test('role arrays assign A/B/C/D and insufficient legacy slots reject extra members',()=>{
 const r=newRoom();r.playMode='team';r.teamSettings.rolesEnabled=true;r.teamSettings.roles=['A','B','C','D'];assert.deepEqual(createTestSession(r).members.map(m=>m.role),['A','B','C','D']);r.teamSettings.roles=['조장','조원'];assert.throws(()=>createTestSession(r),/역할 인원이 적습니다/);assert.deepEqual(createTestSession(r,0,2).members.map(m=>m.role),['조장','조원']);
});
test('chat templates are opt-in, validated, remapped in room copies and block-library imports',()=>{
 const r=newRoom();assert.deepEqual(validateChat(r),[]);const c=newChatRoom();r.chatRooms=[c];r.content[0].chatEnabled=true;r.content[0].chatRoomIds=[c.id];assert.deepEqual(validateChat(r),[]);
 const copy=duplicateRoom(r);assert.notEqual(copy.chatRooms[0].id,c.id);assert.equal(copy.content[0].chatRoomIds[0],copy.chatRooms[0].id);
 const imported=importLibraryBlock(blockLibraryPayload(r,r.content[0].id),'stage');assert.notEqual(imported.chatRooms[0].id,c.id);assert.equal(imported.block.chatRoomIds[0],imported.chatRooms[0].id);
 r.playMode='team';c.scope='roles';c.roles=['unknown'];assert.ok(validateChat(r).length);
});
test('latest creation order persists under combined filters and ignores updates',()=>{
 const rows=['2026-01-01','2026-03-01','2026-02-01'].map((createdAt,i)=>({...newRoom('과학 '+i),createdAt,metadata:{grade:'고1',subject:'과학',genres:['추리'],tags:['실험']}}));rows[0].updatedAt='2099-01-01';assert.deepEqual(rows.filter(r=>matchesRoom(r,{query:'과학',grade:'고1',subject:'과학',genre:'추리',tag:'실험'})).sort(createdOrder).map(r=>r.title),['과학 1','과학 2','과학 0']);
});
