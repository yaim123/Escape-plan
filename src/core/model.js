import {qrToken} from './qr.js';
export const VERSION = 1;
export const BLOCK_TYPES = { story: '스토리', question: '문제', guide: '안내', wait: '조건 대기' };
export const QUESTION_TYPES = { short: '단답형', number: '숫자형', choice: '객관식', multi: '복수 선택형', ox: 'OX형', order: '순서 배열형', match: '짝맞추기형', cipher: '암호 입력형', switch: '버튼 / 스위치형', condition: '조건 달성형', approval: '교사 승인형' };
export const uid = () => crypto.randomUUID();
export function roomCode() { return String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000); }
export function newBlock(type = 'question') {
  return { id: uid(), type, title: type === 'question' ? '새로운 문제' : `새로운 ${BLOCK_TYPES[type]}`, body: '', stage: '1', questionType: 'short', answers: [], options: ['선택지 1', '선택지 2', '선택지 3'], hints: [], media: [], normalization: { trim: true, spaces: false, case: true, punctuation: false }, display: 'card', buttonText: '계속하기', points: 100, assignment: { mode: 'all', member: 1, role: '조장' }, completion: { mode: 'any', count: 1, member: 1, role: '조장' }, unlock: { mode: 'AND', count: 1, conditions: [] } };
}
export function newRoom(title = '이름 없는 방탈출') {
  return { schemaVersion: VERSION, id: uid(), roomCode: roomCode(), title, description: '', subject: '자유 주제', playMode: 'individual', teamSettings: { teamCount: 4, maxMembers: null, rolesEnabled: false, roles: ['조장', '조원'] }, theme: { color: '#0c766d', background: '', bgm: '' }, rules: { hints: 'unlimited', hintLimit: 3, hintPenalty: 0, wrongPenalty: 0, ranking: 'none', rankVisibility: 'end', scoreEnabled: false, wrongPenaltyType: 'time', hintPenaltyType: 'time', finishMode: 'all', finalBlockId: null, timeLimit: 40 }, successMessage: '모든 단서를 연결했어요. 탈출에 성공했습니다!', content: [newBlock('story')], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
}
export function duplicateRoom(room) {
  const copy = structuredClone(room);
  const ids = new Map(copy.content.map(b => [b.id, uid()]));
  for(const m of copy.qrMissions||[]){ids.set(m.id,uid());for(const q of m.codes)ids.set(q.id,uid());}
  copy.id = uid(); copy.roomCode = roomCode(); copy.title += ' (복사)';
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  if(copy.rules?.finalBlockId)copy.rules.finalBlockId=ids.get(copy.rules.finalBlockId)||null;
  for(const m of copy.qrMissions||[]){m.id=ids.get(m.id);m.result.targetId=ids.get(m.result.targetId)||null;for(const q of m.codes){q.id=ids.get(q.id);q.token=qrToken();}}
  copy.content.forEach(b => { b.id = ids.get(b.id); b.unlock.conditions.forEach(c => { c.blockId = ids.get(c.blockId) || c.blockId; }); });
  return copy;
}
export function safeUrl(value) {
  if (!value) return '';
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
export function validateRoom(room) {
  const errors = [];
  if (!room || typeof room !== 'object' || Array.isArray(room)) return ['올바른 콘텐츠 객체가 아닙니다.'];
  if (room.schemaVersion !== VERSION) errors.push('지원하지 않는 파일 버전입니다.');
  if (typeof room.title !== 'string' || !room.title.trim() || room.title.length > 200) errors.push('제목은 1~200자로 입력하세요.');
  if (!['individual', 'team'].includes(room.playMode)) errors.push('플레이 방식이 올바르지 않습니다.');
  if (!Array.isArray(room.content) || room.content.length > 200) return [...errors, '콘텐츠는 최대 200개까지 지원합니다.'];
  for (const k of ['description', 'subject', 'successMessage']) if (typeof room[k] !== 'string') errors.push('방탈출 설명 형식이 올바르지 않습니다.');
  const ids = new Set(room.content.map(b => b?.id));
  if (ids.size !== room.content.length) errors.push('중복된 블록 ID가 있습니다.');
  const qrKinds=new Map(),tokens=new Set();
  if(room.qrMissions!==undefined&&!Array.isArray(room.qrMissions))return [...errors,'QR 미션 형식이 올바르지 않습니다.'];
  if((room.qrMissions||[]).length>32)errors.push('QR 미션은 최대 32개입니다.');
  for(const m of room.qrMissions||[]){
    if(!m||!Array.isArray(m.codes)||!m.codes.length||m.codes.length>32){errors.push('QR 미션에는 1~32개 QR이 필요합니다.');continue;}
    if(typeof m.name!=='string'||!m.name.trim()||m.name.length>100||typeof m.active!=='boolean'||!['student','team'].includes(m.scope)||!['ANY','ALL','N_OF_M','UNIQUE_MEMBER'].includes(m.mode))errors.push('QR 미션 설정을 확인하세요.');
    if(!m.assignment||!['all','member','role'].includes(m.assignment.mode))errors.push('QR 배정 방식을 확인하세요.');
    if(m.mode==='N_OF_M'&&(!Number.isInteger(m.count)||m.count<1||m.count>m.codes.length))errors.push('QR 필요 개수는 등록 개수 이하여야 합니다.');
    if(m.mode==='UNIQUE_MEMBER'&&(room.playMode!=='team'||m.scope!=='team'||m.assignment.mode!=='all'))errors.push('팀원별 서로 다른 QR은 팀전·팀 전체·모든 팀원 배정에서 사용합니다.');
    if(!m.result||!['condition','unlock'].includes(m.result.type)||m.result.type==='unlock'&&!ids.has(m.result.targetId))errors.push('QR 완료 결과 콘텐츠를 확인하세요.');
    for(const [item,kind] of [[m,'qr_complete'],...m.codes.map(q=>[q,'qr_scanned'])]){
      if(!/^[0-9a-f-]{36}$/.test(item.id||'')||ids.has(item.id)||qrKinds.has(item.id))errors.push('QR ID는 고유해야 합니다.');qrKinds.set(item.id,kind);
      if(kind==='qr_scanned'){if(!/^[a-f0-9]{64}$/.test(item.token||'')||tokens.has(item.token)||typeof item.active!=='boolean'||typeof item.name!=='string'||!item.name.trim())errors.push('QR 이름 또는 식별자를 확인하세요.');tokens.add(item.token);}
    }
  }
  for (const b of room.content) {
    if (!b || !BLOCK_TYPES[b.type] || typeof b.id !== 'string' || typeof b.title !== 'string' || typeof b.body !== 'string') { errors.push('블록 형식이 올바르지 않습니다.'); continue; }
    if (!QUESTION_TYPES[b.questionType]) errors.push('지원하지 않는 문제 유형입니다.');
    for (const k of ['answers', 'options', 'hints']) if (!Array.isArray(b[k]) || b[k].some(v => typeof v !== 'string')) errors.push(`${b.title}: ${k} 형식 오류`);
    if (!b.unlock || !['AND', 'OR', 'N'].includes(b.unlock.mode) || !Array.isArray(b.unlock.conditions)) { errors.push('공개 조건 형식이 올바르지 않습니다.'); continue; }
    for (const c of b.unlock.conditions) {
      if ((!ids.has(c.blockId)&&!qrKinds.has(c.blockId)) || c.blockId === b.id) errors.push(`${b.title}: 존재하지 않거나 자기 자신인 조건입니다.`);
      if (qrKinds.has(c.blockId)?qrKinds.get(c.blockId)!==c.event:!['complete', 'button', 'approved'].includes(c.event)) errors.push('지원하지 않는 조건 이벤트입니다.');
    }
    if (!b.assignment || !['all', 'auto', 'member', 'role'].includes(b.assignment.mode) || !b.completion || !['any', 'all', 'member', 'role', 'n', 'assigned'].includes(b.completion.mode)) errors.push('대상 또는 완료 조건이 올바르지 않습니다.');
    if (!Array.isArray(b.media) || b.media.some(m => !['image', 'audio', 'video'].includes(m.type) || !safeUrl(m.url))) errors.push('미디어에는 올바른 http(s) URL을 사용하세요.');
    if (!b.normalization || !['card', 'full'].includes(b.display) || typeof b.stage !== 'string' || typeof b.buttonText !== 'string') errors.push('블록 표시 설정이 올바르지 않습니다.');
    if (!Number.isFinite(b.points) || b.points < 0) errors.push('문제 점수는 0 이상의 숫자여야 합니다.');
    if (b.unlock.mode === 'N' && (!Number.isInteger(b.unlock.count) || b.unlock.count < 1 || b.unlock.count > b.unlock.conditions.length)) errors.push('필요한 조건 수는 등록된 조건 수 이하여야 합니다.');
  }
  const visiting = new Set(), done = new Set();
  function visit(id) {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    visiting.add(id);
    const b = room.content.find(x => x.id === id);
    if (b?.unlock?.conditions?.some(c => visit(c.blockId))) return true;
    visiting.delete(id); done.add(id); return false;
  }
  if (!errors.length && room.content.some(b => visit(b.id))) errors.push('공개 조건이 순환합니다. 서로를 기다리는 조건을 해제하세요.');
  if (!room.rules || !['unlimited', 'room', 'stage', 'individual', 'team'].includes(room.rules.hints) || !Number.isFinite(room.rules.hintLimit) || room.rules.hintLimit < 0) errors.push('힌트 설정이 올바르지 않습니다.');
  const rules=room.rules||{};
  if(!['none','time','score','time_wrong','time_hint','combined'].includes(rules.ranking||'none')) errors.push('순위 기준을 확인하세요.');
  if(!['live','end','teacher'].includes(rules.rankVisibility||'end')) errors.push('순위 공개 방식을 확인하세요.');
  for(const key of ['wrongPenaltyType','hintPenaltyType']) if(!['none','time','score'].includes(rules[key]||'time')) errors.push('페널티 종류를 확인하세요.');
  if(!['all','final'].includes(rules.finishMode||'all') || rules.finishMode==='final'&&!ids.has(rules.finalBlockId)) errors.push('최종 완료 콘텐츠를 선택하세요.');
  if (room.rules && ['hintPenalty', 'wrongPenalty'].some(k => !Number.isFinite(room.rules[k]) || room.rules[k] < 0)) errors.push('시간 페널티는 0 이상의 숫자여야 합니다.');
  if (!room.teamSettings || !Number.isInteger(room.teamSettings.teamCount) || room.teamSettings.teamCount < 1 || room.teamSettings.teamCount > 20 || !Array.isArray(room.teamSettings.roles)) errors.push('팀 설정이 올바르지 않습니다.');
  if (room.teamSettings && room.teamSettings.maxMembers !== null && (!Number.isInteger(room.teamSettings.maxMembers) || room.teamSettings.maxMembers < 1 || room.teamSettings.maxMembers > 20)) errors.push('팀당 인원은 1~20명 또는 제한 없음으로 설정하세요.');
  if (!room.theme || !/^#[0-9a-f]{6}$/i.test(room.theme.color)) errors.push('테마 색상이 올바르지 않습니다.');
  return [...new Set(errors)];
}
export function parseImport(text) {
  if (text.length > 2_000_000) throw Error('JSON 파일은 2MB 이하여야 합니다.');
  const parsed = JSON.parse(text);
  const errors = validateRoom(parsed);
  if (errors.length) throw Error(errors.join('\n'));
  return duplicateRoom({ ...parsed, title: parsed.title.replace(/ \(복사\)$/, '') });
}
