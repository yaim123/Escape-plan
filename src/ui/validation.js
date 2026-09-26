import {probePlayAssets} from './asset-probe.js';
const acceptedAssets=new WeakMap();
export const approvedAssetFailures=room=>acceptedAssets.get(room)||[];
import {inspectForPlay} from '../core/model.js';
import {modal,esc} from './dom.js';
export async function canRun(room){
 const {errors,warnings}=inspectForPlay(room);
 if(errors.length){modal(`<div class="modal-body"><h2>실행 전 설정을 확인하세요</h2><p>초안은 저장할 수 있습니다. 다음 항목을 수정한 뒤 실행하세요.</p><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`);return false;}
 const external=await probePlayAssets(room);warnings.push(...external.warnings);
 if(!warnings.length){acceptedAssets.set(room,[]);return true;}
 return new Promise(resolve=>{
  let accepted=false;
  const d=modal(`<div class="modal-body"><h2>일부 자료에 문제가 있습니다.</h2><ul>${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul><p>문제가 있는 자료 없이 방탈출을 시작하시겠습니까? 제작 원본은 그대로 유지됩니다.</p><div class="actions"><button class="btn" data-cancel>돌아가서 수정</button><button class="btn primary" data-continue>문제 있는 자료 없이 시작</button></div></div>`);
  d.querySelector('[data-cancel]').onclick=()=>d.close();d.querySelector('[data-continue]').onclick=()=>{accepted=true;acceptedAssets.set(room,external.urls);d.close();};
  d.addEventListener('close',()=>resolve(accepted),{once:true});
 });
}
