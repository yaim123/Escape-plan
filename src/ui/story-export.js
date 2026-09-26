import {buildStoryTextExport} from '../core/story-export.js';
import {copyStoryText,downloadStoryText} from '../data/story-export.js';
import {modal,toast} from './dom.js';

export function storyExportDialog(room){
 const d=modal(`<div class="modal-body story-export"><h2>스토리 텍스트로 내보내기</h2>
  <fieldset><legend>콘텐츠 범위</legend><div class="story-export-options">
   <label class="check"><input type="radio" name="story-scope" value="story" checked>스토리만</label>
   <label class="check"><input type="radio" name="story-scope" value="story-guide">스토리 + 안내</label>
   <label class="check"><input type="radio" name="story-scope" value="all">모든 콘텐츠</label>
  </div></fieldset><div class="story-export-options">
   <label class="check"><input type="checkbox" data-story-numbers checked>블록 번호 포함</label>
   <label class="check"><input type="checkbox" data-story-stages>스테이지 제목 포함</label>
   <label class="check"><input type="checkbox" data-story-answers disabled>정답 포함</label>
  </div><p class="muted">번호는 전체 콘텐츠 순서를 따릅니다. 정답은 ‘모든 콘텐츠’에서만 포함할 수 있습니다.</p>
  <label class="field"><span>텍스트 미리보기</span><textarea data-story-preview readonly rows="15" spellcheck="false"></textarea></label>
  <p data-story-status role="status"></p><div class="actions"><button type="button" class="btn" data-story-copy>전체 복사</button><button type="button" class="btn primary" data-story-download>TXT로 저장</button></div></div>`);
 const preview=d.querySelector('[data-story-preview]'),status=d.querySelector('[data-story-status]');
 const update=()=>{
  const scope=d.querySelector('[name=story-scope]:checked').value,answers=d.querySelector('[data-story-answers]');answers.disabled=scope!=='all';
  preview.value=buildStoryTextExport(room,{scope,numbers:d.querySelector('[data-story-numbers]').checked,stages:d.querySelector('[data-story-stages]').checked,answers:scope==='all'&&answers.checked});
  status.textContent=preview.value?'':'선택한 범위에 내보낼 콘텐츠가 없습니다.';
  d.querySelector('[data-story-copy]').disabled=d.querySelector('[data-story-download]').disabled=!preview.value;
 };
 d.onchange=update;update();
 d.querySelector('[data-story-copy]').onclick=async()=>{try{await copyStoryText(preview);status.textContent='스토리 텍스트를 복사했습니다.';toast(status.textContent);}catch(e){status.textContent=e.message;}};
 d.querySelector('[data-story-download]').onclick=()=>{downloadStoryText(room.title,preview.value);status.textContent='TXT 파일을 저장했습니다.';};
 return d;
}
