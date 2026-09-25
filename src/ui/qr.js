import {esc,field,options,modal,toast} from './dom.js';
import {newQrMission,newQr,qrUrl,readQr} from '../core/qr.js';
import {LobbyClient} from '../data/lobby.js';
const loads=new Map();
export function qrLibrary(name){if(!loads.has(name))loads.set(name,new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL(`../vendor/${name}.js`,import.meta.url).href;script.onload=resolve;script.onerror=()=>{loads.delete(name);reject(Error('QR 도구를 불러오지 못했습니다.'));};document.head.append(script);}));return loads.get(name);}
export function qrProgressHtml(rows=[]){return rows.length?`<section class="panel qr-progress"><h3>QR 단서</h3>${rows.map(m=>`<p>${esc(m.name)} <strong>${m.found} / ${m.total}</strong> ${m.done?'✅ 완료':''}</p>`).join('')}</section>`:'';}
// Validate while the scanner remains open. Rejected scans pause decoding, not the camera stream.
export function scanQrDialog(signal,onScan){return new Promise(resolve=>{
 let stream,timer,closed=false,busy=false,lastToken=null;
 const stop=()=>{clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());};
 const d=modal(`<div class="modal-body qr-scanner"><h2>QR 스캔</h2><p>카메라로 QR을 비추거나 QR 이미지·링크를 읽으세요.</p><video id="qr-video" playsinline muted></video><button type="button" class="btn primary" id="qr-camera">카메라 켜기</button>${field('QR 이미지 선택','<input id="qr-image" type="file" accept="image/*">')}<form id="qr-link-form">${field('QR 링크 입력','<input name="link" type="text" required autocomplete="off">')}<button class="btn" type="submit">QR 링크 확인</button></form><p id="qr-error" role="status"></p><div class="scanner-error" hidden role="alertdialog" aria-modal="true" aria-labelledby="scan-error-title"><div><h2 id="scan-error-title">해당 QR이 아닙니다.</h2><p id="scan-error-detail">이 문제에서 사용할 QR코드를 다시 찾아보세요.</p><button class="btn primary" type="button" id="qr-retry">확인</button></div></div></div>`);
 const error=e=>{if(!closed)d.querySelector('#qr-error').textContent=e.message||e;};
 const rejected=e=>{if(closed)return;const mismatch=/QR|현재 공개/.test(e.message||'');d.querySelector('#scan-error-title').textContent=mismatch?'해당 QR이 아닙니다.':'QR 확인을 마치지 못했습니다.';d.querySelector('#scan-error-detail').textContent=mismatch?'이 문제에서 사용할 QR코드를 다시 찾아보세요.':e.message;d.querySelector('.scanner-error').hidden=false;d.querySelector('#qr-retry').focus();};
 d.querySelector('#qr-retry').onclick=()=>{d.querySelector('.scanner-error').hidden=true;busy=false;lastToken=null;d.querySelector('#qr-camera').focus();};
 const finish=async(value,fromCamera=false)=>{
  if(closed||busy)return;const token=readQr(value);if(fromCamera&&token===lastToken)return;busy=true;
  try{if(!token)throw Error('올바른 QR이 아닙니다.');lastToken=token;const result=onScan?await onScan(token):token;if(closed)return;
   if(result?.keepOpen){error(result.message||'QR을 발견했습니다. 다음 QR을 스캔하세요.');busy=false;return;}
   resolve(result);d.close();
  }catch(e){rejected(e);}
 };
 const decode=async(source,camera=false)=>{await qrLibrary('jsqr');const w=source.videoWidth||source.width,h=source.videoHeight||source.height;if(!w||!h)return;const canvas=document.createElement('canvas'),scale=Math.min(1,1200/w,1200/h);canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,canvas.width,canvas.height);const data=ctx.getImageData(0,0,canvas.width,canvas.height),result=globalThis.jsQR(data.data,data.width,data.height);if(result)await finish(result.data,camera);else if(camera)lastToken=null;return Boolean(result);};
 const leave=()=>d.close();window.addEventListener('hashchange',leave);signal?.addEventListener('abort',leave);
 d.addEventListener('close',()=>{closed=true;stop();window.removeEventListener('hashchange',leave);signal?.removeEventListener('abort',leave);resolve(null);},{once:true});
 d.querySelector('#qr-link-form').onsubmit=e=>{e.preventDefault();finish(new FormData(e.target).get('link'));};
 d.querySelector('#qr-image').onchange=async e=>{const f=e.target.files[0];if(!f||busy)return;if(f.size>8000000)return error('8MB 이하 이미지를 선택하세요.');const url=URL.createObjectURL(f);try{const img=new Image();img.src=url;await img.decode();if(!await decode(img))error('이미지에서 QR을 찾지 못했습니다.');}catch(e){error(e);}finally{URL.revokeObjectURL(url);e.target.value='';}};
 d.querySelector('#qr-camera').onclick=async()=>{try{stop();if(!navigator.mediaDevices?.getUserMedia)throw Error('카메라는 HTTPS 또는 localhost에서 사용할 수 있습니다. 이미지나 링크로 확인해 주세요.');stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(closed){stop();return;}const video=d.querySelector('video');video.srcObject=stream;await video.play();const tick=async()=>{if(closed)return;if(!busy)try{await decode(video,true);}catch(e){error(e);}if(!closed)timer=setTimeout(tick,250);};tick();}catch(e){stop();error(e.name==='NotAllowedError'?'카메라 권한을 허용하거나 이미지·링크 입력을 이용하세요.':e);}};
 });}

export async function renderQrLink(root,app){const token=readQr(location.href),lobby=new LobbyClient();const active=lobby.storage.getItem(`escape-studio:active-room:${lobby.repo.config.url}`)||'';
 root.innerHTML=`<section class="panel student-entry"><h1>QR 단서 확인</h1><p>현재 참가한 수업에서 서버가 QR을 확인합니다.</p><form>${field('현재 방 코드',`<input name="code" pattern="[0-9]{6}" value="${esc(active)}" required>`)}<button class="btn primary">QR 확인</button></form><p id="qr-link-status" role="status"></p><div id="qr-return"></div></section>`;
 let busy=false;const run=async()=>{if(busy)return;busy=true;const code=root.querySelector('[name=code]').value,msg=root.querySelector('#qr-link-status');try{if(!token)throw Error('올바른 QR 주소가 아닙니다.');const saved=lobby.saved(code);if(!saved?.participantId)throw Error('먼저 이 브라우저에서 방 코드로 입장한 후 QR 링크를 다시 여세요.');const result=await lobby.rpc('escape_scan_qr',{p_token:saved.token,p_qr:token});msg.textContent=result.message;root.querySelector('#qr-return').innerHTML=qrProgressHtml(result.game.qr);}catch(e){msg.textContent=e.message;}finally{if(/^\d{6}$/.test(code))root.querySelector('#qr-return').insertAdjacentHTML('beforeend',`<a class="btn" href="${location.pathname}#/join/${code}">학생 화면으로 돌아가기</a>`);busy=false;}};root.querySelector('form').onsubmit=e=>{e.preventDefault();run();};if(active)await run();
}
