import { esc } from './dom.js';
export const CONTROL_LABELS={pause:'전체 일시정지',resume:'게임 재개',complete:'현재 콘텐츠 강제 완료',skip:'현재 콘텐츠 건너뛰기',move:'특정 콘텐츠로 이동',stage:'특정 스테이지로 이동',unlock:'잠긴 콘텐츠 강제 해제',reset:'선택 대상 진행 초기화',team:'팀 변경'};
export function elapsedLabel(ms){const s=Math.max(0,Math.floor(Number(ms||0)/1000));return `${Math.floor(s/60)}분 ${s%60}초`;}
export function controlPanel(game,target){
  const p=game.participants.find(p=>p.id===target.participant);
  const name=target.scope==='team'?`${target.team}조 전체`:p?.name;
  if(!name)return '';
  const choices=Object.entries(CONTROL_LABELS).filter(([key])=>!['pause','resume'].includes(key)&&(key!=='team'||game.playMode==='team'));
  return `<section class="panel management-panel"><div class="actions"><h2>${esc(name)} 관리</h2><button class="btn" data-close-control>닫기</button></div>
    <p><strong>적용 대상: ${target.scope==='team'?'해당 팀 전체':'해당 학생만'}</strong> · 화면을 연 시점의 진행 상태를 기준으로 실행합니다.</p>
    <form id="teacher-control-form"><label class="field"><span>관리 작업</span><select name="action">${choices.map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
    <label class="field" data-control-field="block" hidden><span>대상 콘텐츠</span><select name="block">${game.contents.map(b=>`<option value="${b.id}">${esc(b.stage)} · ${esc(b.title)}</option>`).join('')}</select></label>
    <label class="field" data-control-field="stage" hidden><span>대상 스테이지</span><select name="stage">${[...new Set(game.contents.map(b=>b.stage))].map(stage=>`<option value="${esc(stage)}">${esc(stage)}</option>`).join('')}</select></label>
    <label class="field" data-control-field="team" hidden><span>이동할 조</span><select name="team">${Array.from({length:game.teamCount},(_,i)=>`<option value="${i+1}">${i+1}조</option>`).join('')}</select></label>
    <p class="callout">개별 강제 완료·건너뛰기는 해당 학생만 통과 처리합니다. 팀 전체 작업은 각 팀원의 현재 콘텐츠에 적용합니다. 이동·해제는 배정과 잠금을 넘어 선택한 콘텐츠를 열며, 이미 완료한 콘텐츠도 다시 볼 수 있습니다. 팀 변경·초기화 후에는 공유 조건을 다시 계산합니다. 초기화는 선택한 학생의 풀이·오답·힌트를 지우며 관리 이력은 유지합니다. 이미 도착한 대상의 이동·해제·초기화·팀 변경은 관련 현재 결과를 다시 계산합니다. 보관된 과거 결과는 변경하지 않습니다.</p>
    <label class="check"><input type="checkbox" name="confirm" required> 적용 대상과 작업을 확인했습니다.</label><button class="btn primary" type="submit">관리 작업 적용</button><p id="control-stale" role="status"></p></form></section>`;
}
export function auditHtml(actions=[],contents=[]){return `<details class="panel"><summary>최근 교사 조작 기록 (${actions.length})</summary><ul class="control-audit">${actions.map(a=>`<li>${esc(new Date(a.created_at).toLocaleString('ko-KR'))} · <strong>${esc(CONTROL_LABELS[a.action]||a.action)}</strong> · ${esc({session:'전체 수업',student:'해당 학생만',team:'해당 팀 전체'}[a.scope])}<p>${esc((a.details.targets||[]).map(t=>`${t.name}${t.team?` (${t.team}조)`:''}${t.newTeam?` → ${t.newTeam}조`:''}${t.stage?` · 스테이지 ${t.stage}`:''}${t.block?` · ${contents.find(b=>b.id===t.block)?.title||t.block}`:''}`).join(', '))}</p></li>`).join('')||'<li>아직 관리 기록이 없습니다.</li>'}</ul></details>`;}
