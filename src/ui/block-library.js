import {BlockLibrary} from '../data/block-library.js';
import {blockLibraryPayload} from '../core/block-library.js';
import {BLOCK_TYPES} from '../core/model.js';
import {esc,modal,toast} from './dom.js';
export function saveBlockDialog(repo,room,blockId){
 const payload=blockLibraryPayload(room,blockId),library=new BlockLibrary(repo);
 const d=modal(`<form class="modal-body"><h2>보관함에 저장</h2><p>${esc(payload.block.title)} · ${BLOCK_TYPES[payload.block.type]}</p><label class="field"><span>태그 (쉼표로 구분)</span><input name="tags" maxlength="1500"></label><p class="muted">현재 블록과 QR·미디어 설정을 개인 보관함에 복사합니다.${repo.mode==='local'?' 로컬 체험에서는 이 브라우저에만 보관됩니다.':''}</p><button class="btn primary" type="submit">보관함에 저장</button><p role="status"></p></form>`);
 d.querySelector('form').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{await library.save(payload,new FormData(e.target).get('tags'));d.close();toast('개인 보관함에 저장했습니다.');}catch(error){e.target.querySelector('[role=status]').textContent=error.message;}finally{btn.disabled=false;}};
}
export async function libraryPicker(repo,onImport){
 const library=new BlockLibrary(repo);let entries=await library.list();
 const d=modal(`<div class="modal-body"><h2>보관함에서 가져오기</h2><label class="field"><span>제목 / 태그 검색</span><input data-library-search></label><p class="muted">독립 블록과 새 QR 식별자로 가져옵니다. 다른 블록을 참조하는 공개 조건은 제외되므로 가져온 뒤 다시 연결하세요.</p><div data-library-rows></div><p role="status"></p></div>`);
 function draw(){const query=d.querySelector('[data-library-search]').value.toLocaleLowerCase();d.querySelector('[data-library-rows]').innerHTML=entries.filter(e=>[e.title,...e.tags].join(' ').toLocaleLowerCase().includes(query)).map(e=>`<article class="library-block-row"><strong>${esc(e.title)}</strong><p>${BLOCK_TYPES[e.type]} · ${esc(new Date(e.created_at).toLocaleDateString('ko-KR'))}<br>태그: ${esc(e.tags.join(', ')||'없음')}</p><div class="actions"><button class="btn primary" data-library-import="${e.id}">가져오기</button><button class="btn danger-text" data-library-delete="${e.id}">보관함에서 삭제</button></div></article>`).join('')||'<p>일치하는 보관함 블록이 없습니다.</p>';}
 d.querySelector('[data-library-search]').oninput=draw;draw();
 d.onclick=async e=>{const btn=e.target.closest('[data-library-import],[data-library-delete]');if(!btn)return;const entry=entries.find(x=>x.id===(btn.dataset.libraryImport||btn.dataset.libraryDelete));btn.disabled=true;
  try{if(btn.dataset.libraryImport){onImport(structuredClone(entry.payload));d.close();}else{
   // Inline confirmation preserves this picker and its selection/search state.
   if(btn.dataset.confirm!=='yes'){btn.dataset.confirm='yes';btn.textContent='정말 삭제';btn.disabled=false;return;}
   const result=await library.remove(entry);entries=entries.filter(x=>x.id!==entry.id);draw();toast(result?.cleanupFailed?'보관함은 삭제했습니다. 연결 오류로 일부 미사용 파일 정리가 남았습니다.':'보관함에서 삭제했습니다. 가져간 블록은 유지됩니다.',!!result?.cleanupFailed);
  }}catch(error){d.querySelector('[role=status]').textContent=error.message;}finally{btn.disabled=false;}
 };
}
