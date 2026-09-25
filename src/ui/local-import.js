import {pendingLocalDrafts,importLocalDrafts} from '../data/local-import.js';
import {modal,esc,toast} from './dom.js';
export async function offerLocalImport(repo){
 let rooms;try{rooms=await pendingLocalDrafts(repo);}catch(e){toast(e.message,true);return;}
 if(!rooms.length)return;
 await new Promise(resolve=>{
  const d=modal(`<div class="modal-body"><h2>로컬 제작물 가져오기</h2><p>로컬에서 제작한 방탈출 ${rooms.length}개가 있습니다. 계정으로 가져오시겠습니까?</p><p>이 브라우저의 제작물만 가져오며 로컬 원본은 유지합니다.</p><div class="actions"><button class="btn primary" data-import-all>모두 가져오기</button><button class="btn" data-later>나중에</button></div><div role="status" data-import-status></div></div>`);
  d.addEventListener('close',resolve,{once:true});d.querySelector('[data-later]').onclick=()=>d.close();
  d.querySelector('[data-import-all]').onclick=async e=>{e.target.disabled=true;
   const result=await importLocalDrafts(repo,rooms);rooms=rooms.filter(r=>result.failed.some(f=>f.id===r.id));
   d.querySelector('[data-import-status]').innerHTML=`<p>${result.imported.length}개 가져오기 완료</p>${result.failed.map(f=>`<p>${esc(f.title)}: ${esc(f.message)} · 로컬 원본 유지</p>`).join('')}`;
   if(!rooms.length){toast(`${result.imported.length}개를 계정으로 가져왔습니다.`);d.close();}else e.target.disabled=false;
  };
 });
}
