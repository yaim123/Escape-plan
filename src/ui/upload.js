import {modal,esc,options} from './dom.js';
import {MediaStorage} from '../data/media-storage.js';
export const fileSize=n=>n>=1048576?(n/1048576).toFixed(1)+'MB':Math.round(n/1024)+'KB';
export function uploadDialog(repo,roomId,{kind='image',background=false,fixedKind=false,onCommit,verify}={}){
 return new Promise(resolve=>{
  let busy=false,committed=false;const storage=new MediaStorage(repo);
  const d=modal(`<div class="modal-body"><h2>파일 업로드</h2><p>이미지 15MB · 음성 20MB · 영상 100MB 이하</p><label class="field">자료 유형<select data-upload-kind ${background||fixedKind?'disabled':''}>${options({image:'이미지',audio:'음성',video:'영상'},kind)}</select></label><label class="field" data-optimize>이미지 최적화<select data-quality>${options({recommended:'수업용 권장',high:'고화질',original:'원본 유지'},'recommended')}</select></label><label class="upload-drop" tabindex="0">파일을 선택하거나 이곳에 끌어놓으세요.<input type="file" data-upload-file></label><progress max="100" value="0" class="wide"></progress><p data-upload-status role="status"></p><div data-upload-preview></div><button class="btn primary" data-done hidden>완료</button></div>`);
  const update=()=>{kind=d.querySelector('[data-upload-kind]').value;d.querySelector('[data-optimize]').hidden=kind!=='image';d.querySelector('[data-upload-file]').accept=kind==='image'?'.jpg,.jpeg,.png,.webp,.gif':kind==='audio'?'.mp3,.m4a,.wav,.ogg,.webm':'.mp4,.webm';};update();d.querySelector('[data-upload-kind]').onchange=update;
  const status=d.querySelector('[data-upload-status]');
  const run=async file=>{if(!file||busy||committed)return;busy=true;d.querySelector('.modal-close').disabled=true;status.textContent='최적화 및 업로드 중…';d.querySelectorAll('input,select').forEach(el=>el.disabled=true);
   try{const asset=await storage.upload(roomId,file,kind,{mode:d.querySelector('[data-quality]').value,background,onProgress:n=>{d.querySelector('progress').value=n;status.textContent=`${file.name} · 업로드 ${n}%`;}});await storage.commit(asset,()=>onCommit(asset),url=>verify(url));committed=true;status.textContent=`${asset.name} · 원본 ${fileSize(asset.originalSize)} → ${fileSize(asset.size)} · 저장 완료`;d.querySelector('[data-upload-preview]').innerHTML=kind==='image'?`<img class="upload-preview" src="${esc(asset.url)}" alt="업로드 미리보기">`:`<${kind} controls src="${esc(asset.url)}"></${kind}>`;d.querySelector('[data-done]').hidden=false;}
   catch(e){status.textContent=e.message;}finally{busy=false;d.querySelector('.modal-close').disabled=false;d.querySelectorAll('input,select').forEach(el=>el.disabled=committed);d.querySelector('[data-upload-kind]').disabled=committed||background||fixedKind;if(!committed)d.querySelector('[data-upload-file]').value='';}
  };
  d.querySelector('[data-upload-file]').onchange=e=>run(e.target.files[0]);const drop=d.querySelector('.upload-drop');drop.ondragover=e=>e.preventDefault();drop.ondrop=e=>{e.preventDefault();run(e.dataTransfer.files[0]);};
  d.querySelector('[data-done]').onclick=()=>d.close();const cancel=e=>{if(busy)e.preventDefault();};d.addEventListener('cancel',cancel);d.addEventListener('close',()=>{d.removeEventListener('cancel',cancel);resolve(committed);},{once:true});
 });
}
