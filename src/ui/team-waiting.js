import {esc} from './dom.js';
import {waitingSettings} from '../core/team-settings.js';
export function teamWaitingHtml(waiting,settings){
 if(!waiting)return '';
 const s={...waitingSettings({}),...settings};
 return `<section class="qr-member-wait team-wait" role="status"><strong>✅ ${esc(s.title||'내 할 일을 완료했습니다!')}</strong>${s.showCounts!==false&&Number.isInteger(waiting.found)&&Number.isInteger(waiting.required)?`<p>${waiting.unit==='lanes'?'병렬 진행':'현재'} ${waiting.found} / ${waiting.required}${waiting.unit==='lanes'?' 경로':'명'} 완료</p>`:''}${waiting.unit==='lanes'&&waiting.lanes?`<small>${waiting.lanes.map(l=>`${esc(l.name)} ${l.done?'✓ 완료':'진행 중'}`).join(' · ')}</small>`:''}<p class="pre-line">${esc(s.body||'다른 팀원이 조건을 완료할 때까지 기다려주세요.')}</p></section>`;
}
