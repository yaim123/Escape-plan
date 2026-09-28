import {esc} from './dom.js';
import {waitingSettings} from '../core/team-settings.js';
export function teamWaitingHtml(waiting,settings){
 if(!waiting)return '';
 const s={...waitingSettings({}),...settings};
 return `<section class="qr-member-wait team-wait" role="status"><strong>✅ ${esc(s.title||'내 할 일을 완료했습니다!')}</strong>${s.showCounts!==false&&Number.isInteger(waiting.found)&&Number.isInteger(waiting.required)?`<p>현재 ${waiting.found} / ${waiting.required}명 완료</p>`:''}<p class="pre-line">${esc(s.body||'다른 팀원이 조건을 완료할 때까지 기다려주세요.')}</p></section>`;
}
