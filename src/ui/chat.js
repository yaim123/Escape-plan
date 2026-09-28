import {esc} from './dom.js';
import {watchLobby} from '../data/realtime.js';

// Broadcasts contain no messages. Every refresh/read/send rechecks server membership.
export function mountChat(root,lobby,token){
 let disposed=false,game,rooms=[],identity='',context='',generation=0,selected=null,messages=[],pending=null,loading=false,again=false,debounce;
 const seen=new Map(),subscriptions=new Map(),button=document.createElement('button'),dialog=document.createElement('dialog');
 button.className='btn chat-launch';button.type='button';button.hidden=true;button.setAttribute('aria-label','팀 채팅');
 dialog.className='chat-drawer';dialog.setAttribute('aria-label','팀 채팅');root.append(button);document.body.append(dialog);
 const rpc=(action,extra={})=>lobby.rpc('escape_chat',{p_token:token(),p_action:action,...extra});
 const enabled=()=>game?.status==='playing'&&game.playMode==='team'&&game.teamChatEnabled!==false&&!game.result&&game.current?.chatEnabled;
 const key=id=>`escape-studio:chat-seen:${identity}:${id}`;
 const readSeen=id=>{if(!seen.has(id)){try{seen.set(id,Number(localStorage.getItem(key(id)))||0);}catch{seen.set(id,0);}}return seen.get(id);};
 const mark=()=>{const r=rooms.find(r=>r.id===selected);if(r){seen.set(r.id,r.count);try{localStorage.setItem(key(r.id),String(r.count));}catch{/* Unread falls back to this page's memory. */}}badge();};
 const badge=()=>{const unread=rooms.reduce((n,r)=>n+Math.max(0,r.count-readSeen(r.id)),0);button.textContent=`💬${unread?' '+unread:''}`;button.hidden=!enabled()||!rooms.length;button.setAttribute('aria-label',`팀 채팅${unread?` · 읽지 않은 메시지 ${unread}개`:''}`);};
 const close=()=>{dialog.close();selected=null;messages=[];pending=null;};
 dialog.addEventListener('close',()=>{selected=null;messages=[];pending=null;button.focus();});
 const status=text=>{const el=dialog.querySelector('[data-chat-error]');if(el)el.textContent=text;};
 const renderMessages=()=>{const list=dialog.querySelector('[data-chat-messages]');if(!list)return;const near=list.scrollHeight-list.scrollTop-list.clientHeight<80;
  list.innerHTML=messages.map(m=>`<article class="chat-message ${m.mine?'mine':''}"><strong>${esc(m.name)}</strong><p>${esc(m.text)}</p><time>${esc(new Date(m.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}))}</time></article>`).join('')||'<p class="muted">첫 메시지를 보내보세요.</p>';if(near)list.scrollTop=list.scrollHeight;
 };
 const fetchMessages=async(before=null)=>{const id=selected,version=generation;if(!id||!dialog.open)return;try{const r=await rpc('read',{p_room:id,p_before:before});if(disposed||version!==generation||id!==selected||!dialog.open)return;
  messages=[...new Map([...messages,...r.messages].map(m=>[m.id,m])).values()].sort((a,b)=>Number(a.id)-Number(b.id));const room=rooms.find(x=>x.id===id);if(room)room.count=r.count;renderMessages();mark();
  if(before&&!r.messages.length)status('가장 오래된 메시지입니다.');
 }catch(e){if(version!==generation||disposed)return;status(e.message);if(e.code==='42501'){close();schedule();}}};
 const select=async id=>{selected=id;messages=[];pending=null;const r=rooms.find(c=>c.id===id);if(!r)return;dialog.innerHTML=`<div class="chat-heading"><h2>${esc(r.name)}</h2><button class="btn" data-chat-close>닫기</button></div>${rooms.length>1?'<button class="btn small" data-chat-back>다른 채팅방</button>':''}<button class="btn small" data-chat-older>이전 메시지</button><div data-chat-messages class="chat-messages" role="log" aria-live="polite"></div><form data-chat-form><label class="sr-only" for="chat-text">메시지</label><textarea id="chat-text" name="message" maxlength="1000" rows="2" required placeholder="메시지 입력"></textarea><button class="btn primary">전송</button></form><p data-chat-error role="status"></p>`;
  dialog.querySelector('[data-chat-close]').onclick=close;dialog.querySelector('[data-chat-back]')?.addEventListener('click',choose);dialog.querySelector('[data-chat-older]').onclick=()=>fetchMessages(messages[0]?.id||null);
  dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const input=e.target.elements.message,text=input.value.trim(),send=e.target.querySelector('button');if(!text||send.disabled)return;send.disabled=true;const version=generation;
   if(!pending||pending.text!==text||pending.room!==id)pending={text,room:id,id:crypto.randomUUID()};
   try{await rpc('send',{p_room:id,p_text:text,p_request:pending.id});if(disposed||version!==generation||selected!==id)return;pending=null;input.value='';status('');await fetchMessages();}
   catch(error){if(version===generation)status(error.message);}finally{send.disabled=false;}
  };dialog.querySelector('textarea').focus();await fetchMessages();};
 const choose=()=>{selected=null;messages=[];dialog.innerHTML=`<div class="chat-heading"><h2>팀 채팅</h2><button class="btn" data-chat-close>닫기</button></div>${rooms.map(r=>`<button class="btn wide" data-chat-room="${r.id}">${esc(r.name)}</button>`).join('')}<p data-chat-error role="status"></p>`;dialog.querySelector('[data-chat-close]').onclick=close;dialog.querySelectorAll('[data-chat-room]').forEach(b=>b.onclick=()=>select(b.dataset.chatRoom));};
 async function refresh(){if(disposed||!enabled())return;if(loading){again=true;return;}loading=true;const version=generation;
  try{const r=await rpc('list');if(disposed||version!==generation)return;identity=`${r.sessionId}:${r.participantId}`;rooms=r.rooms;
   for(const [id,stop] of subscriptions)if(!rooms.some(r=>r.id===id)){stop();subscriptions.delete(id);}
   for(const room of rooms)if(!subscriptions.has(room.id))subscriptions.set(room.id,watchLobby(lobby.repo.config,room.topic,schedule,()=>{}));
   if(selected&&!rooms.some(r=>r.id===selected))close();badge();if(dialog.open&&selected)await fetchMessages();
  }catch(e){if(!disposed&&version===generation){rooms=[];badge();if(dialog.open){status(e.message);if(e.code==='42501')close();}}}
  finally{loading=false;if(again){again=false;schedule();}}
 }
 function schedule(){if(!debounce&&!disposed)debounce=setTimeout(()=>{debounce=null;refresh();},150);}
 const open=async()=>{await refresh();if(disposed||!enabled()||!rooms.length)return;if(!dialog.open)dialog.showModal();if(rooms.length===1)await select(rooms[0].id);else choose();};button.onclick=open;
 const update=next=>{game=next;const nextContext=JSON.stringify([next.sessionId,next.status,next.current?.id,next.current?.chatEnabled,next.team,next.progress?.role,!!next.result]);if(nextContext!==context){context=nextContext;generation++;close();rooms=[];for(const stop of subscriptions.values())stop();subscriptions.clear();}badge();schedule();};
 const timer=setInterval(refresh,15000),visible=()=>{if(!document.hidden)schedule();};document.addEventListener('visibilitychange',visible);window.addEventListener('online',schedule);
 return {update,open,available:()=>rooms.length>0,dispose:()=>{disposed=true;generation++;clearInterval(timer);clearTimeout(debounce);for(const stop of subscriptions.values())stop();document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',schedule);dialog.remove();button.remove();}};
}
