import {normalizeManualCode} from '../core/qr.js';
import {qrSuccessDetail} from '../core/qr-feedback.js';
import {esc,field,options,modal,toast} from './dom.js';
import {newQrMission,newQr,qrUrl,readQr} from '../core/qr.js';
import {LobbyClient} from '../data/lobby.js';
const loads=new Map();
export function qrLibrary(name){if(!loads.has(name))loads.set(name,new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL(`../vendor/${name}.js`,import.meta.url).href;script.onload=resolve;script.onerror=()=>{loads.delete(name);reject(Error('QR 도구를 불러오지 못했습니다.'));};document.head.append(script);}));return loads.get(name);}
export function qrProgressHtml(rows=[]){return rows.length?`<section class="panel qr-progress"><h3>QR 단서</h3>${rows.map(m=>`<p>${esc(m.name)} <strong>${m.found} / ${m.mode==='UNIQUE_MEMBER'?m.required:m.total}${m.mode==='UNIQUE_MEMBER'?'명':''}</strong> ${m.done?'✅ 완료':''}${m.insufficient?' · 팀원 수 이상의 활성 QR이 필요합니다.':''}</p>`).join('')}</section>`:'';}
// Server state commits immediately; only presentation waits for acknowledgement.
export function scanQrDialog(signal,onScan,{onChat,manual=false}={}){return new Promise(resolve=>{
 let stream,timer,closed=false,busy=false,lastToken=null,accepted=null,starting=false;
 const stop=()=>{clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());};
 const d=modal(`<div class="modal-body qr-scanner"><div class="qr-scan-inputs"><h2>${manual?'코드 직접 입력':'QR 스캔'}</h2>${onChat?'<button class="btn" type="button" id="qr-open-chat">팀 채팅 열기</button>':''}<div ${manual?'hidden':''}><p>카메라로 QR을 비추거나 QR 이미지·링크를 읽으세요.</p><video id="qr-video" playsinline muted></video><button type="button" class="btn primary" id="qr-camera">카메라 켜기</button>${field('QR 이미지 선택','<input id="qr-image" type="file" accept="image/*">')}</div><form id="qr-link-form">${field(manual?'직접 입력 코드':'QR 링크 입력',`<input name="link" type="text" required autocomplete="off" ${manual?'maxlength="8" autocapitalize="characters" placeholder="X7K4P2"':''}>`)}<button class="btn" type="submit">${manual?'코드 확인':'QR 링크 확인'}</button></form><p id="qr-error" role="status"></p></div><div class="scanner-error" hidden role="alertdialog" aria-modal="true" aria-labelledby="scan-error-title" aria-describedby="scan-error-detail"><div><h2 id="scan-error-title"></h2><p id="scan-error-detail"></p><button class="btn primary" type="button" id="qr-retry">확인</button></div></div></div>`);
 const inputs=d.querySelector('.qr-scan-inputs'),overlay=d.querySelector('.scanner-error'),ack=d.querySelector('#qr-retry'),close=d.querySelector('.modal-close');
 const setBusy=value=>{busy=value;inputs.inert=value;close.disabled=value;};
 const error=e=>{if(!closed)d.querySelector('#qr-error').textContent=e.message||e;};
 const showResult=(title,detail,success)=>{if(closed)return;setBusy(true);overlay.dataset.result=success?'success':'error';d.querySelector('#scan-error-title').textContent=title;d.querySelector('#scan-error-detail').textContent=detail;overlay.hidden=false;ack.focus();};
 ack.onclick=()=>{
  const result=accepted;accepted=null;overlay.hidden=true;setBusy(false);
  if(result&&!result.keepOpen){resolve(result);d.close();}else {inputs.querySelector('[name=link]').focus();}
  result?.onConfirm?.();
 };
 d.querySelector('#qr-open-chat')?.addEventListener('click',()=>{d.close();setTimeout(onChat,0);});
 const cancel=e=>{if(busy)e.preventDefault();};d.addEventListener('cancel',cancel);
 const focusResult=e=>{if(!overlay.hidden&&e.key==='Tab'){e.preventDefault();ack.focus();}};d.addEventListener('keydown',focusResult);
 const finish=async(value,fromCamera=false)=>{
  if(closed||busy)return;const token=manual?normalizeManualCode(value):readQr(value);if(fromCamera&&token===lastToken)return;setBusy(true);
  try{if(!token||manual&&!/^[A-HJ-NP-Z2-9]{6}$/.test(token))throw Error(manual?'코드를 확인해주세요.':'올바른 QR이 아닙니다.');lastToken=token;const result=onScan?await onScan(token):{token};if(closed)return;
   if(result?.duplicate){showResult('이미 찾은 QR입니다.',result.message||'다른 QR을 찾아보세요.',false);accepted={...result,keepOpen:result.keepOpen!==false};return;}
   accepted=result||{};showResult('QR을 찾았습니다!',qrSuccessDetail(result?.progress),true);
  }catch(e){showResult('QR을 확인하지 못했습니다.',e.message||String(e),false);}
 };
 const decode=async(source,camera=false)=>{if(closed||busy)return;await qrLibrary('jsqr');if(closed||busy)return;const w=source.videoWidth||source.width,h=source.videoHeight||source.height;if(!w||!h)return;const canvas=document.createElement('canvas'),scale=Math.min(1,1200/w,1200/h);canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,canvas.width,canvas.height);const data=ctx.getImageData(0,0,canvas.width,canvas.height),result=globalThis.jsQR(data.data,data.width,data.height);if(result)await finish(result.data,camera);else if(camera)lastToken=null;return Boolean(result);};
 const leave=()=>d.close();window.addEventListener('hashchange',leave);signal?.addEventListener('abort',leave);
 d.addEventListener('close',()=>{closed=true;stop();window.removeEventListener('hashchange',leave);signal?.removeEventListener('abort',leave);d.removeEventListener('cancel',cancel);d.removeEventListener('keydown',focusResult);resolve(null);},{once:true});
 d.querySelector('#qr-link-form').onsubmit=e=>{e.preventDefault();finish(new FormData(e.target).get('link'));};
 d.querySelector('#qr-image').onchange=async e=>{const f=e.target.files[0];if(!f||busy)return;if(f.size>8000000)return error('8MB 이하 이미지를 선택하세요.');const url=URL.createObjectURL(f);try{const img=new Image();img.src=url;await img.decode();if(!await decode(img)&&!busy)error('이미지에서 QR을 찾지 못했습니다.');}catch(e){error(e);}finally{URL.revokeObjectURL(url);e.target.value='';}};
 d.querySelector('#qr-camera').onclick=async()=>{if(busy||starting)return;starting=true;try{stop();if(!navigator.mediaDevices?.getUserMedia)throw Error('카메라는 HTTPS 또는 localhost에서 사용할 수 있습니다. 이미지나 링크로 확인해 주세요.');stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(closed){stop();return;}const video=d.querySelector('video');video.srcObject=stream;await video.play();const tick=async()=>{if(closed)return;if(!busy)try{await decode(video,true);}catch(e){error(e);}if(!closed)timer=setTimeout(tick,250);};tick();}catch(e){stop();error(e.name==='NotAllowedError'?'카메라 권한을 허용하거나 이미지·링크 입력을 이용하세요.':e);}finally{starting=false;}};
 if(signal?.aborted)leave();
 });}

export async function renderQrLink(root,app){const token=readQr(location.href),lobby=new LobbyClient();const active=lobby.storage.getItem(`escape-studio:active-room:${lobby.repo.config.url}`)||'';
 root.innerHTML=`<section class="panel student-entry"><h1>QR 단서 확인</h1><p>현재 참가한 수업에서 서버가 QR을 확인합니다.</p><form>${field('현재 방 코드',`<input name="code" pattern="[0-9]{6}" value="${esc(active)}" required>`)}<button class="btn primary">QR 확인</button></form><p id="qr-link-status" role="status"></p><div id="qr-return"></div></section>`;
 let busy=false;const run=async()=>{if(busy)return;busy=true;const code=root.querySelector('[name=code]').value,msg=root.querySelector('#qr-link-status');try{if(!token)throw Error('올바른 QR 주소가 아닙니다.');const saved=lobby.saved(code);if(!saved?.participantId)throw Error('먼저 이 브라우저에서 방 코드로 입장한 후 QR 링크를 다시 여세요.');const result=await lobby.rpc('escape_scan_qr',{p_token:saved.token,p_qr:token});msg.textContent=result.message;root.querySelector('#qr-return').innerHTML=qrProgressHtml(result.game.qr);}catch(e){msg.textContent=e.message;}finally{if(/^\d{6}$/.test(code))root.querySelector('#qr-return').insertAdjacentHTML('beforeend',`<a class="btn" href="${location.pathname}#/join/${code}">학생 화면으로 돌아가기</a>`);busy=false;}};root.querySelector('form').onsubmit=e=>{e.preventDefault();run();};if(active)await run();
}
