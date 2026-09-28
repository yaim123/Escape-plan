import {roleRows,expandRoleRows,roleReferences,roleNames,roleViewsEnabled,audienceRoles,teamChatEnabled,waitingSettings} from '../core/team-settings.js';
import {chatSettingsHtml,mountChatSettings} from './chat-settings.js';
import {teamWaitingHtml} from './team-waiting.js';
import {esc,field,options,confirmDialog,toast} from './dom.js';
export function teamSettingsHtml(room){
 if(room.playMode!=='team')return '';
 const t=room.teamSettings,w=waitingSettings(room),check=(path,value,label)=>`<label class="check"><input type="checkbox" data-room-field="teamSettings.${path}" ${value?'checked':''}>${label}</label>`;
 return `<div id="team-settings"><h3>기본 팀 설정</h3>${field('팀 수',`<input data-room-field="teamSettings.teamCount" type="number" min="1" max="20" value="${t.teamCount}">`)}${field('팀당 최대 인원 (빈칸: 제한 없음)',`<input data-room-field="teamSettings.maxMembers" type="number" min="1" max="20" value="${t.maxMembers??''}">`)}<hr><h3>역할</h3>${check('rolesEnabled',t.rolesEnabled,'역할 사용')}${t.rolesEnabled?`<div id="role-rows">${roleRows(t.roles).map((r,i)=>`<div class="role-row" data-role-row="${i}"><input data-role-name aria-label="역할 이름" maxlength="80" value="${esc(r.name)}"><label><input data-role-count aria-label="역할 인원" type="number" min="1" max="20" value="${r.count}">명</label><button class="btn small" type="button" data-role-delete="${i}">삭제</button></div>`).join('')}</div><button class="btn" type="button" data-role-add>+ 역할 추가</button><p>총 역할 자리: ${t.roles.length}명</p><p class="muted">팀원 번호 순서로 배정합니다. 역할 자리보다 팀원이 많으면 수업을 시작할 수 없습니다.</p><h3>역할별 화면</h3>${check('roleViewsEnabled',t.roleViewsEnabled,'역할별 화면 분리')}`:''}<hr><h3>팀 채팅</h3>${check('chatEnabled',teamChatEnabled(room),'팀 채팅 기능')}${teamChatEnabled(room)?`<details><summary>채팅방 관리</summary>${chatSettingsHtml(room,null)}</details>`:''}<hr><h3>팀 대기 화면</h3>${field('대기 화면 제목',`<input data-room-field="teamSettings.waiting.title" maxlength="200" value="${esc(w.title)}">`)}${field('대기 안내 문구',`<textarea data-room-field="teamSettings.waiting.body" maxlength="2000">${esc(w.body)}</textarea>`)}${check('waiting.showCounts',w.showCounts,'진행 인원 표시')}<div id="team-wait-preview">${teamWaitingHtml({found:2,required:4},w)}</div></div>`;
}
export function mountTeamSettings(root,room,changed,redraw){
 const el=root.querySelector('#team-settings');if(!el)return;
 mountChatSettings(el,room,null,changed,redraw);
 const refsText=name=>{const refs=roleReferences(room,name);return `'${name}' 역할이 ${refs.blocks}개의 블록과 ${refs.chats}개의 채팅방에서 사용 중입니다. 참조는 자동 변경하지 않습니다. 대상 설정을 수정하기 전에는 수업을 시작할 수 없습니다.`;};
 const confirmRefs=async(name,verb)=>{const r=roleReferences(room,name);return !(r.blocks||r.chats)||await confirmDialog(`역할을 ${verb}할까요?`,refsText(name));};
 el.addEventListener('input',e=>{if(e.target.matches('[data-role-name],[data-role-count]'))e.stopPropagation();});
 el.addEventListener('change',async e=>{
  if(!e.target.matches('[data-role-name],[data-role-count]'))return;e.stopPropagation();
  const rows=roleRows(room.teamSettings.roles),i=Number(e.target.closest('[data-role-row]').dataset.roleRow),old=rows[i].name;
  if(e.target.hasAttribute('data-role-name'))rows[i].name=e.target.value.trim();else rows[i].count=Number(e.target.value);
  try{const roles=expandRoleRows(rows);if(rows[i].name!==old&&!await confirmRefs(old,'변경')){redraw();return;}room.teamSettings.roles=roles;changed();}catch(error){toast(error.message,true);}redraw();
 });
 el.addEventListener('click',async e=>{
  const del=e.target.closest('[data-role-delete]'),add=e.target.closest('[data-role-add]');if(!del&&!add)return;e.stopPropagation();
  const rows=roleRows(room.teamSettings.roles);
  if(del){const i=Number(del.dataset.roleDelete);if(!await confirmRefs(rows[i].name,'삭제'))return;rows.splice(i,1);}else{let n=1;while(rows.some(r=>r.name===`새 역할 ${n}`))n++;rows.push({name:`새 역할 ${n}`,count:1});}
  room.teamSettings.roles=expandRoleRows(rows);changed();redraw();
 });
}
export function roleAudienceHtml(room,b){
 if(!roleViewsEnabled(room))return '';
 const roles=audienceRoles(b);
 return `<fieldset class="role-audience"><legend>누가 보는 블록인가요?</legend><select data-role-audience>${options({all:'팀 전체',roles:'특정 역할'},roles.length?'roles':'all')}</select>${roles.length?`<div class="check-grid">${[...new Set([...roleNames(room),...roles])].map(r=>`<label class="check"><input type="checkbox" data-visible-role="${esc(r)}" ${roles.includes(r)?'checked':''}>${esc(r)}${!roleNames(room).includes(r)?' (삭제된 역할)':''}</label>`).join('')}</div>`:''}<small>정답·완료 조건은 그대로 사용합니다. 배정 방식이 특정 팀원/역할이면 해당 제한도 함께 적용됩니다.</small></fieldset>`;
}
