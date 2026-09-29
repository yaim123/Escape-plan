import {parallelGroup,parallelIds} from './parallel.js';
// Stage identity is independent of its displayed ordinal and every block/QR identity.
export function normalizeStages(room){
 const existing=Array.isArray(room.stageGroups);
 const groups=existing?room.stageGroups.map(g=>({id:String(g.id),name:String(g.name||''),...(g.legacyStage!==undefined?{legacyStage:g.legacyStage}:{})})):[];
 for(const b of room.content||[]){
  let group=groups.find(g=>g.id===b.stageId);
  if(!group){const legacy=String(b.stage||'1');group=groups.find(g=>g.legacyStage===legacy)||(existing?groups[Number(legacy)-1]:null);if(!group){group={id:'legacy-'+encodeURIComponent(legacy),name:'',legacyStage:legacy};groups.push(group);}b.stageId=group.id;}
 }
 if(!groups.length)groups.push({id:'legacy-1',name:'',legacyStage:'1'});
 if(!existing)groups.sort((a,b)=>Number.isFinite(Number(a.legacyStage))&&Number.isFinite(Number(b.legacyStage))?Number(a.legacyStage)-Number(b.legacyStage):0);
 room.stageGroups=groups;
 for(const b of room.content||[])b.stage=String(groups.findIndex(g=>g.id===b.stageId)+1);
 return room;
}
export function syncStages(room){normalizeStages(room);room.content=room.stageGroups.flatMap(g=>room.content.filter(b=>b.stageId===g.id));return room;}
export function addStage(room){const group={id:crypto.randomUUID(),name:''};room.stageGroups.push(group);return group;}
export function moveStage(room,id,delta){const i=room.stageGroups.findIndex(g=>g.id===id),j=i+delta;if(i<0||j<0||j>=room.stageGroups.length)return;room.stageGroups.splice(j,0,room.stageGroups.splice(i,1)[0]);syncStages(room);}
export function moveBlock(room,id,stageId,beforeId=null){const b=room.content.find(x=>x.id===id);if(!b||!room.stageGroups.some(g=>g.id===stageId))return;const group=parallelGroup(room,id),ids=group?parallelIds(group):[id],target=parallelGroup(room,beforeId);beforeId=target?parallelIds(target)[0]:beforeId;if(ids.includes(beforeId))return;const moving=room.content.filter(b=>ids.includes(b.id));room.content=room.content.filter(b=>!ids.includes(b.id));for(const b of moving)b.stageId=stageId;const i=room.content.findIndex(x=>x.id===beforeId&&x.stageId===stageId);room.content.splice(i<0?room.content.length:i,0,...moving);syncStages(room);}
export const stageLabel=(room,id)=>{const i=room.stageGroups.findIndex(g=>g.id===id),g=room.stageGroups[i];return `스테이지 ${i+1}${g?.name?' · '+g.name:''}`;};
