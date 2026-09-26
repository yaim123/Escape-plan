import {safeAssetUrl} from '../core/model.js';
import {esc} from './dom.js';
export const isImmersive=b=>b?.type==='story'&&b.display==='immersive';
export function immersiveHtml(b,{preview=false,title='',progress='',time='',connection='',extra='',infoHtml=null}={}){
 const url=safeAssetUrl(b.backgroundUrl);
 return `<section class="immersive-scene ${preview?'immersive-preview':'immersive-full'} ${b.immersiveOverlay!==false?'overlay-on':'overlay-off'} ${url?'':'image-failed'}" tabindex="0" aria-label="스토리 화면. Enter 또는 Space로 진행">
 ${url?`<img class="immersive-image" src="${esc(url)}" alt="" data-scene-image>`:''}<div class="immersive-gradient" aria-hidden="true"></div>
 <button type="button" class="immersive-info" data-scene-info aria-label="게임 정보" aria-expanded="false">ⓘ</button>
 <aside class="immersive-panel" data-scene-panel hidden aria-label="게임 정보"><button type="button" class="btn small" data-scene-close>정보 닫기</button>${infoHtml!==null?`<div data-scene-metadata>${infoHtml}</div>`:`<h2>${esc(title)}</h2><p data-scene-progress>${esc(progress)}</p><p data-scene-time>${esc(time)}</p><p data-scene-connection>${esc(connection)}</p><p>STAGE ${esc(b.stage)} · 스토리</p><h3>${esc(b.title)}</h3>`}${extra}<p data-scene-error role="alert"></p></aside>
 <div class="immersive-subtitle">${esc(b.body)}</div><span class="immersive-prompt">화면을 터치해주세요</span></section>`;
}
export function sceneShouldAdvance(target,scene){return !target.closest('button,a,input,select,textarea,[data-scene-panel],.immersive-subtitle')&&scene.contains(target);}
export function mountImmersive(root,onAdvance=()=>{}){
 const scene=root.querySelector('.immersive-scene');if(!scene)return;
 const info=scene.querySelector('[data-scene-info]'),panel=scene.querySelector('[data-scene-panel]');
 const toggle=open=>{panel.hidden=!open;info.setAttribute('aria-expanded',String(open));(open?panel.querySelector('button'):info).focus();};
 const advance=async()=>{if(scene.dataset.busy||!panel.hidden)return;scene.dataset.busy='true';try{await onAdvance();}catch(e){scene.querySelector('[data-scene-error]').textContent=e.message;toggle(true);}finally{delete scene.dataset.busy;}};
 scene.onclick=e=>{e.stopPropagation();if(e.target.closest('[data-scene-info]'))toggle(panel.hidden);else if(e.target.closest('[data-scene-close]'))toggle(false);else if(sceneShouldAdvance(e.target,scene))advance();};
 scene.onkeydown=e=>{if(e.key==='Escape'&&!panel.hidden){e.stopPropagation();toggle(false);return;}if(e.target===scene&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();advance();}};
 const img=scene.querySelector('[data-scene-image]');if(img){const fail=()=>{img.hidden=true;scene.classList.add('image-failed');};img.onerror=fail;if(img.complete&&!img.naturalWidth)fail();}
}
