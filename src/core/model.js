import {validateParallel,parallelIds} from './parallel.js';
import {validateTeamSettings,waitingSettings} from './team-settings.js';
import {validateChat} from './chat.js';
import {classification} from './classification.js';
import {normalizeStages} from './stages.js';
import {normalizePresentation,newDisplaySettings} from './presentation.js';
import {qrToken,newQrMission,ensureManualCodes,manualCode} from './qr.js';
export const VERSION = 1;
export const BLOCK_TYPES = { story: '스토리', question: '문제', guide: '안내' };
export const DISPLAY_TYPES = {card:'일반 카드',theme:'테마 배경',image:'이미지 배경',immersive:'몰입형 스토리'};
export const QUESTION_TYPES = { short: '단답형', number: '숫자형', choice: '객관식', multi: '복수 선택형', ox: 'OX형', order: '순서 배열형', match: '짝맞추기형', cipher: '암호 입력형', switch: '버튼 / 스위치형', condition: '조건 달성형', approval: '교사 승인형', qr: 'QR 스캔형' };
export const uid = () => crypto.randomUUID();
export function roomCode() { return String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000); }
export function newBlock(type = 'question') {
  if(!BLOCK_TYPES[type])throw Error('지원하지 않는 블록 유형입니다.');
  return { id: uid(), type, title: type === 'question' ? '새로운 문제' : `새로운 ${BLOCK_TYPES[type]}`, body: '', stage: '1', questionType: 'short', answers: [], options: ['선택지 1', '선택지 2', '선택지 3'], hints: [], media: [], normalization: { trim: true, spaces: false, case: true, punctuation: false }, display: 'card', buttonText: '계속하기', points: 100, assignment: { mode: 'all', member: 1, role: '조장' }, completion: { mode: 'any', count: 1, member: 1, role: '조장' }, unlock: { mode: 'AND', count: 1, conditions: [] } };
}
export function newRoom(title = '이름 없는 방탈출') {
  return { studentDisplaySettings:newDisplaySettings(), schemaVersion: VERSION, id: uid(), roomCode: roomCode(), title, description: '', subject: '자유 주제', playMode: 'individual', teamSettings: { teamCount: 4, maxMembers: null, rolesEnabled: false, roles: ['조장', '조원'] }, theme: { color: '#0c766d', background: '', bgm: '' }, rules: { delayMinutes:3, hints: 'unlimited', hintLimit: 3, hintPenalty: 0, wrongPenalty: 0, ranking: 'none', rankVisibility: 'end', scoreEnabled: false, wrongPenaltyType: 'time', hintPenaltyType: 'time', finishMode: 'all', finalBlockId: null, timeLimit: 40 }, successMessage: '모든 단서를 연결했어요. 탈출에 성공했습니다!', content: [newBlock('story')], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
}
export function duplicateRoom(room) {
  const copy = normalizeRoom(room);
  const stageIds=new Map(copy.stageGroups.map(g=>[g.id,uid()]));for(const g of copy.stageGroups)g.id=stageIds.get(g.id);for(const b of copy.content)b.stageId=stageIds.get(b.stageId);
  const ids = new Map(copy.content.map(b => [b.id, uid()]));
  const chats=new Map((copy.chatRooms||[]).map(c=>[c.id,uid()]));for(const c of copy.chatRooms||[])c.id=chats.get(c.id);for(const b of copy.content)b.chatRoomIds=(b.chatRoomIds||[]).map(id=>chats.get(id)).filter(Boolean);
  for(const m of copy.qrMissions||[]){ids.set(m.id,uid());for(const q of m.codes)ids.set(q.id,uid());}
  copy.id = uid(); copy.roomCode = roomCode(); while(copy.roomCode===room.roomCode)copy.roomCode=roomCode(); copy.title += ' (사본)';
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  if(copy.rules?.finalBlockId)copy.rules.finalBlockId=ids.get(copy.rules.finalBlockId)||null;
  for(const m of copy.qrMissions||[]){m.id=ids.get(m.id);m.result.targetId=ids.get(m.result.targetId)||null;for(const q of m.codes){q.id=ids.get(q.id);q.token=qrToken();q.manualCode=manualCode();}}
  copy.content.forEach(b => { b.id = ids.get(b.id); if(b.qrId)b.qrId=ids.get(b.qrId)||b.qrId; if(b.qrMissionId)b.qrMissionId=ids.get(b.qrMissionId)||b.qrMissionId; b.unlock.conditions.forEach(c => { c.blockId = ids.get(c.blockId) || c.blockId; }); });
  for(const m of copy.qrMissions||[])if(m.blockId)m.blockId=ids.get(m.blockId)||m.blockId;
  for(const g of copy.parallelGroups||[]){g.id=uid();for(const s of g.steps){s.id=uid();for(const c of s.cells)if(c.blockId)c.blockId=ids.get(c.blockId);}}
  return copy;
}
export function safeUrl(value) {
  if (!value) return '';
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
export function validateRoom(room,emit) {
  const errors = [];let scope=[];const add=(...messages)=>{for(const message of messages){errors.push(message);emit?.(message,scope);}};
  if (!room || typeof room !== 'object' || Array.isArray(room)) return ['올바른 콘텐츠 객체가 아닙니다.'];
  if (room.schemaVersion !== VERSION) add('지원하지 않는 파일 버전입니다.');
  if (typeof room.title !== 'string' || !room.title.trim() || room.title.length > 200) add('제목은 1~200자로 입력하세요.');
  if (!['individual', 'team'].includes(room.playMode)) add('플레이 방식이 올바르지 않습니다.');
  if (!Array.isArray(room.content) || room.content.length > 200) return [...errors, '콘텐츠는 최대 200개까지 지원합니다.'];
  for (const k of ['description', 'subject', 'successMessage']) if (typeof room[k] !== 'string') add('방탈출 설명 형식이 올바르지 않습니다.');
  errors.push(...validateChat(room,emit),...validateTeamSettings(room,emit),...validateParallel(room,emit));
    const ids = new Set(room.content.map(b => b?.id));
  if (ids.size !== room.content.length) add('중복된 블록 ID가 있습니다.');
  const qrKinds=new Map(),tokens=new Set();
  if(room.qrMissions!==undefined&&!Array.isArray(room.qrMissions))return [...errors,'QR 미션 형식이 올바르지 않습니다.'];
  if((room.qrMissions||[]).length>32)add('QR 미션은 최대 32개입니다.');
  for(const m of room.qrMissions||[]){scope=room.content.filter(b=>b.qrMissionId===m?.id||m?.blockId===b.id).map(b=>b.id);
    if(!m||!Array.isArray(m.codes)||!m.codes.length||m.codes.length>32){add('QR 미션에는 1~32개 QR이 필요합니다.');continue;}
    if(typeof m.name!=='string'||!m.name.trim()||m.name.length>100||typeof m.active!=='boolean'||!['student','team'].includes(m.scope)||!['ANY','ALL','N_OF_M','UNIQUE_MEMBER'].includes(m.mode))add('QR 미션 설정을 확인하세요.');
    if(!m.assignment||!['all','member','role'].includes(m.assignment.mode))add('QR 배정 방식을 확인하세요.');
    if(m.mode==='N_OF_M'&&(!Number.isInteger(m.count)||m.count<1||m.count>m.codes.length))add('QR 필요 개수는 등록 개수 이하여야 합니다.');
    if(m.mode==='UNIQUE_MEMBER'&&(room.playMode!=='team'||m.scope!=='team'||m.assignment.mode!=='all'))add('팀원별 서로 다른 QR은 팀전·팀 전체·모든 팀원 배정에서 사용합니다.');
    if(!m.result||!['condition','unlock'].includes(m.result.type)||m.result.type==='unlock'&&!ids.has(m.result.targetId))add('QR 완료 결과 콘텐츠를 확인하세요.');
    for(const [item,kind] of [[m,'qr_complete'],...m.codes.map(q=>[q,'qr_scanned'])]){
      if(!/^[0-9a-f-]{36}$/.test(item.id||'')||ids.has(item.id)||qrKinds.has(item.id))add('QR ID는 고유해야 합니다.');qrKinds.set(item.id,kind);
      if(kind==='qr_scanned'){if(!/^[a-f0-9]{64}$/.test(item.token||'')||tokens.has(item.token)||typeof item.active!=='boolean'||typeof item.name!=='string'||!item.name.trim())add('QR 이름 또는 식별자를 확인하세요.');tokens.add(item.token);}
    }
  }
  for (const b of room.content) {scope=[b?.id].filter(Boolean);
    if (!b || !BLOCK_TYPES[b.type] || ! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.id||'') || typeof b.title !== 'string' || typeof b.body !== 'string') { add('블록 형식이 올바르지 않습니다.'); continue; }
    if (!QUESTION_TYPES[b.questionType]) add('지원하지 않는 문제 유형입니다.');
    if(b.type==='question'&&b.questionType==='qr'&&((b.qrMissionId?qrKinds.get(b.qrMissionId)!=='qr_complete':qrKinds.get(b.qrId)!=='qr_scanned')||!['student','team'].includes(b.qrScope))) add(`${b.title}: QR과 완료 범위를 선택하세요.`);
    for (const k of ['answers', 'options', 'hints']) if (!Array.isArray(b[k]) || b[k].some(v => typeof v !== 'string')) add(`${b.title}: ${k} 형식 오류`);
    if (!b.unlock || !['AND', 'OR', 'N'].includes(b.unlock.mode) || !Array.isArray(b.unlock.conditions)) { add('공개 조건 형식이 올바르지 않습니다.'); continue; }
    for (const c of b.unlock.conditions) {
      if ((!ids.has(c.blockId)&&!qrKinds.has(c.blockId)) || c.blockId === b.id) add(`${b.title}: 존재하지 않거나 자기 자신인 조건입니다.`);
      if (qrKinds.has(c.blockId)?qrKinds.get(c.blockId)!==c.event:!['complete', 'button', 'approved'].includes(c.event)) add('지원하지 않는 조건 이벤트입니다.');
    }
    if (!b.assignment || !['all', 'auto', 'member', 'role'].includes(b.assignment.mode) || !b.completion || !['any', 'all', 'member', 'role', 'n', 'assigned'].includes(b.completion.mode)) add('대상 또는 완료 조건이 올바르지 않습니다.');
    if (!Array.isArray(b.media) || b.media.some(m => !['image', 'audio', 'video'].includes(m.type))) add('미디어에는 올바른 http(s) URL을 사용하세요.');
    if (!b.normalization || !['card', 'theme', 'image','full','immersive'].includes(b.display) || typeof b.stage !== 'string' || typeof b.buttonText !== 'string') add(`${b.title}: 블록 표시 설정이 올바르지 않습니다.`);
    if(b.display==='immersive'&&b.type!=='story')add(`${b.title}: 몰입형 표시는 스토리에서만 사용합니다.`);
    if (!Number.isFinite(b.points) || b.points < 0) add('문제 점수는 0 이상의 숫자여야 합니다.');
    if (b.unlock.mode === 'N' && (!Number.isInteger(b.unlock.count) || b.unlock.count < 1 || b.unlock.count > b.unlock.conditions.length)) add('필요한 조건 수는 등록된 조건 수 이하여야 합니다.');
  }
  scope=[];const visiting = new Set(), done = new Set();
  function visit(id) {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    visiting.add(id);
    const b = room.content.find(x => x.id === id);
    if (b?.unlock?.conditions?.some(c => visit((room.qrMissions||[]).find(m=>m.id===c.blockId||m.codes.some(q=>q.id===c.blockId))?.blockId||c.blockId))) return true;
    visiting.delete(id); done.add(id); return false;
  }
  if (!errors.length && room.content.some(b => visit(b.id))) {scope=[...visiting];add('공개 조건이 순환합니다. 서로를 기다리는 조건을 해제하세요.');}scope=[];
  if (!room.rules || !['unlimited', 'room', 'stage', 'individual', 'team'].includes(room.rules.hints) || !Number.isFinite(room.rules.hintLimit) || room.rules.hintLimit < 0) add('힌트 설정이 올바르지 않습니다.');
  const rules=room.rules||{};
  if(!['none','time','score','time_wrong','time_hint','combined'].includes(rules.ranking||'none')) add('순위 기준을 확인하세요.');
  if(!['live','end','teacher'].includes(rules.rankVisibility||'end')) add('순위 공개 방식을 확인하세요.');
  for(const key of ['wrongPenaltyType','hintPenaltyType']) if(!['none','time','score'].includes(rules[key]||'time')) add('페널티 종류를 확인하세요.');
  if(!['all','final'].includes(rules.finishMode||'all') || rules.finishMode==='final'&&!ids.has(rules.finalBlockId)) add('최종 완료 콘텐츠를 선택하세요.');
  if (room.rules && ['hintPenalty', 'wrongPenalty'].some(k => !Number.isFinite(room.rules[k]) || room.rules[k] < 0)) add('시간 페널티는 0 이상의 숫자여야 합니다.');
  if (!room.teamSettings || !Number.isInteger(room.teamSettings.teamCount) || room.teamSettings.teamCount < 1 || room.teamSettings.teamCount > 20 || !Array.isArray(room.teamSettings.roles)) add('팀 설정이 올바르지 않습니다.');
  if (room.teamSettings && room.teamSettings.maxMembers !== null && (!Number.isInteger(room.teamSettings.maxMembers) || room.teamSettings.maxMembers < 1 || room.teamSettings.maxMembers > 20)) add('팀당 인원은 1~20명 또는 제한 없음으로 설정하세요.');
  if (!room.theme || !/^#[0-9a-f]{6}$/i.test(room.theme.color)) add('테마 색상이 올바르지 않습니다.');
  if(room.design&&(!['auto','light','dark'].includes(room.design.text)||!['light','dark','glass'].includes(room.design.card)||!/^#[a-f0-9]{6}$/i.test(room.design.backgroundColor)))add('화면 디자인 설정을 확인하세요.');
  if(room.sound&&(!Number.isFinite(room.sound.volume)||room.sound.volume<0||room.sound.volume>1||typeof room.sound.allowMute!=='boolean'))add('음악 설정을 확인하세요.');
  if(room.studentDisplaySettings&&Object.values(room.studentDisplaySettings).some(v=>!['always','info','hidden'].includes(v)))add('학생 표시 설정을 확인하세요.');
  if(room.rules?.delayMinutes!==undefined&&(!Number.isInteger(room.rules.delayMinutes)||room.rules.delayMinutes<0||room.rules.delayMinutes>10))add('진행 지연 기준은 0(OFF) 또는 1~10분입니다.');
  if(room.stageGroups&&(!Array.isArray(room.stageGroups)||new Set(room.stageGroups.map(g=>g.id)).size!==room.stageGroups.length))add('스테이지 ID를 확인하세요.');
  return [...new Set(errors)];
}
export function parseImport(text) {
  if (text.length > 2_000_000) throw Error('JSON 파일은 2MB 이하여야 합니다.');
  const parsed = JSON.parse(text);
  const errors = validateDraft(parsed);
  if (errors.length) throw Error(errors.join('\n'));
  return duplicateRoom({ ...parsed, title: parsed.title.replace(/ \((?:복사|사본)\)$/, '') });
}

// Draft normalization is local/on-save only. Running session snapshots are not rewritten.
export function normalizeRoom(value) {
  const r=structuredClone(value);
  if(!r||!Array.isArray(r.content))return r;
  const removed=new Set(r.content.filter(b=>b?.type==='wait').map(b=>b.id));
  r.content=r.content.filter(b=>b?.type!=='wait');
  for(const b of r.content){
    b.media=(b.media||[]).filter(m=>String(m.url||'').trim()!=='');
    const before=b.unlock.conditions.length;b.unlock.conditions=b.unlock.conditions.filter(c=>!removed.has(c.blockId));
    if(before!==b.unlock.conditions.length&&b.unlock.mode==='N'){b.unlock.count=Math.min(b.unlock.count,b.unlock.conditions.length);if(!b.unlock.conditions.length){b.unlock.mode='AND';b.unlock.count=1;}}
    if(b.display==='full')b.display='theme';
    if(b.type==='story'&&b.immersiveOverlay===undefined)b.immersiveOverlay=true;
    if(b.type==='question'&&b.questionType==='qr')ensureBlockQr(r,b);
  }
  // Existing standalone missions become actual QR questions without replacing printed tokens.
  for(const m of r.qrMissions||[])if(!m.blockId){
    const b=newBlock();Object.assign(b,{title:m.name,body:'QR 단서를 찾아 스캔하세요.',questionType:'qr',qrMissionId:m.id,qrScope:m.scope,assignment:structuredClone(m.assignment)});
    m.blockId=b.id;
    const refs=new Set([m.id,...m.codes.map(q=>q.id)]),at=r.content.findIndex(x=>x.unlock.conditions.some(c=>refs.has(c.blockId)));
    r.content.splice(at<0?r.content.length:at,0,b);
  }
  if(removed.has(r.rules?.finalBlockId)){r.rules.finalBlockId=null;r.rules.finishMode='all';}
  for(const m of r.qrMissions||[])if(removed.has(m.result?.targetId))m.result={type:'condition',targetId:null};
  r.teamSettings.waiting=waitingSettings(r);
  r.metadata=classification(r);r.rules.delayMinutes??=3;
  return normalizePresentation(normalizeStages(ensureManualCodes(r)));
}
export function ensureBlockQr(room,b) {
  room.qrMissions??=[];
  let m=room.qrMissions.find(m=>m.id===b.qrMissionId);
  if(!m){
    const old=room.qrMissions.find(m=>m.codes.some(q=>q.id===b.qrId));
    // Adopt the existing QR group without discarding its codes or completion predicate.
    if(old&&!old.blockId){m=old;}
    else {m=newQrMission();if(old){m.codes=old.codes.filter(q=>q.id===b.qrId).map(q=>({...q,id:uid(),token:qrToken()}));}room.qrMissions.push(m);}
    b.qrMissionId=m.id;
  }
  m.blockId=b.id;m.scope=b.qrScope||'student';b.qrScope=m.scope;
  if(m.assignment?.mode!=='all'&&b.assignment.mode==='all')b.assignment=structuredClone(m.assignment);
  m.name=b.title||'QR 문제';m.result={type:'condition',targetId:null};m.assignment={mode:'all',member:1,role:'조장'};
  ensureManualCodes(room);return m;
}
export function validateDraft(r) {
  if(!r||r.schemaVersion!==VERSION||!Array.isArray(r.content)||r.content.length>200)return ['저장 가능한 콘텐츠 형식이 아닙니다.'];
  if(!/^[0-9a-f-]{36}$/.test(r.id||'')||!/^\d{6}$/.test(r.roomCode||''))return ['콘텐츠 ID 또는 방 코드 형식이 올바르지 않습니다.'];
  if(typeof r.title!=='string'||!r.title.trim()||r.title.length>200)return ['제목은 1~200자로 입력하세요.'];
  if(!r.rules||!r.teamSettings||!r.theme)return ['콘텐츠 기본 설정이 없습니다.'];
  const ids=new Set();
  for(const b of r.content){
    if(!b||typeof b.id!=='string'||ids.has(b.id)||!['story','guide','question','wait'].includes(b.type)||!b.unlock||!Array.isArray(b.unlock.conditions)||!b.assignment||!b.completion||!b.normalization||!['answers','options','hints','media'].every(k=>Array.isArray(b[k])))return ['블록 데이터 구조가 올바르지 않습니다.'];
    ids.add(b.id);
  }
  if(r.qrMissions!==undefined&&(!Array.isArray(r.qrMissions)||r.qrMissions.some(m=>!m||!Array.isArray(m.codes)||!m.assignment||!m.result)))return ['QR 데이터 구조가 올바르지 않습니다.'];
  if(r.parallelGroups!==undefined&&(!Array.isArray(r.parallelGroups)||r.parallelGroups.some(g=>!g||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g.id||'')||!Array.isArray(g.lanes)||g.lanes.length!==2||g.lanes.some(l=>!l)||!Array.isArray(g.steps)||!g.steps.length||g.steps.some((s,n)=>!Array.isArray(s?.cells)||s.cells.length!==2||s.cells.some(c=>!c||(c.hold?n===0:!ids.has(c.blockId)))))))return ['병렬 데이터 구조가 올바르지 않습니다.'];
  if(JSON.stringify(r).length>2_000_000)return ['콘텐츠는 2MB 이하여야 합니다.'];
  return [];
}
export function validateForPlay(value,emit) {
  const basic=validateDraft(value);if(basic.length){for(const msg of basic)emit?.(msg,msg.includes('병렬')?(value.content||[]).filter(b=>(value.parallelGroups||[]).some?.(g=>parallelIds(g).includes(b.id))).map(b=>b.id):[]);return basic;}
  const r=normalizeRoom(value);
  r.qrMissions=(r.qrMissions||[]).filter(m=>r.content.some(b=>b.type==='question'&&b.questionType==='qr'&&b.qrMissionId===m.id));
  const errors=validateRoom(r,emit);let scope=[];const add=(message)=>{errors.push(message);emit?.(message,scope);};
  if(r.qrBaseUrl&&!safeUrl(r.qrBaseUrl))add('QR 배포 사이트 주소를 올바른 http(s) URL로 입력하세요.');
  if(!r.content.length)add('실행할 콘텐츠를 하나 이상 추가하세요.');
  for(const b of r.content){scope=[b.id];
    const label=`${r.content.indexOf(b)+1}. ${b.title||'제목 없는 블록'}`;
    if(b.type==='question'){
      if(['choice','multi','order','match'].includes(b.questionType)&&b.options.length<2)add(`${label}: 선택지 또는 연결 항목을 2개 이상 입력하세요.`);
      if(!['qr','switch','condition','approval'].includes(b.questionType)&&!b.answers.some(a=>a.trim()))add(`${label}: 정답을 입력하세요.`);
      if(['choice','multi','order'].includes(b.questionType)&&b.answers.some(a=>!b.options.includes(a)))add(`${label}: 정답과 선택지를 확인하세요.`);
      if(['order','match'].includes(b.questionType)&&b.answers.length!==b.options.length)add(`${label}: 정답과 항목 개수를 맞추세요.`);
      if(b.questionType==='qr'){
        const m=r.qrMissions.find(m=>m.id===b.qrMissionId),active=m?.codes.filter(q=>q.active)||[];
        if(!m?.active||!active.length)add(`${label}: 활성 QR을 하나 이상 등록하세요.`);
        if(m?.mode==='N_OF_M'&&m.count>active.length)add(`${label}: 필요한 QR 수가 활성 QR 수보다 많습니다.`);
      }
    }
    for(const c of b.unlock.conditions)if(!r.content.some(x=>x.id===c.blockId)&&!(r.qrMissions||[]).some(m=>m.id===c.blockId||m.codes.some(q=>q.id===c.blockId)))add(`${label}: 공개 조건의 대상을 선택하세요.`);
  }
  return [...new Set(errors)];
}

// Warning cleanup applies to a play copy, never the author's document.
export function inspectForPlay(value) {
  const issues=[];const errors=validateForPlay(value,(message,blockIds)=>issues.push({severity:'error',message,blockIds})),warnings=[];const warn=(message,blockIds=[])=>{warnings.push(message);issues.push({severity:'warning',message,blockIds});};
  for(const [i,b] of (value?.content||[]).entries()){
    const label=`${i+1}. ${b.title||'제목 없는 블록'}`;
    if(['image','immersive'].includes(b.display)&&!safeAssetUrl(b.backgroundUrl))warn(`${label}: 배경 이미지를 사용할 수 없습니다.`,[b.id]);
    for(const m of b.media||[])if(m.url&&!safeAssetUrl(m.url))warn(`${label}: ${{image:'이미지',video:'영상',audio:'음성'}[m.type]||'외부'} 자료를 사용할 수 없습니다.`,[b.id]);
    const mission=(Array.isArray(value.qrMissions)?value.qrMissions:[]).find(m=>m.id===b.qrMissionId);
    if(b.questionType==='qr'&&mission?.mode==='UNIQUE_MEMBER'&&value.playMode==='team'&&Number.isInteger(value.teamSettings?.maxMembers)&&mission.codes?.filter(q=>q.active).length<value.teamSettings.maxMembers)warn(`${label}: 활성 QR 수가 조별 최대 인원보다 적습니다. 실제 참여 팀원 수 이상의 QR이 필요합니다.`,[b.id]);
  }
  for(const [key,label] of [['background','기본 배경 이미지'],['bgm','배경음악']])if(value?.theme?.[key]&&!safeAssetUrl(value.theme[key]))warn(`${label}를 사용할 수 없습니다.`);
  for(const message of errors)if(!issues.some(i=>i.severity==='error'&&i.message===message))issues.push({severity:'error',message,blockIds:[]});
  const byBlock=Object.fromEntries((value?.content||[]).map(b=>[b.id,issues.filter(i=>i.blockIds.includes(b.id))]));return {errors,warnings,issues,byBlock};
}
export function safeAssetUrl(value){return /^https?:\/\/[^\s/?#]+([/?#][^\s]*)?$/i.test(String(value||''))&&safeUrl(value)?safeUrl(value):'';}
export function preparePlayRoom(value,failedAssets=[]) {
  const r=normalizeRoom(value);
  for(const k of ['background','bgm'])if(!safeAssetUrl(r.theme[k])||failedAssets.includes(r.theme[k]))r.theme[k]='';
  for(const b of r.content){
    b.media=b.media.filter(m=>safeAssetUrl(m.url)&&!failedAssets.includes(m.url));
    if(['image','immersive'].includes(b.display)&&(!safeAssetUrl(b.backgroundUrl)||failedAssets.includes(b.backgroundUrl))){b.backgroundUrl='';if(b.display==='image')b.display='theme';}
  }
  return r;
}
export function displayTypesFor(type){return Object.fromEntries(Object.entries(DISPLAY_TYPES).filter(([key])=>key!=='immersive'||type==='story'));}
