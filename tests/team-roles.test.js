import test from 'node:test';
import assert from 'node:assert/strict';
import {newRoom,newBlock,normalizeRoom,validateForPlay} from '../src/core/model.js';
import {roleRows,expandRoleRows,roleVisible,roleReferences,teamChatEnabled,waitingSettings} from '../src/core/team-settings.js';
import {createTestSession,submitAnswer,blockAvailable,testWaiting} from '../src/core/session.js';
import {roomSettingsHtml,setRoomField} from '../src/ui/room-settings.js';
import {teamWaitingHtml} from '../src/ui/team-waiting.js';
const fixture=()=>{const r=newRoom();r.playMode='team';Object.assign(r.teamSettings,{rolesEnabled:true,roles:['A','A','B','B'],roleViewsEnabled:true});return r;};
test('role rows round-trip expanded slots and reject duplicate names/invalid counts',()=>{
 const roles=['A','A','B','B'];assert.deepEqual(roleRows(roles),[{name:'A',count:2},{name:'B',count:2}]);assert.deepEqual(expandRoleRows(roleRows(roles)),roles);
 for(const rows of [[{name:'A',count:1},{name:' A ',count:1}],[{name:'A',count:0}],[{name:'A',count:21}],[{name:'',count:1}]])assert.throws(()=>expandRoleRows(rows));
 const r=fixture();assert.deepEqual(createTestSession(r,0,3).members.map(m=>m.role),['A','A','B']);assert.throws(()=>createTestSession(r,0,5),/역할 인원/);
});
test('global switches hide controls without deleting subordinate data',()=>{
 const r=normalizeRoom(fixture());r.content[0].assignment.visibleRoles=['A'];r.content[0].chatEnabled=true;r.content[0].chatRoomIds=['old'];const before=structuredClone(r.teamSettings);
 assert.match(roomSettingsHtml(r),/B\. 플레이 방식 \/ 팀 설정/);setRoomField(r,'playMode','individual');assert(!roomSettingsHtml(r).includes('id="team-settings"'));assert(!teamChatEnabled(r));assert.deepEqual(r.teamSettings,before);
 setRoomField(r,'playMode','team');assert.match(roomSettingsHtml(r),/B\. 플레이 방식 \/ 팀 설정/);r.teamSettings.rolesEnabled=false;assert(!roomSettingsHtml(r).includes('data-role-count'));r.teamSettings.rolesEnabled=true;
 r.teamSettings.roleViewsEnabled=false;assert(roleVisible(r,r.content[0],'B'));r.teamSettings.roleViewsEnabled=true;assert(!roleVisible(r,r.content[0],'B'));
 r.teamSettings.chatEnabled=false;assert(!roomSettingsHtml(r).includes('채팅방 관리'));assert.equal(r.content[0].chatRoomIds[0],'old');
});
test('role paths skip non-target blocks without synthesizing events; same role shares access',()=>{
 const r=fixture(),a=newBlock('story'),b=newBlock('story'),end=newBlock('guide');a.assignment.visibleRoles=['A'];b.assignment.visibleRoles=['B'];r.content=[a,b,end];const s=createTestSession(r,0,4);
 assert(blockAvailable(r,s,a,1));assert(blockAvailable(r,s,a,2));assert(!blockAvailable(r,s,a,3));assert(blockAvailable(r,s,b,3));assert(!submitAnswer(r,s,a,3,null).ok);
 assert(submitAnswer(r,s,a,1,null).ok);assert(blockAvailable(r,s,end,1));assert(!s.events.some(e=>e.blockId===b.id));assert(blockAvailable(r,s,b,3));
 end.unlock.conditions=[{blockId:b.id,event:'complete'}];assert(!blockAvailable(r,s,end,1));assert(submitAnswer(r,s,b,3,null).ok);assert(blockAvailable(r,s,end,1));
});
test('assigned completion uses visible assignees; role reference changes remain visible errors',()=>{
 const r=fixture(),b=newBlock('story');b.assignment.visibleRoles=['A'];b.completion.mode='assigned';r.content=[b,newBlock('guide')];const s=createTestSession(r,0,4);
 submitAnswer(r,s,b,1,null);assert(testWaiting(r,s,1));assert(!blockAvailable(r,s,r.content[1],1));submitAnswer(r,s,b,2,null);assert(blockAvailable(r,s,r.content[1],1));
 assert.equal(roleReferences(r,'A').blocks,1);r.teamSettings.roles=['B','B'];assert(validateForPlay(r).some(e=>e.includes('존재하지 않는 역할')));assert.deepEqual(b.assignment.visibleRoles,['A']);
});
test('waiting safely renders configured text, optional exact counts, and defaults',()=>{
 const w={found:2,required:4};assert.match(teamWaitingHtml(w,{title:'조사 완료',body:'기다려요',showCounts:true}),/현재 2 \/ 4명 완료/);
 assert(!teamWaitingHtml(w,{showCounts:false}).includes('2 / 4'));assert(!teamWaitingHtml({},{}).includes('명 완료'));
 assert.match(teamWaitingHtml(w,{title:'',body:''}),/내 할 일을 완료했습니다/);assert(!teamWaitingHtml(w,{title:'<script>'}).includes('<script>'));
 assert.equal(waitingSettings({}).showCounts,true);
});
