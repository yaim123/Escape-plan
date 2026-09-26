import {qrUrl} from '../core/qr.js';
import {qrFilename,qrRasterLayout} from '../core/qr-download.js';
import {qrLibrary} from './qr.js';

export async function qrImageFile(q,base,format='png') {
 await qrLibrary('qrcode-generator');
 const code=globalThis.qrcode(0,'M');code.addData(qrUrl(q.token,base));code.make();
 let blob;
 if(format==='svg')blob=new Blob([code.createSvgTag({cellSize:4,margin:16,scalable:true})],{type:'image/svg+xml'});
 else {
  const n=code.getModuleCount(),{cellSize,margin,size}=qrRasterLayout(n),canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.fillStyle='#000';
  // Integer module boundaries avoid interpolation and preserve four white modules on every side.
  for(let row=0;row<n;row++)for(let col=0;col<n;col++)if(code.isDark(row,col))ctx.fillRect(margin+col*cellSize,margin+row*cellSize,cellSize,cellSize);
  blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG를 만들지 못했습니다. 다시 시도해 주세요.')),'image/png'));
 }
 return {filename:qrFilename(q.name,format),blob};
}
export async function downloadQr(q,base,format='png') {
 const {filename,blob}=await qrImageFile(q,base,format),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
