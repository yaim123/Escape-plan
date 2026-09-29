import {flowUnits,parallelGroup,parallelState} from './parallel.js';
import {roleVisible,roleViewsEnabled} from './team-settings.js';
import { isUnlocked, assignedMembers, isComplete } from './conditions.js';
import { checkAnswer } from './answers.js';
import {qrTestEvents,qrTestState,scanTestQr} from './qr.js';
export function createTestSession(room, now = Date.now(), memberCount = 4) {
  if(room.playMode==='team'&&room.teamSettings.rolesEnabled&&memberCount>room.teamSettings.roles.length)throw Error('팀원 수보다 설정된 역할 인원이 적습니다. 역할 인원을 추가하거나 팀 인원을 조정해주세요.');
  const members = Array.from({ length: room.playMode === 'team' ? memberCount : 1 }, (_, i) => ({ member: i + 1, role: room.teamSettings.rolesEnabled ? (room.teamSettings.roles[i] || '조원') : '조원' }));
  return { roomId: room.id, contentRevision: room.updatedAt, startedAt: now, finishedAt: null, members, events: [], wrong: {}, hints: {}, penalties: 0 };
}
function scopedEvents(room,session,member) {
  return session.events.filter(e=>e.member===member||!room.content.some(b=>b.id===e.blockId&&b.type==='question'&&b.questionType==='qr'&&b.qrScope==='student'));
}
export function blockCompleted(room, session, block, member=1) {
  if(block.type==='question'&&block.questionType==='qr') return scopedEvents(room,session,member).some(e=>e.blockId===block.id&&e.type==='complete');
  if (room.playMode === 'individual') return session.events.some(e => e.blockId === block.id && e.type === 'complete' && e.member === 1);
  if(roleViewsEnabled(room)&&block.completion.mode==='assigned')return isComplete({...block,completion:{...block.completion,mode:'all'}},session.events,assignedMembers(block,session.members,room.content.indexOf(block)).filter(m=>roleVisible(room,block,m.role)),room.content.indexOf(block));
  return isComplete(block, session.events, session.members, room.content.indexOf(block));
}
export function blockAvailable(room, session, block, member) {
  if (!roleVisible(room,block,session.members.find(m=>m.member===member)?.role))return false;
  if(room.parallelGroups?.length)return parallelAvailable(room,session,block,member);
  if (blockCompleted(room, session, block, member)) return false;
  if (room.playMode === 'team' && !assignedMembers(block, session.members, room.content.indexOf(block)).some(m => m.member === member)) return false;
  if (block.unlock.conditions.length) return isUnlocked(block.unlock, [...session.events,...qrTestEvents(room,session,member)]);
  return room.content.slice(0, room.content.indexOf(block)).every(b => !roleVisible(room,b,session.members.find(m=>m.member===member)?.role)||blockCompleted(room, session, b, member));
}
export function recordComplete(room, session, block, member, source = 'test', now = Date.now()) {
  if (session.finishedAt) return;
  const actor = session.members.find(m => m.member === member); if (!actor) throw Error('존재하지 않는 테스트 참가자입니다.');
  if (session.events.some(e => e.type === 'complete' && e.blockId === block.id && e.member === member)) return;
  const add = type => session.events.push({ type, blockId: block.id, member, role: actor.role, source, at: now });
  if (block.questionType === 'approval' && block.type === 'question') add('approved');
  if (block.type !== 'question' || block.questionType === 'switch') add('button');
  add('complete');
  for(const g of room.parallelGroups||[])if(testParallelStates(room,session,member).find(x=>x.id===g.id)?.done)(session.parallelClosed??={})[g.id]=true;
  const final=room.content.find(b=>b.id===room.rules.finalBlockId),targets=room.rules.finishMode==='final'?(final?[final]:[]):room.content;
  if(room.parallelGroups?.length){if(session.members.every(m=>room.rules.finishMode==='final'?(parallelGroup(room,final?.id)?session.parallelClosed?.[parallelGroup(room,final.id).id]:!roleVisible(room,final,m.role)||blockCompleted(room,session,final,m.member)):testFlowProgress(room,session,m.member).done))session.finishedAt=now;return;}
  if(targets.length&&session.members.some(m=>targets.some(b=>roleVisible(room,b,m.role)))&&session.members.every(m=>targets.every(b=>!roleVisible(room,b,m.role)||blockCompleted(room,session,b,m.member))))session.finishedAt=now;
}
export function submitTestQr(room,session,block,member,qrId) {
  if(!block||block.type!=='question'||block.questionType!=='qr'||!blockAvailable(room,session,block,member)) throw Error('현재 QR 문제에서만 사용할 수 있습니다.');
  const m=(room.qrMissions||[]).find(m=>m.id===block.qrMissionId);
  if(m?!m.codes.some(q=>q.id===qrId):block.qrId!==qrId) throw Error('이 문제의 QR코드가 아닙니다.');
  scanTestQr(room,session,member,qrId);
  if(!m||qrTestState(room,session,member).find(x=>x.id===m.id)?.done)recordComplete(room,session,block,member);
}
export function submitAnswer(room, session, block, member, input, now = Date.now()) {
  if (!blockAvailable(room, session, block, member)) return { ok: false, message: '아직 공개되지 않았거나 이미 완료한 콘텐츠입니다.' };
  if (session.events.some(e => e.type === 'complete' && e.blockId === block.id && e.member === member)) return { ok: false, message: '이미 해결했습니다. 다른 팀원의 완료를 기다려주세요.' };
  if (block.type !== 'question' || block.questionType === 'condition' || checkAnswer(block, input)) { recordComplete(room, session, block, member, 'test', now); return { ok: true }; }
  if (block.questionType === 'approval') return { ok: false, message: '가상 교사 승인이 필요합니다.' };
  const key = `${member}:${block.id}`; session.wrong[key] = (session.wrong[key] || 0) + 1; session.penalties += (room.rules.wrongPenaltyType||'time')==='time'?Math.max(0, room.rules.wrongPenalty):0;
  return { ok: false, message: '아직 정답이 아니에요. 단서를 다시 살펴보세요.' };
}
export function hintUsed(room, session, block, member) {
  return Object.entries(session.hints).reduce((sum, [key, value]) => {
    const [actor, blockId] = key.split(':');
    if (room.rules.hints === 'individual' && Number(actor) !== member) return sum;
    if (room.rules.hints === 'stage' && room.content.find(b => b.id === blockId)?.stage !== block.stage) return sum;
    return sum + value;
  }, 0);
}
export function revealHint(room, session, block, member) {
  if (!blockAvailable(room, session, block, member)) throw Error('공개된 콘텐츠에서만 힌트를 사용할 수 있습니다.');
  const key = `${member}:${block.id}`, count = session.hints[key] || 0;
  if (count >= block.hints.length) throw Error('모든 힌트를 확인했습니다.');
  if (room.rules.hints !== 'unlimited' && hintUsed(room, session, block, member) >= room.rules.hintLimit) throw Error('사용할 수 있는 힌트를 모두 사용했습니다.');
  session.hints[key] = count + 1; session.penalties += (room.rules.hintPenaltyType||'time')==='time'?Math.max(0, room.rules.hintPenalty):0; return block.hints[count];
}
export function sessionSummary(room, session, now = Date.now(), member=1) {
  const flow=room.parallelGroups?.length?testFlowProgress(room,session,member):null;
  return { percent:flow?.percent, total: flow?.total??room.content.filter(b=>roleVisible(room,b,session.members.find(m=>m.member===member)?.role)).length, completed: flow?.completed??room.content.filter(b => roleVisible(room,b,session.members.find(m=>m.member===member)?.role)&&blockCompleted(room, session, b, member)).length, wrong: Object.values(session.wrong).reduce((a, b) => a + b, 0), hints: Object.values(session.hints).reduce((a, b) => a + b, 0), seconds: Math.max(0, Math.floor(((session.finishedAt || now) - session.startedAt) / 1000)), penalty: session.penalties, score: Math.max(0,room.content.filter(b => b.type === 'question' && blockCompleted(room, session, b, member)).reduce((sum, b) => sum + Math.max(0, b.points || 0), 0)-(room.rules.wrongPenaltyType==='score'?Object.values(session.wrong).reduce((a,b)=>a+b,0)*room.rules.wrongPenalty:0)-(room.rules.hintPenaltyType==='score'?Object.values(session.hints).reduce((a,b)=>a+b,0)*room.rules.hintPenalty:0)) };
}

export function testWaiting(room,session,member){
 if(room.playMode!=='team')return null;
 const parallel=testParallelActive(room,session,member);if(parallel&&!room.content.some(b=>blockAvailable(room,session,b,member)))return {unit:'lanes',found:parallel.lanes.filter(l=>l.done).length,required:2,lanes:parallel.lanes};
 const actor=session.members.find(m=>m.member===member),qrStates=qrTestState(room,session,member);
 for(const b of room.content){
  if(!roleVisible(room,b,actor?.role)||blockCompleted(room,session,b,member))continue;
  const qr=qrStates.find(m=>m.id===b.qrMissionId);
  if(qr?.mode==='UNIQUE_MEMBER'&&qr.selfDone&&!qr.done)return {blockId:b.id,found:qr.found,required:qr.required};
  if(session.events.some(e=>e.blockId===b.id&&e.type==='complete'&&e.member===member))return {blockId:b.id,...(b.completion.mode==='all'?{found:new Set(session.events.filter(e=>e.blockId===b.id&&e.type==='complete'&&session.members.some(m=>m.member===e.member)).map(e=>e.member)).size,required:session.members.length}:{})};
 }
 return null;
}

export function testParallelStates(room,session,member){const role=session.members.find(m=>m.member===member)?.role;return (room.parallelGroups||[]).map(g=>parallelState(room,g,role,id=>{const b=room.content.find(b=>b.id===id),actors=assignedMembers(b,session.members,room.content.indexOf(b)).filter(m=>roleVisible(room,b,m.role));return actors.length>0&&actors.every(m=>blockCompleted(room,session,b,m.member));},session.parallelClosed?.[g.id]));}
export function testFlowProgress(room,session,member){const role=session.members.find(m=>m.member===member)?.role,states=testParallelStates(room,session,member),units=flowUnits(room).filter(u=>u.group||roleVisible(room,u.block,role));const values=units.map(u=>u.group?states.find(g=>g.id===u.id).fraction:blockCompleted(room,session,u.block,member)?1:0);return {total:units.length,completed:values.filter(n=>n===1).length,percent:units.length?Math.round(values.reduce((a,b)=>a+b,0)/units.length*100):0,done:units.length>0&&values.every(n=>n===1)};}
export function testParallelActive(room,session,member){const role=session.members.find(m=>m.member===member)?.role,states=testParallelStates(room,session,member);for(const u of flowUnits(room)){if(u.group){const st=states.find(g=>g.id===u.id);if(!st.done)return st;}else if(roleVisible(room,u.block,role)&&!blockCompleted(room,session,u.block,member))return null;}return null;}
function parallelAvailable(room,session,block,member){
 const actor=session.members.find(m=>m.member===member);if(!roleVisible(room,block,actor?.role)||blockCompleted(room,session,block,member)||session.events.some(e=>e.type==='complete'&&e.blockId===block.id&&e.member===member)||!assignedMembers(block,session.members,room.content.indexOf(block)).some(m=>m.member===member))return false;
 const states=testParallelStates(room,session,member);let prior=true;
 for(const u of flowUnits(room)){
  if(u.group){const st=states.find(g=>g.id===u.id);if(parallelGroup(room,block.id)?.id===u.id)return prior&&!st.done&&st.blockId===block.id&&isUnlocked(block.unlock,[...session.events,...qrTestEvents(room,session,member)]);prior=prior&&st.done;}
  else {if(u.id===block.id)return block.unlock.conditions.length?isUnlocked(block.unlock,[...session.events,...qrTestEvents(room,session,member)]):prior;if(roleVisible(room,u.block,actor?.role))prior=prior&&blockCompleted(room,session,u.block,member);}
 }return false;
}
