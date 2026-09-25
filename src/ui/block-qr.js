import {ensureBlockQr} from '../core/model.js';
import {newQr,qrUrl} from '../core/qr.js';
import {qrLibrary} from './qr.js';
import {field,options,esc,toast} from './dom.js';
export function blockQrFields(room,b){const m=ensureBlockQr(room,b);
 return `<section class="block-qr-editor" id="block-qr-editor"><h3>이 문제의 QR</h3>${field('완료 조건',`<select data-qr-setting="mode">${options({ANY:'등록 QR 중 하나 이상',ALL:'등록 QR 전부',N_OF_M:'N개 이상',UNIQUE_MEMBER:'팀원별 서로 다른 QR'},m.mode)}</select>`)}${m.mode==='N_OF_M'?field('필요한 QR 개수',`<input type="number" min="1" data-qr-setting="count" value="${m.count}">`):''}${field('완료 범위',`<select data-qr-setting="scope">${options({student:'스캔한 학생만',team:'팀 전체'},b.qrScope)}</select>`)}<p class="muted">팀 전체는 함께 모은 QR로 판정합니다. 팀원별 서로 다른 QR은 팀 전체 범위에서 사용하세요.</p>${field('QR 배포 사이트 주소',`<input data-qr-base value="${esc(room.qrBaseUrl||location.origin+location.pathname)}">`,'GitHub Pages의 저장소 경로까지 입력하세요.')}<div class="qr-codes">${m.codes.map((q,i)=>`<section class="qr-code-row" data-qr-index="${i}">${field('QR 이름',`<input data-qr-name value="${esc(q.name)}" maxlength="100">`)}<label class="check"><input type="checkbox" data-qr-active ${q.active?'checked':''}>활성</label><div class="qr-preview" data-qr-preview="${i}"></div><div class="actions"><button class="btn small" type="button" data-qr-large="${i}">QR 크게 보기</button><button class="btn small" type="button" data-qr-download="${i}">QR 이미지 저장</button><button class="btn small" type="button" data-qr-delete="${i}">QR 삭제</button></div></section>`).join('')}</div><button class="btn" type="button" data-qr-add>QR 추가</button><p class="muted">SVG 이미지를 저장해 인쇄할 수 있습니다. QR 안에는 학생 정보나 정답이 들어가지 않습니다.</p></section>`;
}
export function mountBlockQr(root,room,b,changed,redraw){const el=root.querySelector('#block-qr-editor');if(!el)return;
 const m=ensureBlockQr(room,b);
 qrLibrary('qrcode-generator').then(()=>{if(!el.isConnected)return;for(const item of el.querySelectorAll('[data-qr-preview]')){const q=m.codes[Number(item.dataset.qrPreview)],g=globalThis.qrcode(0,'M');g.addData(qrUrl(q.token,room.qrBaseUrl||location.origin+location.pathname));g.make();item.innerHTML=g.createSvgTag({cellSize:4,margin:16,scalable:true});}}).catch(e=>{if(el.isConnected)toast(e.message,true);});
 el.oninput=e=>{e.stopPropagation();const target=e.target,i=Number(target.closest('[data-qr-index]')?.dataset.qrIndex);
  if(target.hasAttribute('data-qr-name'))m.codes[i].name=target.value;
  else if(target.hasAttribute('data-qr-base'))room.qrBaseUrl=target.value;
  else if(target.dataset.qrSetting==='count')m.count=Number(target.value);
  else return;changed();
 };
 el.onchange=e=>{e.stopPropagation();const target=e.target,i=Number(target.closest('[data-qr-index]')?.dataset.qrIndex);
  if(target.hasAttribute('data-qr-active'))m.codes[i].active=target.checked;
  else if(target.dataset.qrSetting==='scope')m.scope=b.qrScope=target.value;
  else if(target.dataset.qrSetting==='mode')m.mode=target.value;
  else if(!target.hasAttribute('data-qr-base'))return;changed();redraw();
 };
 el.onclick=e=>{const button=e.target.closest('button');if(!button)return;e.stopPropagation();
  if(button.hasAttribute('data-qr-add')){if(m.codes.length>=32)return toast('QR은 최대 32개입니다.',true);m.codes.push(newQr());}
  else if(button.hasAttribute('data-qr-delete')){const i=Number(button.dataset.qrDelete),id=m.codes[i].id;m.codes.splice(i,1);for(const block of room.content)block.unlock.conditions=block.unlock.conditions.filter(c=>c.blockId!==id);}
  else if(button.hasAttribute('data-qr-large')){el.querySelector(`[data-qr-preview="${button.dataset.qrLarge}"]`).classList.toggle('large');return;}
  else if(button.hasAttribute('data-qr-download')){const i=Number(button.dataset.qrDownload),svg=el.querySelector(`[data-qr-preview="${i}"] svg`);if(!svg)return;const url=URL.createObjectURL(new Blob([svg.outerHTML],{type:'image/svg+xml'})),a=document.createElement('a');a.href=url;a.download=m.codes[i].name+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
  else return;changed();redraw();
 };
}
