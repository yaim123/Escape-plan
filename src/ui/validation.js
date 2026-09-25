import {validateForPlay} from '../core/model.js';
import {modal,esc} from './dom.js';
export function canRun(room){const errors=validateForPlay(room);if(!errors.length)return true;
 modal(`<div class="modal-body"><h2>실행 전 설정을 확인하세요</h2><p>초안은 저장할 수 있습니다. 다음 항목을 수정한 뒤 실행하세요.</p><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`);return false;}
