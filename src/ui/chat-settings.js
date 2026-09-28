import {teamChatEnabled,roleNames} from '../core/team-settings.js';
import {newChatRoom} from '../core/chat.js';
import {esc,options} from './dom.js';
export function chatSettingsHtml(room,b){if(!teamChatEnabled(room))return '';return `<section id="chat-settings">${b?`<hr><h3>팀 채팅</h3><label class="field"><span>이 블록에서 팀 채팅</span><select data-chat-enabled>${options({off:'사용 안 함',on:'사용'},b.chatEnabled?'on':'off')}</select></label>`:''}${!b||b.chatEnabled?`<p class="muted">같은 채팅방을 여러 블록에 연결하면 이전 대화를 이어갑니다. 팀전 수업에서만 제공됩니다.</p>${(room.chatRooms||[]).map(c=>`<article class="chat-config" data-chat-id="${c.id}">${b?`<label class="check"><input type="checkbox" data-chat-link ${b.chatRoomIds?.includes(c.id)?'checked':''}>이 블록에 연결</label>`:''}<label class="field"><span>채팅방 이름</span><input data-chat-name value="${esc(c.name)}" maxlength="80"></label><label class="field"><span>참여 범위</span><select data-chat-scope>${options({team:'팀 전체',roles:'특정 역할'},c.scope)}</select></label>${c.scope==='roles'?`<div class="check-grid">${[...new Set([...roleNames(room),...c.roles])].map(r=>`<label class="check"><input type="checkbox" data-chat-role="${esc(r)}" ${c.roles.includes(r)?'checked':''}>${esc(r)}</label>`).join('')}</div>${!room.teamSettings.rolesEnabled?'<p class="callout">전체 설정에서 역할 사용을 켜세요.</p>':''}`:''}<small>설정을 수정하면 이 채팅방을 연결한 다른 블록에도 적용됩니다.</small></article>`).join('')}<button class="btn" type="button" data-chat-new>새 채팅방 만들기</button>`:''}</section>`;}
export function mountChatSettings(root,room,b,changed,redraw){const el=root.querySelector('#chat-settings');if(!el)return;
 el.oninput=e=>{e.stopPropagation();if(!e.target.hasAttribute('data-chat-name'))return;room.chatRooms.find(c=>c.id===e.target.closest('[data-chat-id]').dataset.chatId).name=e.target.value;changed();};
 el.onchange=e=>{e.stopPropagation();const t=e.target,c=room.chatRooms?.find(c=>c.id===t.closest('[data-chat-id]')?.dataset.chatId);
  if(t.hasAttribute('data-chat-enabled'))b.chatEnabled=t.value==='on';
  else if(t.hasAttribute('data-chat-link')){b.chatRoomIds=t.checked?[...new Set([...(b.chatRoomIds||[]),c.id])]:(b.chatRoomIds||[]).filter(id=>id!==c.id);}
  else if(t.hasAttribute('data-chat-scope')){c.scope=t.value;}
  else if(t.hasAttribute('data-chat-role'))c.roles=t.checked?[...new Set([...c.roles,t.dataset.chatRole])]:c.roles.filter(r=>r!==t.dataset.chatRole);
  else return;changed();redraw();};
 el.onclick=e=>{e.stopPropagation();if(!e.target.closest('[data-chat-new]'))return;if((room.chatRooms||[]).length>=32)return;const c=newChatRoom();(room.chatRooms??=[]).push(c);if(b)(b.chatRoomIds??=[]).push(c.id);changed();redraw();};
}
