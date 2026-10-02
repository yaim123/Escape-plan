import {ensureManualCodes} from './qr.js';
import {normalizeStages,stageLabel} from './stages.js';
export function qrPrintItems(room){const r=normalizeStages(ensureManualCodes(structuredClone(room)));let number=0;return r.stageGroups.flatMap(g=>r.content.filter(b=>b.stageId===g.id).flatMap(b=>(r.qrMissions||[]).filter(m=>m.id===b.qrMissionId||m.blockId===b.id).flatMap(m=>m.codes.map(q=>({...q,number:++number,blockTitle:b.title,stage:stageLabel(r,g.id),active:m.active&&q.active})))));}
export function qrPrintLayout(items,{selected=items.map(q=>q.id),quantities={},size=6,names=true,numbers=true,cuts=true}={},moduleCounts={}){
 if(!Number.isFinite(Number(size))||size<3||size>10)throw Error('QR 크기는 3~10cm로 입력하세요.');
 const cards=[];for(const item of items.filter(q=>selected.includes(q.id))){const count=quantities[item.id]??1;if(!Number.isInteger(count)||count<1||count>30)throw Error('QR별 수량은 1~30개로 입력하세요.');for(let i=0;i<count;i++)cards.push({...item,copy:i+1});}
 if(cards.length>300)throw Error('한 번에 최대 300개까지 인쇄할 수 있습니다. 나누어 인쇄하세요.');
 // The requested size covers the QR modules; the four-module quiet zone is additional.
 const qrMm=Number(size)*10,outerMm=Math.max(qrMm,...cards.map(c=>qrMm*(1+8/(moduleCounts[c.id]||41))));
 const width=outerMm+6,height=outerMm+12+(names?12:0)+(numbers?6:0),columns=Math.max(1,Math.floor(194/(width+4))),rows=Math.max(1,Math.floor(281/(height+4))),capacity=columns*rows;
 const pages=[];for(let i=0;i<cards.length;i+=capacity)pages.push(cards.slice(i,i+capacity));
 return {pages,columns,rows,width,height,qrMm,outerMm,names,numbers,cuts,total:cards.length};
}
