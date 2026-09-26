import {renderStudentInfo,mountBgm} from './student-info.js';
import {isImmersive,immersiveHtml,mountImmersive} from './immersive.js';
import {mountAssetFallback} from './asset-fallback.js';
import {displayAttributes} from './display.js';
import {canRun,approvedAssetFailures} from './validation.js';
import {scanTestQr,qrTestState} from '../core/qr.js';
import {qrProgressHtml,scanQrDialog} from './qr.js';
import { esc, icon, button, options, toast, formatTime, confirmDialog } from './dom.js';
import { mediaHtml } from './media.js';
import { BLOCK_TYPES,preparePlayRoom } from '../core/model.js';
import { isUnlocked } from '../core/conditions.js';
import { createTestSession, blockCompleted, blockAvailable, recordComplete, submitTestQr, submitAnswer, revealHint, sessionSummary } from '../core/session.js';

export async function renderPlayer(root, app, roomId, startId) {
  let room = (await app.repo.list()).find(r => r.id === roomId); if (!room) throw Error('방탈출을 찾을 수 없습니다.');
  if(!await canRun(room)){root.innerHTML='<a class="btn" href="#/editor/'+room.id+'">제작기로 돌아가기</a>';return;}
  room=preparePlayRoom(room,approvedAssetFailures(room));
  const bgm=mountBgm(root,room.theme,room.sound);
  const key = `escape-studio:test:${room.id}`;
  let session, member = 1, showAnswers = false, message = '', selectedId = startId;
  try { session = JSON.parse(sessionStorage.getItem(key)); } catch { /* A damaged test can safely start fresh. */ }
  if (!session || session.contentRevision !== room.updatedAt || (startId && session.startBlockId !== startId)) {
    session = createTestSession(room, Date.now(), Math.min(4, room.teamSettings.maxMembers || 4));
    session.startBlockId = startId || null;
    if (startId) for (const block of room.content.slice(0, room.content.findIndex(b => b.id === startId))) for (const m of session.members) recordComplete(room, session, block, m.member, 'test-start');
  }
  member = session.activeMember || 1;
  const persist = () => { try { session.activeMember = member; sessionStorage.setItem(key, JSON.stringify(session)); } catch { toast('테스트 기록을 저장할 수 없습니다. 새로고침하면 진행이 사라질 수 있습니다.', true); } };
  const current = () => room.content.find(b => b.id === selectedId && blockAvailable(room, session, b, member)) || room.content.find(b => blockAvailable(room, session, b, member) && !session.events.some(e => e.type === 'complete' && e.blockId === b.id && e.member === member));
  function answerControls(b) {
    const type = b.questionType;
    if (b.type !== 'question') return `<button class="btn primary wide" type="submit">${esc(b.buttonText || '계속하기')}${icon('arrow')}</button>`;
    if(type==='qr')return '<button class="btn primary wide" type="button" data-test-question-qr>QR 코드 스캔</button>';
    if (['approval', 'condition'].includes(type)) return `<p class="callout">${type === 'approval' ? '실제 활동을 마친 뒤 선생님의 승인을 기다려주세요. 테스트 도구에서 가상 승인할 수 있습니다.' : '공개 조건을 모두 충족했습니다.'}</p>${type === 'condition' ? '<button class="btn primary wide" type="submit">조건 확인하고 계속하기</button>' : ''}`;
    if (type === 'switch') return '<button class="btn primary wide" type="submit">스위치 작동하기</button>';
    let controls = '';
    if (['choice', 'multi', 'ox'].includes(type)) controls = `<div class="answer-options">${(type === 'ox' ? ['O', 'X'] : b.options).map((o, i) => `<label class="answer-option"><input type="${type === 'multi' ? 'checkbox' : 'radio'}" name="answer" value="${esc(o)}" ${type !== 'multi' ? 'required' : ''}><span class="option-index">${i + 1}</span><span>${esc(o)}</span></label>`).join('')}</div>`;
    else if (type === 'order') controls = `<p class="muted">각 순서에 해당하는 항목을 선택하세요.</p>${b.options.map((_, i) => `<label class="match-row"><span>${i + 1}번째</span><select name="answer" required><option value="">선택하세요</option>${options(Object.fromEntries(b.options.map(o => [o, o])), '')}</select></label>`).join('')}`;
    else if (type === 'match') controls = b.options.map(o => `<label class="match-row"><span>${esc(o)}</span><select name="answer" required><option value="">연결할 항목</option>${options(Object.fromEntries([...b.answers].sort().map(a => [a, a])), '')}</select></label>`).join('');
    else controls = `<label class="field"><span>${type === 'cipher' ? '암호' : '정답'}</span><input name="answer" placeholder="${type === 'cipher' ? '암호를 입력하세요' : '정답을 입력하세요'}" type="${type === 'number' ? 'number' : 'text'}" ${type === 'number' ? 'step="any"' : ''} autocomplete="off" required></label>`;
    return `${controls}<button class="btn primary wide" type="submit">정답 확인 ${icon('arrow')}</button>`;
  }
  const infoContext=()=>{const b=current(),summary=sessionSummary(room,session,Date.now(),member);return {...room,current:b,stageName:room.stageGroups.find(g=>g.id===b?.stageId)?.name,studentName:`테스트 학생 ${member}`,team:room.playMode==='team'?1:null,connection:'제작자 테스트',elapsedMs:summary.seconds*1000,progress:{completedCount:summary.completed,totalCount:room.content.length,role:session.members.find(m=>m.member===member)?.role},displayStats:{timeLimit:room.rules.timeLimit,score:room.rules.scoreEnabled?summary.score:null,wrongCount:summary.wrong,hintsUsed:summary.hints,hintsRemaining:room.rules.hints==='unlimited'?null:Math.max(0,room.rules.hintLimit-summary.hints),penaltySeconds:summary.penalty,penaltyPoints:(room.rules.wrongPenaltyType==='score'?summary.wrong*room.rules.wrongPenalty:0)+(room.rules.hintPenaltyType==='score'?summary.hints*room.rules.hintPenalty:0)}};};
  function draw() {
    const b = current(), summary = sessionSummary(room, session, Date.now(), member), progress = room.content.length ? Math.round(summary.completed / room.content.length * 100) : 0;
    root.innerHTML = `<div class="test-header"><div class="actions">${button('제작기로 돌아가기', 'back', '', 'back')}<span class="pill">제작자 전용 테스트</span></div><p>학생 기록과 순위에 포함되지 않습니다.</p></div><div class="test-layout"><section class="player-stage student-presented" style="--room-color:${room.theme.color}"><div id="student-meta"></div><div class="player-top"><span>${icon('key')} ${esc(room.title)}</span><span class="timer">${icon('clock')}<strong id="timer">${formatTime(summary.seconds)}</strong></span></div><div class="progress-track"><div style="width:${progress}%"></div></div>${session.finishedAt ? `<div class="result"><div class="result-icon">${icon('check')}</div><span class="eyebrow">MISSION COMPLETE</span><h1>탈출 성공!</h1><p>${esc(room.successMessage)}</p><div class="result-stats"><div><strong>${formatTime(summary.seconds)}</strong><span>소요 시간</span></div><div><strong>${summary.score}</strong><span>점수</span></div><div><strong>${summary.wrong}회</strong><span>오답</span></div><div><strong>${summary.hints}회</strong><span>힌트</span></div></div><p class="muted">시간 페널티 ${summary.penalty}초 · 테스트 결과</p>${button('다시 테스트', 'reset', 'primary')}</div>` : b ? `<article ${displayAttributes(b,room.theme,room.design)}><div class="content-body"><div data-block-meta><div class="eyebrow">STAGE ${esc(b.stage)} <span> / </span> ${BLOCK_TYPES[b.type]}</div><h1>${esc(b.title)}</h1></div><p class="pre-line story-body">${esc(b.body)}</p>${mediaHtml(b.media)}<form id="answer-form">${answerControls(b)}</form><p class="answer-message ${message.startsWith('정답') ? 'success-text' : ''}" role="status">${esc(message)}</p>${b.hints.length ? `<div class="hints-area">${button(`힌트 확인 (${session.hints[`${member}:${b.id}`] || 0}/${b.hints.length})`, 'hint', '', 'guide')}${b.hints.slice(0, session.hints[`${member}:${b.id}`] || 0).map((h, i) => `<p class="hint">${i + 1}. ${esc(h)}</p>`).join('')}</div>` : ''}</div></article>` : `<div class="empty player-wait">${icon('wait')}<h2>${room.content.length ? '함께 열어야 하는 문이에요' : '아직 콘텐츠가 없어요'}</h2><p>${room.content.length ? '다른 팀원이나 공개 조건을 기다리고 있습니다. 테스트 도구에서 참가자 시점을 바꾸거나 가상 완료 이벤트를 추가해보세요.' : '제작기로 돌아가 첫 번째 콘텐츠를 추가하세요.'}</p></div>`}</section><aside class="test-tools panel"><span class="eyebrow">PLAYTEST TOOLS</span><h2>테스트 도구</h2><label class="field"><span>참가자 시점</span><select id="test-member">${options(Object.fromEntries(session.members.map(m => [m.member, `member${m.member} · ${m.role}`])), String(member))}</select></label>${room.playMode === 'team' ? `<label class="field"><span>가상 팀원 수 (변경 시 테스트 초기화)</span><select id="member-count">${options(Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].filter(n => !room.teamSettings.maxMembers || n <= room.teamSettings.maxMembers).map(n => [n, `${n}명`])), String(session.members.length))}</select></label>` : ''}<div class="test-stats"><span>진행 <strong>${summary.completed}/${room.content.length}</strong></span><span>오답 <strong>${summary.wrong}회</strong></span><span>힌트 <strong>${summary.hints}회</strong></span></div><div class="test-block-list">${room.content.map((block, i) => `<button class="test-block ${b?.id === block.id ? 'active' : ''}" data-jump="${block.id}" ${!blockAvailable(room, session, block, member) ? 'disabled' : ''}><span>${blockCompleted(room, session, block, member) ? icon('check') : isUnlocked(block.unlock, session.events) ? String(i + 1).padStart(2, '0') : icon('wait')}</span>${esc(block.title)}</button>`).join('')}</div><hr><h3>협동 조건 시뮬레이션</h3><p class="muted">현재 참가자가 콘텐츠를 완료한 상황을 가정합니다.</p><label class="field"><span>가상으로 완료할 콘텐츠</span><select id="simulate-block">${options(Object.fromEntries(room.content.map(block => [block.id, block.title])), b?.id)}</select></label>${button('현재 참가자 가상 완료 / 승인', 'simulate', 'wide', 'check')}${button(showAnswers ? '정답 감추기' : '정답 보기', 'answers', 'wide', 'key')}${showAnswers ? `<div class="answer-reveal">${b ? esc(b.answers.join(' / ') || '입력 정답이 없는 콘텐츠입니다.') : '현재 선택된 문제가 없습니다.'}</div>` : ''}${button('테스트 초기화', 'reset', 'wide')}
    <details class="event-log"><summary>조건 이벤트 기록 (${session.events.length})</summary>${session.events.slice(-30).reverse().map(event => `<p><strong>member${event.member}</strong> · ${esc(room.content.find(x => x.id === event.blockId)?.title)}<br>${esc(event.type)} · ${esc(event.source)}</p>`).join('') || '<p>아직 발생한 이벤트가 없습니다.</p>'}</details><p class="test-note">타이머는 이 기기의 시각을 사용합니다. 실제 수업의 서버 타이머는 다음 단계에서 연결됩니다.</p></aside></div>`;
    if(isImmersive(b)&&!session.finishedAt){
      root.querySelector('.player-stage').insertAdjacentHTML('beforeend',immersiveHtml(b,{infoHtml:'',title:room.title,progress:`진행 ${summary.completed}/${room.content.length}`,time:formatTime(summary.seconds),connection:'제작자 전용 테스트',extra:`<a class="btn" href="#/editor/${room.id}">제작기로 돌아가기</a><button type="button" data-scene-tools class="btn">테스트 도구 보기</button>`}));
      mountImmersive(root,()=>{const result=submitAnswer(room,session,b,member,null);if(!result.ok)throw Error(result.message);selectedId=null;persist();draw();});
      root.querySelector('[data-scene-tools]').onclick=()=>{root.querySelector('.immersive-scene').remove();};
    }
    renderStudentInfo(root,infoContext());bgm.update(session.finishedAt?'finished':'playing');mountAssetFallback(root);
    if(b?.type==='question'&&b.questionType==='qr')root.querySelector('.test-tools').insertAdjacentHTML('beforeend',qrProgressHtml(qrTestState(room,session,member).filter(m=>m.id===b.qrMissionId))+`<h3>현재 문제 QR 가상 스캔</h3>${(room.qrMissions||[]).filter(m=>m.id===b.qrMissionId&&m.active).flatMap(m=>m.codes.filter(q=>q.active).map(q=>`<button class="btn wide" data-sim-qr="${q.id}">${esc(q.name)} 스캔 처리</button>`)).join('')}`);
    root.querySelector('#test-member').onchange = e => { member = Number(e.target.value); message = ''; selectedId = null; persist(); draw(); };
    root.querySelector('#member-count')?.addEventListener('change', async e => { const n = Number(e.target.value); if (await confirmDialog('가상 팀원 수를 바꿀까요?', '현재 테스트 기록이 초기화됩니다. 원본 콘텐츠는 유지됩니다.', '변경')) { session = createTestSession(room, Date.now(), n); member = 1; selectedId = null; message = ''; persist(); } draw(); });
    root.querySelector('#answer-form')?.addEventListener('submit', e => { e.preventDefault(); const data = new FormData(e.target), input = b.questionType === 'switch' ? true : ['multi', 'order', 'match'].includes(b.questionType) ? data.getAll('answer') : data.get('answer'); const result = submitAnswer(room, session, b, member, input); message = result.ok ? (b.type === 'question' ? '정답이에요! 다음 단서를 살펴보세요.' : '') : result.message; if (result.ok) selectedId = null; persist(); draw(); });
    root.onclick = async e => {
      const qr=e.target.closest('[data-sim-qr]');if(qr){try{if(b?.type==='question'&&b.questionType==='qr'){submitTestQr(room,session,b,member,qr.dataset.simQr);selectedId=null;}else scanTestQr(room,session,member,qr.dataset.simQr);persist();draw();}catch(error){toast(error.message,true);}return;}
      if(e.target.closest('[data-test-question-qr]')){await scanQrDialog(null,async token=>{const q=(room.qrMissions||[]).flatMap(m=>m.codes).find(q=>q.token===token);submitTestQr(room,session,b,member,q?.id);selectedId=null;persist();draw();return {keepOpen:!blockCompleted(room,session,b,member),message:'QR 단서를 발견했습니다.'};});return;}
      const jump = e.target.closest('[data-jump]'); if (jump) { selectedId = jump.dataset.jump; message = ''; draw(); return; }
      switch (e.target.closest('[data-action]')?.dataset.action) {
        case 'back': app.navigate(`editor/${room.id}`); break;
        case 'answers': showAnswers = !showAnswers; draw(); break;
        case 'hint': try { revealHint(room, session, b, member); persist(); draw(); } catch (err) { toast(err.message, true); } break;
        case 'simulate': { const target = room.content.find(x => x.id === root.querySelector('#simulate-block').value); if (target) { recordComplete(room, session, target, member, 'teacher-test'); selectedId = null; persist(); draw(); toast('가상 완료 이벤트를 추가했습니다.'); } break; }
        case 'reset': if (await confirmDialog('테스트를 초기화할까요?', '가상 진행·오답·힌트·타이머만 초기화됩니다. 원본 콘텐츠는 유지됩니다.', '초기화')) { session = createTestSession(room, Date.now(), session.members.length); member = 1; selectedId = null; message = ''; persist(); draw(); } break;
      }
    };
  }
  draw(); persist();
  const interval = setInterval(() => { const el = root.querySelector('#timer'); const text=formatTime(sessionSummary(room, session, Date.now(), member).seconds);if(el)el.textContent=text;renderStudentInfo(root,infoContext());const info=root.querySelector('[data-scene-time]');if(info)info.textContent=text; }, 1000);
  app.cleanup = async () => { clearInterval(interval);bgm.dispose(); root.onclick = null; return true; };
}
