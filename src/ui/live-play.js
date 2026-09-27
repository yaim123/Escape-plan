import {mountChat} from './chat.js';
import {questionAnalysisHtml,delayWarningsHtml} from './analysis.js';
import {renderStudentInfo,mountBgm} from './student-info.js';
import {isImmersive,immersiveHtml,mountImmersive} from './immersive.js';
import {mountAssetFallback} from './asset-fallback.js';
import {displayAttributes} from './display.js';
import { resultHtml, resultTable, resetChoice } from './results.js';
import {qrProgressHtml,scanQrDialog} from './qr.js';
import { LivePlayClient } from '../data/play.js';
import { watchLobby } from '../data/realtime.js';
import { esc, options, confirmDialog } from './dom.js';
import { mediaHtml } from './media.js';
import { controlPanel, auditHtml, elapsedLabel } from './teacher-controls.js';
import { BLOCK_TYPES } from '../core/model.js';

export function liveAnswerControls(b,qr=[]) {
  if(b.type!=='question') return `<button class="btn primary" type="submit">${esc(b.buttonText||'계속하기')}</button>`;
  if(b.questionType==='qr'&&qr.some(m=>m.mode==='UNIQUE_MEMBER'&&m.selfDone&&!m.done))return '<section class="qr-member-wait" role="status"><strong>✅ 내 QR 찾기 완료</strong><p>다른 팀원이 QR을 찾을 때까지 기다려주세요.</p></section>';
  if(b.questionType==='qr') return `<button class="btn primary" type="button" data-question-qr="${esc(b.id)}">QR 코드 스캔</button>`;
  if(b.questionType==='approval') return '<p class="callout">활동을 마친 뒤 교사의 승인을 기다려 주세요.</p>';
  if(['switch','condition'].includes(b.questionType)) return `<button class="btn primary" type="submit">${b.questionType==='switch'?'스위치 작동하기':'조건 확인하고 계속하기'}</button>`;
  let controls;
  if(['choice','multi','ox'].includes(b.questionType)) controls=`<div class="answer-options">${(b.questionType==='ox'?['O','X']:b.options).map((o,i)=>`<label class="answer-option"><input type="${b.questionType==='multi'?'checkbox':'radio'}" name="answer" value="${esc(o)}" ${b.questionType==='multi'?'':'required'}><span class="option-index">${i+1}</span><span>${esc(o)}</span></label>`).join('')}</div>`;
  else if(['order','match'].includes(b.questionType)) controls=b.options.map((o,i)=>`<label class="match-row"><span>${esc(b.questionType==='order'?`${i+1}번째`:o)}</span><select name="answer" required><option value="">선택하세요</option>${options(Object.fromEntries((b.questionType==='match'?b.matchChoices:b.options).map(c=>[c,c])), '')}</select></label>`).join('');
  else controls=`<label class="field"><span>${b.questionType==='cipher'?'암호':'정답'}</span><input name="answer" type="${b.questionType==='number'?'number':'text'}" ${b.questionType==='number'?'step="any"':''} autocomplete="off" maxlength="4000" required></label>`;
  return `${controls}<button class="btn primary" type="submit">정답 제출</button>`;
}
export function answerFromForm(block,form) {
  if(block.type!=='question'||block.questionType==='condition') return null;
  if(block.questionType==='switch') return true;
  const data=new FormData(form);
  return ['multi','order','match'].includes(block.questionType)?data.getAll('answer'):data.get('answer');
}
const wrongTotal=p=>Object.values(p?.wrongCounts||{}).reduce((a,b)=>a+Number(b),0);
export function mountLiveGame(root,app,lobby,initial,{code,teacher=false,onExit,onReset,contentId}) {
  let chat,scanController,bgm,scanHolding=false,scanNext=null;
  const client=new LivePlayClient(lobby); let game=null, disposed=false, loading=false, queued=false, writing=false, signature='', feedback='', stopWatch, timer, debounce, clockTimer, receivedAt=Date.now(), panelTarget=null, panelRevision=null;
  root.innerHTML=`${teacher?`<div class="actions"><a class="btn class-back" href="#/editor/${esc(contentId)}">← 방탈출 편집</a></div>`:''}<div class="page-heading"><div><span class="eyebrow">${teacher?'LIVE PROGRESS':'LIVE PLAY'}</span><h1>${esc(initial.title)}</h1><p>${teacher?'학생과 팀의 진행 상태를 실시간으로 확인합니다.':'단서를 살펴보고 다음 콘텐츠를 열어보세요.'}</p></div><span id="game-connection" role="status">실시간 연결 중…</span></div><div id="game-error" role="alert"></div><p id="game-feedback" role="status"></p><p id="game-clock" role="timer"></p><div id="arrival-summary"></div>${teacher?'<div id="question-analysis"></div><div id="delay-warnings"></div>':''}<div id="game-progress"></div><div id="live-content"><p>진행 상태를 불러오는 중…</p></div>${teacher?'<div id="control-panel"></div><div id="control-audit"></div><div class="actions"><button class="btn primary" id="pause-session">전체 일시정지</button><button class="btn" id="finish-session">수업 종료</button><button class="btn" id="reset-session">수업 완료 및 초기화</button></div>':''}`;
  if(!teacher){root.insertAdjacentHTML('beforeend','<button class="btn small" id="leave-playing">수업 나가기</button>');root.classList.add('student-presented');root.insertAdjacentHTML('afterbegin','<div id="student-meta"></div>');}
  const showError=error=>{if(!disposed) root.querySelector('#game-error').textContent=error.message||error;};
  root.querySelector('#game-clock').insertAdjacentHTML('afterend','<div id="qr-progress"></div>');
  const cleanup=()=>{disposed=true;chat?.dispose();bgm?.dispose();root.classList.remove('student-presented');scanController?.abort();stopWatch?.();clearInterval(timer);clearInterval(clockTimer);clearTimeout(debounce);client.dispose();document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',schedule);return true;};
  app.cleanup=cleanup;
  if(!teacher)chat=mountChat(root,lobby,()=>client.token(code));
  const exit=async()=>{const state=teacher?await lobby.teacher('read',initial.sessionId):await lobby.student(code);if(disposed)return;cleanup();onExit(state);};
  const drawStudent=()=>{
    const p=game.progress,b=game.current;
    if(!bgm)bgm=mountBgm(root,game.theme,game.sound);
    root.querySelector('#arrival-summary').innerHTML=!game.result&&game.status==='playing'&&game.rankVisible?resultTable(game.leaderboard,true):'';
    if(game.result||game.status==='finished'){signature='result';root.querySelector('#game-feedback').textContent='';root.querySelector('#game-progress').innerHTML='';root.querySelector('#live-content').innerHTML=resultHtml(game);return;}
    if(game.status==='paused'){signature='paused';root.querySelector('#game-feedback').textContent='';root.querySelector('#game-progress').innerHTML='';root.querySelector('#live-content').innerHTML='<section class="pause-screen" role="alert"><div><span class="eyebrow">PAUSED</span><h2>교사가 게임을 잠시 일시정지했습니다. 잠시 기다려 주세요.</h2><p>재개하면 멈춘 위치에서 계속 진행합니다.</p></div></section>';return;}
    root.querySelector('#game-feedback').textContent=feedback;
    root.querySelector('#game-progress').innerHTML=`<section class="play-progress panel"><span>${game.playMode==='team'?`${game.team}조 · 팀원 ${p.memberNumber} · ${esc(p.role)}`:'개인전'}</span><strong>진행 ${p.completedCount}/${p.totalCount}</strong><span>내 오답 ${wrongTotal(p)}회</span><progress max="${Math.max(1,p.totalCount)}" value="${p.completedCount}"></progress></section>`;
    const sceneProgress=root.querySelector('[data-scene-progress]');if(sceneProgress)sceneProgress.textContent=`진행 ${p.completedCount}/${p.totalCount}`;
    const nextSignature=JSON.stringify([b,game.available,b?.questionType==='qr'?game.qr:null]);
    const drawHints=()=>{const el=root.querySelector('#live-hints');if(el)el.innerHTML=`${(game.revealedHints||[]).map((h,i)=>`<p class="callout">힌트 ${i+1}: ${esc(h)}</p>`).join('')}${game.hasMoreHints?'<button class="btn" data-hint>다음 힌트 보기</button>':''}`;};
    if(signature===nextSignature){drawHints();return;} // Keep in-progress input on realtime/heartbeat updates.
    signature=nextSignature;
    root.querySelector('#live-content').innerHTML=b?`<section ${displayAttributes(b,game.theme,game.design)}><div class="content-body"><div data-block-meta><div class="eyebrow">STAGE ${esc(b.stage)} · ${esc(BLOCK_TYPES[b.type])}</div><h2>${esc(b.title)}</h2></div><p class="pre-line story-body">${esc(b.body)}</p>${mediaHtml(b.media)}<form id="live-answer">${liveAnswerControls(b,game.qr)}</form><div id="live-hints"></div></div></section>${game.available.length>1?`<nav class="actions available-content" aria-label="공개된 콘텐츠">${game.available.map(item=>`<button class="btn" data-select="${esc(item.id)}" ${item.id===b.id?'disabled':''}>${esc(item.title)}</button>`).join('')}</nav>`:''}`:`<section class="panel"><h2>${p.completedCount===p.totalCount?'현재 콘텐츠를 모두 완료했습니다.':'다른 팀원 또는 조건을 기다리고 있습니다.'}</h2><p>진행 상태가 바뀌면 자동으로 다음 콘텐츠가 표시됩니다.</p></section>`;
    if(isImmersive(b)){
      root.querySelector('#live-content').innerHTML=immersiveHtml(b,{infoHtml:'',title:initial.title,progress:`진행 ${p.completedCount}/${p.totalCount}`,time:root.querySelector('#game-clock').textContent,connection:root.querySelector('#game-connection').textContent});
      mountImmersive(root,async()=>{if(writing||game.status!=='playing')return;writing=true;try{const result=await client.submit(code,b.id,null);apply(result.game,true);}finally{writing=false;if(queued){queued=false;schedule();}}});
    }
    mountAssetFallback(root);
    drawHints();
    root.querySelector('#live-answer')?.addEventListener('submit',async event=>{
      event.preventDefault();if(writing||game.status!=='playing')return;writing=true;
      const btn=event.target.querySelector('button[type="submit"]');if(btn)btn.disabled=true;
      try {
        const result=await client.submit(code,b.id,answerFromForm(b,event.target));
        feedback=result.outcome==='wrong'?'아직 정답이 아니에요. 다시 살펴보세요.':result.outcome==='already_complete'?'이미 완료한 콘텐츠입니다.':b.type==='question'?'정답입니다.':'콘텐츠를 완료했습니다.';
        apply(result.game, true);
      }catch(error){showError(error);}finally{writing=false;if(btn)btn.disabled=false;if(queued){queued=false;schedule();}}
    });
  };
  const drawDelays=()=>{if(teacher&&game)root.querySelector('#delay-warnings').innerHTML=delayWarningsHtml(game.delayState,game.status,game.status==='playing'?Date.now()-receivedAt:0);};
  const drawTeacher=()=>{
    root.querySelector('#question-analysis').innerHTML=(game.status==='finished'||game.summary?.allComplete)?questionAnalysisHtml(game.questionAnalysis):'';drawDelays();
    const rows=game.participants;
    const summary=game.summary;
    const statusLabel=p=>{const result=summary?.results.find(r=>r.memberIds.includes(p.id));if(result)return `탈출 완료 (${elapsedLabel(result.elapsedMs)})`;if(game.status==='finished')return '미완료 종료';if(game.status==='paused')return '일시정지 · 미완료';return `${Date.parse(game.timing?.serverNow)-Date.parse(p.lastSeenAt)>75000?'연결 끊김':'진행 중'} · 미완료`;};
    if(summary)root.querySelector('#arrival-summary').innerHTML=`<section class="panel"><h2>${summary.allComplete?'모든 참가자가 방탈출을 완료했습니다.':`도착 ${summary.completed}/${summary.total}`}</h2><p>${(summary.results||[]).map(r=>`${esc(r.label)} ✅ 완료 ${esc(new Date(r.arrivedAt).toLocaleTimeString('ko-KR'))}`).join(' · ')}</p><p>${(summary.unfinished||[]).map(r=>`${esc(r.label)} 🔵 ${game.status==='finished'?'미완료 종료':'진행 중'}`).join(' · ')}</p></section>${resultTable(summary.results)}`;
    root.querySelector('#pause-session').hidden=game.status==='finished';root.querySelector('#finish-session').hidden=game.status==='finished';
    const groups=game.playMode==='team'?[...new Set(rows.map(p=>p.team))].sort((a,b)=>a-b).map(team=>{
      const members=rows.filter(p=>p.team===team),p=members[0]?.progress||{};
      return `<section class="panel"><h3><button class="btn" data-manage-team="${team}">${team}조 관리</button></h3><strong>평균 진행 ${members.length?Math.round(members.reduce((n,m)=>n+(m.progress?.completedCount||0)/Math.max(1,m.progress?.totalCount||0),0)/members.length*100):0}%</strong><p>${members.length}명 · 오답 합계 ${members.reduce((n,m)=>n+wrongTotal(m.progress),0)}회</p></section>`;
    }).join(''):'';
    root.querySelector('#game-progress').innerHTML=`<div class="teams-grid">${groups}</div>`;
    root.querySelector('#live-content').innerHTML=`<section class="panel"><h2>참가자별 진행도</h2><div class="progress-table-wrap"><table class="progress-table"><thead><tr><th>학생</th><th>팀원</th><th>현재 콘텐츠</th><th>완료</th><th>오답</th><th>상태 / 완료</th><th>승인</th></tr></thead><tbody>${rows.map(p=>`<tr><td><button class="btn small" data-manage-student="${p.id}">${p.grade}-${p.classroom}-${p.number} ${esc(p.name)}</button></td><td>${p.team?`${p.team}조 · `:''}${p.memberNumber||''} ${esc(p.role)}</td><td>${esc(p.currentTitle||(p.progress?.completedCount===p.progress?.totalCount?'현재 콘텐츠 완료':'조건 대기'))}</td><td>${p.progress?.completedCount||0}/${p.progress?.totalCount||0}</td><td>${wrongTotal(p.progress)}</td><td>${statusLabel(p)}</td><td>${p.approvalBlockId?`<button class="btn small" data-approve="${p.id}" data-block="${p.approvalBlockId}" ${game.status==='paused'?'disabled':''}>활동 승인</button>`:'—'}</td></tr>`).join('')}</tbody></table></div></section>`;
    root.querySelector('#pause-session').textContent=game.status==='paused'?'게임 재개':'전체 일시정지';
    const auditOpen=root.querySelector('#control-audit details')?.open;
    root.querySelector('#control-audit').innerHTML=auditHtml(game.actions,game.contents);
    if(auditOpen)root.querySelector('#control-audit details').open=true;
    const stale=root.querySelector('#control-stale');if(stale)stale.textContent=panelRevision!==game.revision?'진행 상태가 변경되었습니다. 대상 관리 버튼을 다시 눌러 최신 상태를 확인하세요.':'';
  };
  const infoContext=()=>({...game,elapsedMs:game.result?.elapsedMs??game.completedElapsedMs??(game.timing?.elapsedMs||0)+(game.status==='playing'?Date.now()-receivedAt:0),connection:root.querySelector('#game-connection').textContent});
  const drawClock=()=>{if(!game?.timing||disposed)return;const ms=!teacher&&(game.result||game.completedElapsedMs!=null)?(game.result?.elapsedMs??game.completedElapsedMs):game.timing.elapsedMs+(game.status==='playing'?Date.now()-receivedAt:0);root.querySelector('#game-clock').textContent=`유효 플레이 시간 ${elapsedLabel(ms)} · 일시정지 시간 제외`;if(!teacher)renderStudentInfo(root,infoContext());const info=root.querySelector('[data-scene-time]');if(info)info.textContent=root.querySelector('#game-clock').textContent;const connection=root.querySelector('[data-scene-connection]');if(connection)connection.textContent=root.querySelector('#game-connection').textContent;};
  const openPanel=target=>{panelTarget=target;panelRevision=game.revision;root.querySelector('#control-panel').innerHTML=controlPanel(game,target);const form=root.querySelector('#teacher-control-form');if(!form)return;form.onchange=()=>{const action=form.elements.action.value;for(const field of form.querySelectorAll('[data-control-field]'))field.hidden=!(field.dataset.controlField==='block'?['move','unlock'].includes(action):field.dataset.controlField===action);};form.onsubmit=async event=>{event.preventDefault();if(writing)return;writing=true;const btn=form.querySelector('button[type=submit]');btn.disabled=true;try{const action=form.elements.action.value;const result=await client.control(initial.sessionId,action,{p_scope:target.scope,p_participant:target.participant||null,p_team:target.team||null,p_block:['move','unlock'].includes(action)?form.elements.block.value:null,p_stage:action==='stage'?form.elements.stage.value:null,p_new_team:action==='team'?Number(form.elements.team.value):null},panelRevision);apply(result);root.querySelector('#control-panel').innerHTML='';panelTarget=null;}catch(error){showError(error);schedule();}finally{writing=false;btn.disabled=false;}};};
  const apply=(next, keepFeedback=false)=>{
    if(disposed)return;
    if(game && Number(next.revision)<Number(game.revision))return;
    // Realtime can arrive before the scan RPC. Keep the newest playing state behind its receipt.
    // Teacher pause/end/reset must still interrupt immediately.
    if(scanHolding&&next.status==='playing'){
      if(!scanNext||Number(next.revision)>=Number(scanNext.next.revision))scanNext={next,keepFeedback};
      return;
    }
    if(next.status!=='playing'){scanHolding=false;scanNext=null;}
    if(!keepFeedback && game?.current?.id!==next.current?.id) feedback='';
    const changedBlock=game?.current?.id!==next.current?.id;
    game=next;if(!teacher)root.querySelector('#leave-playing').disabled=game.status!=='playing'||!!game.result;receivedAt=Date.now();drawClock();root.querySelector('#game-error').textContent='';
    if(changedBlock)scanController?.abort();
    if(game.status!=='playing'||game.result||game.current?.questionType!=='qr')scanController?.abort();
    root.querySelector('#qr-progress').innerHTML=teacher?(game.participants||[]).filter(p=>p.qr?.length).map(p=>`<details class="panel"><summary>${esc(game.playMode==='team'?p.team+'조 · '+p.name:p.name)} · QR 진행</summary>${qrProgressHtml(p.qr)}</details>`).join(''):(game.status==='playing'&&!game.result&&game.current?.questionType==='qr'?qrProgressHtml(game.qr):'');
    if(!['playing','paused','finished'].includes(game.status)){exit().catch(showError);return;}
    if(teacher)drawTeacher();else {chat?.update(game);drawStudent();renderStudentInfo(root,infoContext());bgm?.update(game.status);}
  };
  const load=async()=>{
    if(disposed)return;if(loading||writing){queued=true;return;}loading=true;
    try{apply(teacher?await client.teacher(initial.sessionId):await client.read(code));}catch(error){if(!teacher&&error.code==='42501'&&error.message.includes('참가 기록')){cleanup();lobby.forget(code);onReset?.();return;}showError(error);}finally{loading=false;if(queued&&!disposed){queued=false;schedule();}}
  };
  const schedule=()=>{if(!debounce&&!disposed)debounce=setTimeout(()=>{debounce=null;load();},180);};
  const releaseScan=()=>{scanHolding=false;const pending=scanNext;scanNext=null;if(pending)apply(pending.next,pending.keepFeedback);};
  const visible=()=>{if(!document.hidden)schedule();};
  stopWatch=watchLobby(lobby.repo.config,initial.topic,schedule,status=>{if(!disposed)root.querySelector('#game-connection').textContent={connected:'실시간 연결됨',connecting:'실시간 연결 중…',reconnecting:'실시간 재연결 중…',error:'실시간 연결 확인 필요'}[status];});
  timer=setInterval(async()=>{if(!teacher){try{await lobby.student(code,'touch');}catch(error){showError(error);}}load();},25000);
  document.addEventListener('visibilitychange',visible);window.addEventListener('online',schedule);
  clockTimer=setInterval(()=>{drawClock();drawDelays();},1000);
  root.onclick=async event=>{
    const scanButton=event.target.closest('[data-question-qr]');
    if(scanButton){if(writing||scanController)return;const blockId=scanButton.dataset.questionQr;scanController=new AbortController();
      try{await scanQrDialog(scanController.signal,async token=>{writing=true;scanHolding=true;try{
        const r=await lobby.rpc('escape_answer_qr',{p_token:client.token(code),p_qr:token,p_block:blockId});
        feedback=r.message;apply(r.game,true);return {keepOpen:r.game.status==='playing'&&!r.game.result&&r.game.current?.id===blockId&&!(r.qrScan?.mode==='UNIQUE_MEMBER'&&r.qrScan.selfDone),message:r.message,duplicate:r.duplicate,progress:r.qrScan,onConfirm:releaseScan};
      }catch(error){releaseScan();throw error;}finally{writing=false;if(queued){queued=false;schedule();}}},{onChat:chat?.available()?()=>chat.open():null});}finally{scanController=null;releaseScan();if(queued){queued=false;schedule();}}return;
    }
    const manage=event.target.closest('[data-manage-student],[data-manage-team],[data-close-control]');if(manage){if(game.status==='finished')return;if(manage.hasAttribute('data-close-control')){root.querySelector('#control-panel').innerHTML='';panelTarget=null;}else openPanel(manage.dataset.manageStudent?{scope:'student',participant:manage.dataset.manageStudent}:{scope:'team',team:Number(manage.dataset.manageTeam)});return;}
    const btn=event.target.closest('[data-select],[data-approve],#finish-session,#pause-session,#reset-session,#leave-playing,[data-hint]');if(!btn||writing)return;
    writing=true;btn.disabled=true;
    try{
      if(btn.id==='leave-playing'){if(await confirmDialog('수업에서 나갈까요?','활성 팀원에서 제외됩니다. 단순 새로고침이나 연결 끊김에는 해당하지 않습니다.','수업 나가기')){await lobby.student(code,'leave');lobby.forget(code);cleanup();app.navigate('join/'+code);}}
      else if(btn.hasAttribute('data-hint')){apply(await client.hint(code,game.current.id));}
      else if(btn.id==='reset-session'){const keep=await resetChoice();if(keep!==null){const state=await client.finish(initial.sessionId,'reset',keep);cleanup();onExit(state);}}
      else if(btn.id==='pause-session'){apply(await client.control(initial.sessionId,game.status==='paused'?'resume':'pause',{p_scope:'session'},game.revision));}
      else if(btn.id==='finish-session'){if(game.summary?.allComplete||await confirmDialog('수업을 강제로 종료할까요?','아직 진행 중인 학생 또는 팀이 있습니다. 미완료 상태로 수업을 종료합니다.','수업 종료'))apply(await client.finish(initial.sessionId));}
      else if(btn.dataset.approve){apply(await client.teacher(initial.sessionId,'approve',btn.dataset.approve,btn.dataset.block));}
      else {feedback='';apply(await client.select(code,btn.dataset.select));}
    }catch(error){showError(error);}finally{writing=false;btn.disabled=false;if(queued){queued=false;schedule();}}
  };
  load();
}
