import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom,newBlock,duplicateRoom,validateRoom } from '../src/core/model.js';
import { resultHtml } from '../src/ui/results.js';
import { LivePlayClient } from '../src/data/play.js';
test('final block references survive duplication and invalid result settings are rejected',()=>{
 const r=newRoom();r.rules.finishMode='final';r.rules.finalBlockId=r.content[0].id;const copy=duplicateRoom(r);assert.equal(copy.rules.finalBlockId,copy.content[0].id);assert.deepEqual(validateRoom(copy),[]);
 copy.rules.rankVisibility='public';assert.ok(validateRoom(copy).length);copy.rules.rankVisibility='end';copy.rules.finalBlockId='missing';assert.ok(validateRoom(copy).length);
});
test('student results hide absent score/rank and escape labels',()=>{
 const html=resultHtml({result:{label:'<학생>',arrivedAt:'2026-09-24',elapsedMs:1200,pausedMs:3000,wrongCount:1,hintCount:2},status:'playing',successMessage:'<script>',allComplete:false});
 assert.ok(html.includes('&lt;학생&gt;'));assert.ok(!html.includes('<dt>순위</dt>'));assert.ok(!html.includes('<dt>점수</dt>'));assert.ok(html.includes('다른 참가자가 진행 중입니다.'));
});
test('reset and hint retries reuse request UUID and use correct authorization',async()=>{
 const calls=[];let fail=true;const c=new LivePlayClient({saved:()=>({token:'token'}),rpc:async(name,body,auth)=>{calls.push({name,body,auth});if(fail){fail=false;throw Error('network');}return {};}});
 await assert.rejects(c.finish('s','reset',true));await c.finish('s','reset',true);assert.equal(calls[0].body.p_request,calls[1].body.p_request);assert.equal(calls[1].auth,true);
 fail=true;await assert.rejects(c.hint('room','block'));await c.hint('room','block');assert.equal(calls[2].body.p_request,calls[3].body.p_request);assert.notEqual(calls[3].auth,true);
});
