import {qrLibrary} from './qr.js';
import {normalizeRoom,safeUrl} from '../core/model.js';
import {canRun,approvedAssetFailures} from './validation.js';
import { LobbyClient, codeFromUrl, studentJoinUrl } from '../data/lobby.js';
import { watchLobby } from '../data/realtime.js';
import { esc, field, confirmDialog } from './dom.js';
import { mountLiveGame } from './live-play.js';
import { LivePlayClient } from '../data/play.js';
import { resetChoice } from './results.js';

const statusNames = { lobby: '입장 대기 중', playing: '게임 진행 중', paused: '일시정지', finished: '종료됨' };
function identityFields(p = {}) {
  return `<div class="identity-grid">${field('학년', `<input name="grade" type="number" min="1" max="12" required value="${esc(p.grade || '')}">`)}${field('반', `<input name="classroom" type="number" min="1" max="99" required value="${esc(p.classroom || '')}">`)}${field('번호', `<input name="number" type="number" min="1" max="999" required value="${esc(p.number || '')}">`)}</div>${field('이름', `<input name="name" maxlength="40" required autocomplete="name" value="${esc(p.name || '')}">`)}`;
}
function identityFrom(form) { const d = new FormData(form); return { p_grade: Number(d.get('grade')), p_class: Number(d.get('classroom')), p_number: Number(d.get('number')), p_name: String(d.get('name')).trim() }; }
function rosterHtml(state, isTeacher) {
  const rows = state.participants;
  const person = p => `<li><span>${p.grade}-${p.classroom}-${p.number} <strong>${esc(p.name)}</strong>${p.id === state.participantId ? ' <small>나</small>' : ''}</span><small>${Date.parse(state.serverNow) - Date.parse(p.lastSeenAt) > 75000 ? '연결 끊김' : '접속 중'}</small></li>`;
  const myTeam = rows.find(p => p.id === state.participantId)?.team;
  if (state.playMode === 'individual') return `<section class="panel"><h2>참여 학생 ${rows.length}명</h2><ul class="lobby-roster">${rows.map(person).join('') || '<li>첫 학생을 기다리고 있어요.</li>'}</ul></section>`;
  return `<h2>참여 학생 ${rows.length}명 · 전체 조 편성</h2><div class="teams-grid">${Array.from({ length: state.teamCount }, (_, i) => {
    const number = i + 1, members = rows.filter(p => p.team === number), full = state.maxMembers !== null && members.length >= state.maxMembers;
    return `<section class="panel team-panel ${myTeam === number ? 'my-team' : ''}"><h3>${number}조 <small>${members.length}${state.maxMembers ? '/' + state.maxMembers : ''}명</small></h3><ul class="lobby-roster">${members.map(person).join('') || '<li>아직 참가자가 없어요.</li>'}</ul>${!isTeacher && state.status === 'lobby' ? `<button class="btn ${myTeam === number ? '' : 'primary'}" data-team="${number}" ${full || myTeam === number ? 'disabled' : ''}>${myTeam === number ? '참가 중' : full ? '정원 마감' : number + '조 참가'}</button>` : ''}</section>`;
  }).join('')}</div><section class="panel"><h3>조 선택 대기</h3><ul class="lobby-roster">${rows.filter(p => !p.team).map(person).join('') || '<li>모두 조를 선택했어요.</li>'}</ul></section>`;
}

function mountLive(root, app, client, initial, { code, teacher = false, contentId } = {}) {
  const playOptions = { code, teacher, contentId, onReset: () => renderStudentEntry(root, app, code, false), onExit: state => mountLive(root, app, client, state, { code, teacher, contentId }) };
  if ((['playing','paused'].includes(initial.status) || initial.status==='finished'&&initial.startedAt)) return mountLiveGame(root, app, client, initial, playOptions);
  let state = initial, disposed = false, acting = false, busy = false, queued = false, stopWatch, timer, debounce, error = '', receivedAt = Date.now();
  const joinUrl=studentJoinUrl(code||'',safeUrl(initial.qrBaseUrl)||location.origin+location.pathname);
  root.innerHTML = `${teacher?`<div class="actions"><a class="btn class-back" href="#/editor/${esc(contentId)}">← 방탈출 편집</a></div>`:''}<div class="page-heading"><div><div class="eyebrow">LIVE LOBBY</div><h1>${esc(state.title)}</h1><p id="lobby-intro">${teacher ? '학생들이 입장하면 명단에 바로 나타납니다.' : '선생님이 게임을 시작할 때까지 기다려 주세요.'}</p></div><span id="connection-status" role="status">실시간 연결 중…</span></div>${teacher ? `<section class="panel"><p>입장 코드 <strong class="room-code">${esc(code)}</strong></p>${field('학생 입장 링크', `<input readonly value="${esc(joinUrl)}">`)}<div class="entry-qr" id="entry-qr" aria-label="학생 입장 QR"></div><p class="muted">같은 주소의 QR 또는 링크로 접속하면 방 코드가 자동 입력됩니다.</p></section>` : ''}<div id="lobby-error" role="alert"></div><div id="lobby-state" aria-live="polite"></div><div id="lobby-controls" class="actions"></div><div id="profile-area"></div>`;
  if(teacher){const qrRoot=root.querySelector('#entry-qr');qrLibrary('qrcode-generator').then(()=>{if(!qrRoot.isConnected)return;const g=globalThis.qrcode(0,'M');g.addData(joinUrl);g.make();qrRoot.innerHTML=g.createSvgTag({cellSize:4,margin:16,scalable:true});}).catch(e=>{qrRoot.textContent=e.message;});}
  const draw = () => {
    if (disposed) return;
    root.querySelector('.page-heading h1').textContent=state.title;
    root.querySelector('#lobby-error').textContent = error;
    root.querySelector('#lobby-intro').textContent = state.status === 'lobby' ? (teacher ? '학생들이 입장하면 명단에 바로 나타납니다.' : '선생님이 게임을 시작할 때까지 기다려 주세요.') : state.status === 'playing' ? '게임 시작이 확인되었습니다.' : state.status === 'finished' ? '이번 대기실이 종료되었습니다.' : '진행을 잠시 기다려 주세요.';
    const display = { ...state, serverNow: new Date(Date.parse(state.serverNow) + Date.now() - receivedAt).toISOString() };
    root.querySelector('#lobby-state').innerHTML = `<section class="lobby-state-banner ${state.status}"><span class="pill">${statusNames[state.status]}</span><h2>${state.status === 'playing' ? '게임이 시작되었습니다.' : state.status === 'finished' ? '대기실이 종료되었습니다.' : state.status === 'paused' ? '교사가 게임을 잠시 일시정지했습니다.' : state.playMode === 'team' && !state.participants.find(p => p.id === state.participantId)?.team && !teacher ? '참가할 조를 선택하세요.' : '모두 모이면 모험을 시작해요.'}</h2>${state.startedAt ? `<p>시작 시각 ${esc(new Date(state.startedAt).toLocaleString('ko-KR'))}</p>` : ''}</section>${state.status !== 'finished' ? rosterHtml(display, teacher) : ''}`;
    root.querySelector('#lobby-controls').innerHTML = teacher ? `${state.status === 'lobby' ? '<button class="btn primary" data-live="start">게임 시작</button>' : ''}${state.status !== 'finished' ? '<button class="btn" data-live="close">대기실 종료</button>' : '<a class="btn" href="#/library">내 방탈출</a>'}` : `${state.status === 'lobby' ? '<button class="btn" data-live="profile">내 정보 수정</button><button class="btn" data-live="leave">대기실 나가기</button>' : state.status === 'finished' ? '<button class="btn" data-live="reset">새 수업 참가</button>' : ''}`;
    if(teacher&&state.status==='finished')root.querySelector('#lobby-controls').insertAdjacentHTML('beforeend','<button class="btn" data-live="reset-class">수업 완료 및 초기화</button>');
    if (state.status !== 'lobby') root.querySelector('#profile-area').innerHTML = '';
  };
  const update = next => { if ((['playing','paused'].includes(next.status) || next.status==='finished'&&next.startedAt)) { cleanup(); mountLiveGame(root, app, client, next, playOptions); return; } state = next; receivedAt = Date.now(); error = ''; draw(); };
  const read = async (touch = false) => {
    if (disposed) return;
    if (busy) { queued = true; return; }
    busy = true;
    try { const next = teacher ? await client.teacher('read', state.sessionId) : await client.student(code, touch ? 'touch' : 'read'); if (!disposed) update(next); }
    catch (err) { error = err.message; draw(); }
    finally { busy = false; if (queued && !disposed) { queued = false; schedule(); } }
  };
  const schedule = () => { if (!debounce && !disposed) debounce = setTimeout(() => { debounce = null; read(); }, 200); };
  const cleanup = () => { disposed = true; stopWatch?.(); clearInterval(timer); clearTimeout(debounce); window.removeEventListener('online', schedule); document.removeEventListener('visibilitychange', visible); return true; };
  const visible = () => { if (!document.hidden) read(!teacher); };
  app.cleanup = cleanup;
  draw();
  stopWatch = watchLobby(client.repo.config, state.topic, schedule, status => {
    if (!disposed) root.querySelector('#connection-status').textContent = ({ connected: '실시간 연결됨', connecting: '실시간 연결 중…', reconnecting: '실시간 재연결 중…', error: '실시간 연결 확인 필요' })[status];
  });
  // Recovery sync + server-side presence lease; Realtime drives immediate updates.
  timer = setInterval(() => read(!teacher), 25000);
  window.addEventListener('online', schedule); document.addEventListener('visibilitychange', visible);
  root.onclick = async event => {
    const btn = event.target.closest('[data-live], [data-team]'); if (!btn || disposed || acting) return;
    const action = btn.dataset.live;
    if (action === 'profile') {
      const p = state.participants.find(p => p.id === state.participantId);
      root.querySelector('#profile-area').innerHTML = `<form id="student-profile" class="panel"><h2>내 정보 수정</h2>${identityFields(p)}<button class="btn primary" type="submit">정보 저장</button></form>`;
      root.querySelector('#student-profile').onsubmit = async e => { e.preventDefault(); const submit = e.target.querySelector('button'); submit.disabled = true; try { update(await client.student(code, 'profile', identityFrom(e.target))); root.querySelector('#profile-area').innerHTML = ''; } catch (err) { error = err.message; draw(); } finally { submit.disabled = false; } }; return;
    }
    acting=true;btn.disabled = true;
    try {
      if(action==='reset-class'&&teacher){const keep=await resetChoice();if(keep!==null){const next=await new LivePlayClient(client).finish(state.sessionId,'reset',keep);cleanup();mountLive(root,app,client,next,{code,teacher,contentId});}return;}
      if (action === 'reset') { client.forget(code); cleanup(); app.cleanup = null; await renderStudentEntry(root, app, code); return; }
      if (action === 'leave') { await client.student(code, 'leave'); cleanup(); app.cleanup = null; await renderStudentEntry(root, app, code, false); return; }
      if(teacher&&action==='start'&&!await prepareTeacherStart(client,contentId,state.sessionId))return;
      const next = teacher ? await client.teacher(action, state.sessionId) : await client.student(code, 'team', { p_team: Number(btn.dataset.team) });
      update(next);
    } catch (err) { error = err.message; draw(); } finally { acting=false;btn.disabled = false; }
  };
}

export async function renderStudentEntry(root, app, routeCode = '', restore = true) {
  const client = new LobbyClient(); const code = /^\d{6}$/.test(routeCode) ? routeCode : codeFromUrl();
  let restoreError = '';
  if (restore && code && client.saved(code)?.participantId) {
    try { const state = await client.student(code, 'touch'); mountLive(root, app, client, state, { code }); return; }
    catch (err) { restoreError = err.message; }
  }
  root.innerHTML = `<section class="panel student-entry"><span class="eyebrow">JOIN THE ADVENTURE</span><h1>방탈출에 입장하기</h1><p>선생님이 알려준 방 코드와 학생 정보를 입력하세요.</p><form id="student-join">${field('방 코드', `<input name="code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required value="${esc(code)}" autocomplete="off">`)}${identityFields()}<p class="muted">이름과 학년·반·번호는 같은 대기실의 학생과 교사에게 표시됩니다.</p><button class="btn primary wide" type="submit">입장하기</button><p class="form-message" role="alert">${esc(restoreError)}</p></form></section>`;
  root.onclick = null;
  root.querySelector('form').onsubmit = async e => {
    e.preventDefault(); const form = e.target, btn = form.querySelector('button'), code = String(new FormData(form).get('code')).trim(); btn.disabled = true;
    try {
      const state = await client.join(code, identityFrom(form));
      history.replaceState(null, '', '#/join/' + code);
      mountLive(root, app, client, state, { code });
    } catch (err) { form.querySelector('.form-message').textContent = err.message; } finally { btn.disabled = false; }
  };
}

export async function renderTeacherLobby(root, app, contentId) {
  if (app.repo.mode !== 'cloud') { root.innerHTML = '<section class="panel"><h1>온라인 교사 로그인이 필요합니다</h1><a class="btn" href="#/login">교사 로그인</a></section>'; return; }
  const row = await app.repo.get(contentId); if (!row) throw Error('콘텐츠를 찾을 수 없습니다.');
  const client = new LobbyClient(app.repo);
  root.innerHTML='<p>수업을 여는 중…</p>';
  try{
    const info=await client.snapshot(contentId);let state=info.state;
    if(!state){
      if(!await canRun(info.document)){root.innerHTML=`<a class="btn" href="#/editor/${contentId}">제작기로 돌아가기</a>`;return;}
      info.failedAssets=approvedAssetFailures(info.document);state=await client.snapshot(contentId,'open',info);
    }else if(state.status==='lobby'&&info.changed){
      if(await confirmDialog('제작기에서 내용이 변경되었습니다.','최신 내용으로 대기실을 업데이트하시겠습니까?','최신 내용 반영','기존 내용 유지')){
        if(await canRun(info.document)){info.failedAssets=approvedAssetFailures(info.document);state=await client.snapshot(contentId,'refresh',info);}
      }
    }
    state.qrBaseUrl=info.document.qrBaseUrl;
    mountLive(root,app,client,state,{code:row.room_code,teacher:true,contentId});
  }catch(err){root.innerHTML=`<section class="panel"><h1>수업을 열지 못했습니다</h1><p role="alert">${esc(err.message)}</p><a class="btn" href="#/editor/${contentId}">제작기로 돌아가기</a><a class="btn" href="#/library">← 내 방탈출로 돌아가기</a></section>`;}
}

async function prepareTeacherStart(client,contentId,sessionId){
 const info=await client.snapshot(contentId);
 if(info.state?.sessionId!==sessionId||info.state.status!=='lobby')return true;
 if(!info.assetsAcknowledged){if(!await canRun(info.snapshot))return false;info.failedAssets=approvedAssetFailures(info.snapshot);await client.snapshot(contentId,'assets',info);}
 return true;
}
