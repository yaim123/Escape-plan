import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {newRoom,newBlock,duplicateRoom,validateRoom} from '../src/core/model.js';
import {newQrMission,newQr,qrUrl,readQr,scanTestQr,qrTestState} from '../src/core/qr.js';
import {createTestSession,blockAvailable} from '../src/core/session.js';
test('QR conditions simulate unique claims and per-member completion without live writes',()=>{
 const room=newRoom();room.playMode='team';const m=newQrMission();m.codes=[newQr(),newQr(),newQr(),newQr()];m.mode='UNIQUE_MEMBER';room.qrMissions=[m];const b=newBlock();b.unlock.conditions=[{blockId:m.id,event:'qr_complete'}];room.content=[b];const s=createTestSession(room,0,2);
 scanTestQr(room,s,1,m.codes[0].id);assert.equal(scanTestQr(room,s,2,m.codes[0].id),false);scanTestQr(room,s,1,m.codes[1].id);assert.equal(blockAvailable(room,s,b,2),false);scanTestQr(room,s,2,m.codes[2].id);assert.equal(blockAvailable(room,s,b,2),true);
 for(const [mode,count,done] of [['ANY',1,true],['ALL',1,false],['N_OF_M',3,true]]){m.mode=mode;m.count=count;assert.equal(qrTestState(room,s,2)[0].done,done);}
 m.scope='student';assert.equal(qrTestState(room,s,2)[0].found,1);
});
test('duplicate/import regenerates QR capabilities and maps all condition references',()=>{
 const r=newRoom(),m=newQrMission();r.qrMissions=[m];r.content[0].unlock.conditions=[{blockId:m.codes[0].id,event:'qr_scanned'}];const copy=duplicateRoom(r);assert.notEqual(copy.qrMissions[0].codes[0].token,m.codes[0].token);assert.equal(copy.content.find(b=>b.type==='story').unlock.conditions[0].blockId,copy.qrMissions[0].codes[0].id);assert.deepEqual(validateRoom(copy),[]);copy.qrMissions[0].mode='UNIQUE_MEMBER';assert.ok(validateRoom(copy).length);
});
test('QR URLs preserve Pages base path and reject non-QR/executable input',()=>{const q=newQr(),u=qrUrl(q.token,'https://example.com/my-repo/?old=1#/editor');assert.equal(u,`https://example.com/my-repo/?qr=${q.token}`);assert.equal(readQr(u),q.token);assert.equal(readQr('javascript:alert(1)'),null);assert.equal(readQr('https://example.com/?qr=hello'),null);});
test('vendored encoder output decodes with the actual scanner library',async()=>{const ctx=vm.createContext({});vm.runInContext(await readFile('src/vendor/qrcode-generator.js','utf8'),ctx);vm.runInContext(await readFile('src/vendor/jsqr.js','utf8'),ctx);const text=qrUrl(newQr().token,'https://example.com/project/');const qr=ctx.qrcode(0,'M');qr.addData(text);qr.make();const n=qr.getModuleCount(),scale=6,size=(n+8)*scale,data=new Uint8ClampedArray(size*size*4).fill(255);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const r=Math.floor(y/scale)-4,c=Math.floor(x/scale)-4;if(r>=0&&c>=0&&r<n&&c<n&&qr.isDark(r,c)){const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=0;}}assert.equal(ctx.jsQR(data,size,size).data,text);});
