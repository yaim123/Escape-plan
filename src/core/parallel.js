import {roleNames,roleViewsEnabled,audienceRoles} from './team-settings.js';
export const parallelIds=g=>(Array.isArray(g?.steps)?g.steps:[]).flatMap(s=>Array.isArray(s?.cells)?s.cells:[]).filter(c=>c?.blockId).map(c=>c.blockId);
export const parallelGroup=(room,id)=>(Array.isArray(room.parallelGroups)?room.parallelGroups:[]).find(g=>parallelIds(g).includes(id));
export function flowUnits(room){const seen=new Set();return room.content.flatMap(b=>{const g=parallelGroup(room,b.id);if(!g)return [{id:b.id,block:b}];if(seen.has(g.id))return [];seen.add(g.id);return [{id:g.id,group:g,block:b}];});}
export function createParallel(room,stageId,makeBlock){
 if(!roleViewsEnabled(room)||roleNames(room).length<2)throw Error('플레이 방식 / 팀 설정에서 역할 2개 이상과 역할별 화면 분리를 켜세요.');
 if(room.content.length+2>200)throw Error('콘텐츠는 최대 200개입니다.');
 const g={id:crypto.randomUUID(),name:'병렬 진행',mode:'AND',lanes:[{name:'A 경로'},{name:'B 경로'}],steps:[]};
 (room.parallelGroups??=[]).push(g);addParallelStep(room,g,stageId,makeBlock);return g;
}
export function addParallelStep(room,g,stageId,makeBlock){
 if(room.content.length+2>200)throw Error('콘텐츠는 최대 200개입니다.');
 const blocks=[0,1].map(i=>{const b=makeBlock('story');b.stageId=stageId;b.title=`${g.lanes[i].name} ${g.steps.length+1}`;b.assignment.visibleRoles=g.steps.length?[...audienceRoles(room.content.find(b=>b.id===g.steps[0].cells[i].blockId))]:[roleNames(room)[i]];return b;});
 const end=g.steps.length?Math.max(...parallelIds(g).map(id=>room.content.findIndex(b=>b.id===id)))+1:room.content.length;
 room.content.splice(end,0,...blocks);g.steps.push({id:crypto.randomUUID(),cells:blocks.map(b=>({blockId:b.id}))});return blocks;
}
export function laneRoles(room,g,lane,roles){for(const s of g.steps){const b=room.content.find(b=>b.id===s.cells[lane].blockId);if(b)b.assignment.visibleRoles=[...roles];}}
export function moveFlowUnit(room,id,delta){const units=flowUnits(room),i=units.findIndex(u=>u.id===id||u.block.id===id),j=i+delta;if(i<0||j<0||j>=units.length)return;const unit=units[i],target=units[j],ids=unit.group?parallelIds(unit.group):[unit.id],moving=room.content.filter(b=>ids.includes(b.id));const targetIds=target.group?parallelIds(target.group):[target.id];room.content=room.content.filter(b=>!ids.includes(b.id));const index=delta<0?room.content.findIndex(b=>targetIds.includes(b.id)):Math.max(...targetIds.map(id=>room.content.findIndex(b=>b.id===id)))+1;for(const b of moving)b.stageId=target.block.stageId;room.content.splice(index,0,...moving);}
export function validateParallel(room,emit){
 const groups=room.parallelGroups||[];if(!Array.isArray(groups))return ['병렬 구간 형식을 확인하세요.'];if(!groups.length)return [];
 let scope=groups.flatMap(parallelIds);const add=(...messages)=>{for(const message of messages){errors.push(message);emit?.(message,scope);}};const errors=[],seen=new Set(),groupIds=new Set();if(!roleViewsEnabled(room))add('병렬 진행은 팀전·역할 사용·역할별 화면 분리가 필요합니다.');
 for(const g of groups){scope=parallelIds(g);
  if(!g||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g.id||'')||groupIds.has(g.id)||!['AND','OR'].includes(g.mode)||!Array.isArray(g.lanes)||g.lanes.length!==2||g.lanes.some(l=>!l)||!Array.isArray(g.steps)||!g.steps.length||g.steps.length>100||g.steps.some(s=>!Array.isArray(s?.cells)||s.cells.length!==2||s.cells.some(c=>!c||typeof c!=='object'))){add('병렬 구간 형식을 확인하세요.');continue;}
  groupIds.add(g.id);
  const ids=parallelIds(g),blocks=ids.map(id=>room.content.find(b=>b.id===id));
  if(ids.some(id=>seen.has(id))||new Set(ids).size!==ids.length||blocks.some(b=>!b)){add('병렬 블록은 다른 구간과 중복 없이 연결하세요.');continue;}ids.forEach(id=>seen.add(id));
  const indices=ids.map(id=>room.content.findIndex(b=>b.id===id));if(Math.max(...indices)-Math.min(...indices)+1!==ids.length||new Set(blocks.map(b=>b.stageId)).size!==1)add('병렬 구간은 같은 스테이지에서 연속된 하나의 묶음이어야 합니다.');
  const roles=g.lanes.map((_,i)=>audienceRoles(room.content.find(b=>b.id===g.steps[0].cells[i]?.blockId)||{}));
  if(roles.some(rs=>!rs.length)||roles[0].some(r=>roles[1].includes(r)))add('A/B 경로에는 겹치지 않는 역할을 선택하세요.');
  for(const [n,s] of g.steps.entries()){
   if(s.cells?.length!==2||s.cells.every(c=>c.hold)||n===0&&s.cells.some(c=>c.hold))add('첫 단계는 새 화면이며, 각 단계에는 새 콘텐츠가 하나 이상 필요합니다.');
   for(const [i,c] of s.cells.entries()){if(c.hold){if(c.blockId)add('유지 화면에는 새 블록을 연결하지 않습니다.');continue;}const b=room.content.find(b=>b.id===c.blockId);if(b&&JSON.stringify(audienceRoles(b))!==JSON.stringify(roles[i]))add('같은 경로의 표시 역할은 동일해야 합니다.');}
  }
 }
 return errors;
}
// Shared pure evaluator used by author playtests. Live authority is the SQL equivalent.
export function parallelState(room,g,role,completed,closed=false){
 const satisfied=(step,lane)=>{const c=g.steps[step].cells[lane];return c.hold?g.steps.slice(0,step+1).every(s=>{const other=s.cells[1-lane];return other.hold||completed(other.blockId);}):completed(c.blockId);};
 const lanes=g.lanes.map((l,i)=>{const done=g.steps.every((_,n)=>satisfied(n,i));return {name:l.name,done,fraction:g.steps.filter((_,n)=>satisfied(n,i)).length/g.steps.length};});
 const done=closed||(g.mode==='OR'?lanes.some(l=>l.done):lanes.every(l=>l.done)),lane=g.lanes.findIndex((_,i)=>audienceRoles(room.content.find(b=>b.id===g.steps[0].cells[i].blockId)).includes(role));
 const step=lane<0?-1:g.steps.findIndex((_,n)=>!satisfied(n,lane));let blockId=null,heldId=null;
 if(!done&&lane>=0&&step>=0){const cell=g.steps[step].cells[lane];if(cell.hold)heldId=g.steps.slice(0,step).map(s=>s.cells[lane].blockId).filter(Boolean).at(-1);else blockId=cell.blockId;}
 return {id:g.id,done,lanes:lanes.map(({name,done})=>({name,done})),fraction:done?1:g.mode==='OR'?Math.max(...lanes.map(l=>l.fraction)):lanes.reduce((n,l)=>n+l.fraction,0)/2,lane,step,blockId,heldId};
}
