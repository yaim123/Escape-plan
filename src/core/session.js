import { isUnlocked, assignedMembers, isComplete } from './conditions.js';
import { checkAnswer } from './answers.js';
import {qrTestEvents,qrTestState,scanTestQr} from './qr.js';
export function createTestSession(room, now = Date.now(), memberCount = 4) {
  const members = Array.from({ length: room.playMode === 'team' ? memberCount : 1 }, (_, i) => ({ member: i + 1, role: room.teamSettings.rolesEnabled ? (room.teamSettings.roles[i === 0 ? 0 : Math.min(1, room.teamSettings.roles.length - 1)] || '조원') : '조원' }));
  return { roomId: room.id, contentRevision: room.updatedAt, startedAt: now, finishedAt: null, members, events: [], wrong: {}, hints: {}, penalties: 0 };
}
function scopedEvents(room,session,member) {
  return session.events.filter(e=>e.member===member||!room.content.some(b=>b.id===e.blockId&&b.type==='question'&&b.questionType==='qr'&&b.qrScope==='student'));
}
export function blockCompleted(room, session, block, member=1) {
  if(block.type==='question'&&block.questionType==='qr') return scopedEvents(room,session,member).some(e=>e.blockId===block.id&&e.type==='complete');
  if (room.playMode === 'individual') return session.events.some(e => e.blockId === block.id && e.type === 'complete' && e.member === 1);
  return isComplete(block, session.events, session.members, room.content.indexOf(block));
}
export function blockAvailable(room, session, block, member) {
  if (blockCompleted(room, session, block, member)) return false;
  if (room.playMode === 'team' && !assignedMembers(block, session.members, room.content.indexOf(block)).some(m => m.member === member)) return false;
  if (block.unlock.conditions.length) return isUnlocked(block.unlock, [...session.events,...qrTestEvents(room,session,member)]);
  return room.content.slice(0, room.content.indexOf(block)).every(b => blockCompleted(room, session, b, member));
}
export function recordComplete(room, session, block, member, source = 'test', now = Date.now()) {
  if (session.finishedAt) return;
  const actor = session.members.find(m => m.member === member); if (!actor) throw Error('존재하지 않는 테스트 참가자입니다.');
  if (session.events.some(e => e.type === 'complete' && e.blockId === block.id && e.member === member)) return;
  const add = type => session.events.push({ type, blockId: block.id, member, role: actor.role, source, at: now });
  if (block.questionType === 'approval' && block.type === 'question') add('approved');
  if (block.type !== 'question' || block.questionType === 'switch') add('button');
  add('complete');
  if (room.content.length && session.members.every(m=>room.rules.finishMode==='final'?room.content.some(b=>b.id===room.rules.finalBlockId&&blockCompleted(room,session,b,m.member)):room.content.every(b=>blockCompleted(room,session,b,m.member)))) session.finishedAt = now;
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
  return { completed: room.content.filter(b => blockCompleted(room, session, b, member)).length, wrong: Object.values(session.wrong).reduce((a, b) => a + b, 0), hints: Object.values(session.hints).reduce((a, b) => a + b, 0), seconds: Math.max(0, Math.floor(((session.finishedAt || now) - session.startedAt) / 1000)), penalty: session.penalties, score: Math.max(0,room.content.filter(b => b.type === 'question' && blockCompleted(room, session, b, member)).reduce((sum, b) => sum + Math.max(0, b.points || 0), 0)-(room.rules.wrongPenaltyType==='score'?Object.values(session.wrong).reduce((a,b)=>a+b,0)*room.rules.wrongPenalty:0)-(room.rules.hintPenaltyType==='score'?Object.values(session.hints).reduce((a,b)=>a+b,0)*room.rules.hintPenalty:0)) };
}
