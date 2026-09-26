import test from 'node:test';
import assert from 'node:assert/strict';
import {newRoom,newBlock,normalizeRoom,inspectForPlay,preparePlayRoom,displayTypesFor,duplicateRoom,ensureBlockQr} from '../src/core/model.js';
import {readAuthCallback,verifyAuthCallback,authRedirectUrl} from '../src/data/auth-callback.js';
import {probePlayAssets} from '../src/ui/asset-probe.js';
import {immersiveHtml,isImmersive} from '../src/ui/immersive.js';
const config={url:'https://project.supabase.co',key:'public'};
test('implicit signup callback precedes hash routing, verifies server user and does not treat room code as auth',async()=>{
 const c=readAuthCallback('https://site.test/Escape-plan/?auth=confirm#access_token=TOKEN&refresh_token=SECRET&type=signup');
 assert.equal(c.accessToken,'TOKEN');assert.equal(c.refreshToken,undefined);
 let headers;const ok=await verifyAuthCallback(c,config,async(url,opts)=>{headers=opts.headers;assert.equal(url,config.url+'/auth/v1/user');return {ok:true,json:async()=>({email_confirmed_at:'2026-01-01'})};});
 assert.equal(ok.ok,true);assert.equal(headers.Authorization,'Bearer TOKEN');
 assert.equal(readAuthCallback('https://site.test/?code=123456'),null);assert.equal(readAuthCallback('https://site.test/#/editor/abc'),null);
 assert.equal(authRedirectUrl('https://site.test/Escape-plan/?qr=private#/login'),'https://site.test/Escape-plan/?auth=confirm');
});
test('expired/reused/invalid/query-code callbacks never claim successful confirmation',async()=>{
 for(const url of ['?auth=confirm#error_code=otp_expired','?auth=confirm#error=access_denied','?code=auth-code','?token_hash=unsupported','?auth=confirm']){
  assert.equal((await verifyAuthCallback(readAuthCallback('https://site.test/'+url),config,()=>assert.fail('must not call server'))).ok,false);
 }
 assert.equal((await verifyAuthCallback({accessToken:'invalid'},config,async()=>({ok:false}))).ok,false);
 assert.equal((await verifyAuthCallback({accessToken:'unconfirmed'},config,async()=>({ok:true,json:async()=>({})}))).ok,false);
 assert.equal((await verifyAuthCallback({accessToken:'network'},config,async()=>{throw Error('offline');})).ok,false);
});
test('copy has independent content/code/block/QR identities and remapped references',()=>{
 const r=newRoom('원본'),b=newBlock();b.questionType='qr';b.qrScope='team';r.content.push(b);const m=ensureBlockQr(r,b);r.content[0].unlock.conditions=[{event:'qr_complete',blockId:m.id}];r.rules.finalBlockId=b.id;
 const c=duplicateRoom(r);assert.equal(c.title,'원본 (사본)');assert.notEqual(c.id,r.id);assert.notEqual(c.roomCode,r.roomCode);
 assert.notEqual(c.content[0].id,r.content[0].id);assert.notEqual(c.qrMissions[0].id,m.id);assert.notEqual(c.qrMissions[0].codes[0].id,m.codes[0].id);assert.notEqual(c.qrMissions[0].codes[0].token,m.codes[0].token);
 assert.equal(c.content[0].unlock.conditions[0].blockId,c.qrMissions[0].id);assert.equal(c.rules.finalBlockId,c.content[1].id);c.content[0].body='changed';assert.notEqual(c.content[0].body,r.content[0].body);
});
test('asset warnings allow play copy without changing author document; answer/reference errors remain hard',()=>{
 const r=newRoom();r.content[0].display='image';r.content[0].backgroundUrl='bad';r.content[0].media=[{type:'video',url:'javascript:evil'},{type:'audio',url:'https://site.test/audio.mp3'}];const original=structuredClone(r);
 const report=inspectForPlay(r);assert.deepEqual(report.errors,[]);assert.equal(report.warnings.length,2);
 const safe=preparePlayRoom(r,['https://site.test/audio.mp3']);assert.equal(safe.content[0].display,'theme');assert.deepEqual(safe.content[0].media,[]);assert.deepEqual(r,original);
 const q=newBlock();r.content.push(q);assert.match(inspectForPlay(r).errors.join(),/정답/);q.answers=['A'];q.unlock.conditions=[{event:'complete',blockId:'missing'}];assert.match(inspectForPlay(r).errors.join(),/조건/);
});
test('immersive is story only, overlay defaults true, missing image stays immersive in safe snapshot',()=>{
 const r=newRoom();r.content[0].display='immersive';assert.equal(isImmersive(r.content[0]),true);assert.equal(normalizeRoom(r).content[0].immersiveOverlay,true);assert.deepEqual(inspectForPlay(r).errors,[]);
 assert.equal(preparePlayRoom(r).content[0].display,'immersive');r.content[0].immersiveOverlay=false;assert.equal(normalizeRoom(r).content[0].immersiveOverlay,false);
 for(const type of ['question','guide']){const b=newBlock(type);b.answers=['A'];b.display='immersive';assert.equal(displayTypesFor(type).immersive,undefined);r.content=[b];assert.match(inspectForPlay(r).errors.join(),/스토리/);}
 assert.ok(displayTypesFor('story').immersive);assert.deepEqual(Object.keys(displayTypesFor('guide')),['card','theme','image']);
});
test('immersive markup puts title/stage in hidden info, body in subtitle, keeps opacity layer and no continue form',()=>{
 const b={...newBlock('story'),display:'immersive',title:'BLOCK_TITLE',body:'BODY_SUBTITLE',stage:'7'};
 const html=immersiveHtml(b,{title:'ROOM_TITLE'}),visible=html.replace(/<aside[\s\S]*?<\/aside>/,'');
 assert.match(visible,/BODY_SUBTITLE/);assert.doesNotMatch(visible,/BLOCK_TITLE|ROOM_TITLE|STAGE|계속하기|<form/);assert.match(html,/data-scene-panel hidden/);assert.match(html,/overlay-on/);assert.match(html,/image-failed/);
 assert.match(immersiveHtml({...b,immersiveOverlay:false},{preview:true}),/immersive-preview overlay-off/);
});
test('external probes deduplicate requests, label affected blocks, preserve original and skip embeds',async()=>{
 const r=newRoom();r.content[0].display='image';r.content[0].backgroundUrl='https://site.test/bad.png';r.content[0].media=[{type:'image',url:'https://site.test/bad.png'},{type:'video',url:'https://youtu.be/abcdefghijk'}];let count=0;
 const out=await probePlayAssets(r,async()=>{count++;return false;});assert.equal(count,1);assert.deepEqual(out.urls,['https://site.test/bad.png']);assert.match(out.warnings[0],/1\./);assert.equal(r.content[0].media.length,2);
});
