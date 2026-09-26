import {safeAssetUrl} from '../core/model.js';
// Bounded browser probes; cross-origin video embeds cannot reliably report load failure.
export async function probePlayAssets(room,probe=probeAsset){
 const assets=new Map();
 for(const [i,b] of (room.content||[]).entries()){
  const entries=[...(['image','immersive'].includes(b.display)?[{type:'image',url:b.backgroundUrl}]:[]),...(b.media||[])];
  for(const a of entries)if(safeAssetUrl(a.url)){
   const u=new URL(a.url);if(a.type==='video'&&['youtube.com','www.youtube.com','youtu.be'].includes(u.hostname))continue;
   const key=a.type+'|'+a.url;if(!assets.has(key))assets.set(key,{...a,labels:[]});assets.get(key).labels.push(`${i+1}. ${b.title}`);
  }
 }
 const entries=[...assets.values()],failed=[];let cursor=0;
 await Promise.all(Array.from({length:Math.min(8,entries.length)},async()=>{while(cursor<entries.length){const a=entries[cursor++];if(!await probe(a))failed.push(a);}}));
 return {urls:[...new Set(failed.map(a=>a.url))],warnings:failed.flatMap(a=>a.labels.map(label=>`${label}: 외부 자료를 불러오지 못했습니다.`))};
}
function probeAsset({type,url}){
 if(typeof document==='undefined')return Promise.resolve(true);
 return new Promise(resolve=>{
  const el=type==='image'?new Image():document.createElement(type);let timer;
  const done=ok=>{clearTimeout(timer);el.onload=null;el.onerror=null;el.onloadedmetadata=null;if(type!=='image'){el.removeAttribute('src');el.load();}resolve(ok);};
  timer=setTimeout(()=>done(false),4000);el.onerror=()=>done(false);el.onload=()=>done(true);el.onloadedmetadata=()=>done(true);if(type!=='image')el.preload='metadata';el.src=url;
 });
}
