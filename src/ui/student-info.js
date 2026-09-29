import {DISPLAY_FIELDS,displayPolicy} from '../core/presentation.js';
import {esc,formatTime} from './dom.js';
import {safeUrl} from '../core/model.js';
export function informationRows(c){
 const p=c.progress||{},s=c.displayStats||{},seconds=Math.max(0,Math.floor((c.elapsedMs??c.timing?.elapsedMs??0)/1000));
 const rank=c.rankVisible?c.result?.rank:null;
 const values={title:c.title,description:c.description,stage:c.current?.stage,stageName:c.stageName,progress:p.totalCount?`${Math.round((p.completedCount||0)/p.totalCount*100)}%`:'0%',completed:`${p.completedCount||0}/${p.totalCount||0}`,elapsed:formatTime(seconds),remaining:s.timeLimit?formatTime(Math.max(0,s.timeLimit*60-seconds)):'제한 없음',connection:c.connection||'연결 확인 중',mode:c.playMode==='team'?'팀전':'개인전',student:c.studentName,team:c.team?`${c.team}조`:'',role:p.role,score:s.score,wrong:s.wrongCount??Object.values(p.wrongCounts||{}).reduce((a,b)=>a+Number(b),0),hints:`${s.hintsUsed??0}회 사용 / ${s.hintsRemaining==null?'제한 없음':s.hintsRemaining+'회 남음'}`,penalty:s.penaltySeconds==null?'':`시간 +${s.penaltySeconds}초${s.penaltyPoints?` · 점수 −${s.penaltyPoints}`:''}`,rank:rank?rank+'위':'',board:c.rankVisible?(c.leaderboard||[]).map(r=>`${r.label} ${r.rank}위`).join(' · '):'',blockTitle:c.current?.title,blockType:{story:'스토리',guide:'안내',question:'문제'}[c.current?.type]};
 return Object.entries(DISPLAY_FIELDS).filter(([key])=>values[key]!==null&&values[key]!==undefined&&values[key]!=='').map(([key,label])=>({key,label,value:String(values[key]),mode:displayPolicy(c.studentDisplaySettings,key,c.immersive)}));
}
export function informationHtml(c,mode){return informationRows(c).filter(r=>r.mode===mode).map(r=>`<div class="student-info-item" data-info-key="${r.key}"><small>${esc(r.label)}</small><span>${esc(r.value)}</span></div>`).join('');}
const panels=new WeakMap();
export function clearStudentInfo(root){panels.delete(root);}
export function rememberStudentInfo(root){const panel=root.querySelector('[data-scene-panel]')||root.querySelector('[data-info-panel]');if(panel)panels.set(root,{open:!panel.hidden,top:panel.scrollTop,element:panel});}
function updateRows(host,rows){
 const keys=new Set(rows.map(r=>r.key));for(const el of host.querySelectorAll('[data-info-key]'))if(!keys.has(el.dataset.infoKey))el.remove();
 rows.forEach((r,i)=>{let el=host.querySelector(`[data-info-key="${r.key}"]`);if(!el){el=document.createElement('div');el.className='student-info-item';el.dataset.infoKey=r.key;el.innerHTML='<small></small><span></span>';host.append(el);}if(el.children[0].textContent!==r.label)el.children[0].textContent=r.label;if(el.children[1].textContent!==r.value)el.children[1].textContent=r.value;if(host.children[i]!==el)host.insertBefore(el,host.children[i]||null);});
}
export function renderStudentInfo(root,c){
 const scene=root.querySelector('.immersive-scene'),saved=panels.get(root)||{open:false,top:0};c={...c,immersive:!!scene};const rows=informationRows(c);
 let panel,button;
 if(scene){const host=scene.querySelector('[data-scene-metadata]');if(host)updateRows(host,rows.filter(r=>r.mode==='info'));panel=scene.querySelector('[data-scene-panel]');button=scene.querySelector('[data-scene-info]');}
 else {const host=root.querySelector('#student-meta');if(!host)return;
  if(!host.querySelector('[data-info-panel]'))host.innerHTML='<div class="student-always"></div><button type="button" class="student-info-button" aria-label="게임 정보" data-info-open>ⓘ</button><aside class="student-info-panel" data-info-panel hidden><button class="btn small" type="button" data-info-close>정보 닫기</button><div data-info-rows></div></aside>';
  panel=host.querySelector('[data-info-panel]');button=host.querySelector('[data-info-open]');updateRows(host.querySelector('.student-always'),rows.filter(r=>r.mode==='always'));updateRows(host.querySelector('[data-info-rows]'),rows.filter(r=>r.mode==='info'));button.hidden=!rows.some(r=>r.mode==='info');
  host.onclick=e=>{e.stopPropagation();if(e.target.closest('[data-info-open]')){panel.hidden=!panel.hidden;if(!panel.hidden)panel.scrollTop=0;}else if(e.target.closest('[data-info-close]'))panel.hidden=true;button.setAttribute('aria-expanded',String(!panel.hidden));rememberStudentInfo(root);};
 }
 if(!panel)return;
 // Preserve the open panel even when the current scene itself was replaced.
 if(saved.element!==panel){panel.hidden=!saved.open;panel.scrollTop=saved.top;}
 if(!panel.dataset.infoTracked){panel.dataset.infoTracked='true';panel.addEventListener('scroll',()=>rememberStudentInfo(root),{passive:true});}
 button?.setAttribute('aria-expanded',String(!panel.hidden));rememberStudentInfo(root);
}
export function mountBgm(root,theme={},sound={}){
 const url=safeUrl(theme.bgm);if(!url)return {update(){},dispose(){}};
 const audio=new Audio(url);audio.loop=true;audio.volume=Math.max(0,Math.min(1,Number(sound.volume??.35)));let started=false,disposed=false,paused=false;
 function update(status){paused=status==='paused'||status==='finished';if(paused)audio.pause();else if(started&&!audio.muted)audio.play().catch(()=>{});
  let host=root.querySelector('[data-bgm-controls]');const parent=root.querySelector('.immersive-panel')||root;
  if(!host||host.parentNode!==parent){host?.remove();host=document.createElement('div');host.dataset.bgmControls='';host.className='bgm-controls';parent.append(host);}
  host.innerHTML=`<button class="btn small" type="button" ${paused?'disabled':''}>${!started?'배경음악 시작':audio.muted?'음악 켜기':'음악 끄기'}</button><span role="status"></span>`;
  const btn=host.querySelector('button');btn.hidden=started&&sound.allowMute===false;
  btn.onclick=async e=>{e.stopPropagation();if(disposed||paused)return;try{if(!started){await audio.play();started=true;}else{audio.muted=!audio.muted;if(!audio.muted)await audio.play();}update(status);}catch{host.querySelector('span').textContent='음악을 재생하지 못했습니다. 게임은 계속 진행할 수 있습니다.';}};
 }
 return {update,dispose(){disposed=true;audio.pause();audio.removeAttribute('src');audio.load();root.querySelector('[data-bgm-controls]')?.remove();}};
}
