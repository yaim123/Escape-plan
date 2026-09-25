import test from 'node:test';
import assert from 'node:assert/strict';
import {newRoom,newBlock,validateRoom,duplicateRoom} from '../src/core/model.js';
import {newQrMission,newQr} from '../src/core/qr.js';
import {createTestSession,submitTestQr,blockCompleted,blockAvailable,submitAnswer} from '../src/core/session.js';
import {liveAnswerControls} from '../src/ui/live-play.js';
function fixture(scope='student'){
 const r=newRoom();r.playMode='team';const m=newQrMission();m.codes.push(newQr());r.qrMissions=[m];
 const b=newBlock();Object.assign(b,{questionType:'qr',qrId:m.codes[0].id,qrScope:scope,answers:['STALE']});r.content=[b,newBlock('story')];return {r,m,b,s:createTestSession(r,Date.now(),2)};
}
test('QR question validates/remaps existing QR and has scan button without answer input',()=>{
 const {r,b}=fixture();assert.deepEqual(validateRoom(r),[]);const copy=duplicateRoom(r);assert.equal(copy.content[0].qrId,copy.qrMissions[0].codes[0].id);
 const html=liveAnswerControls(b);assert.match(html,/QR 코드 스캔/);assert.doesNotMatch(html,/<input|type="submit"/);
 b.qrId=crypto.randomUUID();assert.ok(validateRoom(r).length);
});
test('scanner-only question advances only scanner; wrong QR is atomic; old mission dedup preserved',()=>{
 const {r,m,b,s}=fixture();assert.throws(()=>submitTestQr(r,s,b,1,m.codes[1].id),/이 문제의 QR코드/);assert.equal(s.qrScans,undefined);
 assert.equal(submitAnswer(r,s,b,1,'STALE').ok,false);submitTestQr(r,s,b,1,b.qrId);
 assert.equal(blockCompleted(r,s,b,1),true);assert.equal(blockCompleted(r,s,b,2),false);assert.equal(blockAvailable(r,s,r.content[1],1),true);
 const recovered=JSON.parse(JSON.stringify(s));submitTestQr(r,recovered,b,2,b.qrId);assert.equal(blockCompleted(r,recovered,b,2),true);assert.equal(recovered.qrScans.length,1);
});
test('team QR question completion advances all members regardless of generic completion setting',()=>{
 const {r,b,s}=fixture('team');b.completion.mode='all';submitTestQr(r,s,b,1,b.qrId);
 for(const member of [1,2]){assert.equal(blockCompleted(r,s,b,member),true);assert.equal(blockAvailable(r,s,r.content[1],member),true);}
});
