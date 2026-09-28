// Keep expanded roles as the wire format. Visibility extends assignment rather than
// changing the existing solver/completion modes; absent visibility adopts legacy role assignment.
export const roleViewsEnabled=r=>r.playMode==='team'&&r.teamSettings?.rolesEnabled===true&&r.teamSettings.roleViewsEnabled===true;
export const teamChatEnabled=r=>r.playMode==='team'&&r.teamSettings?.chatEnabled!==false;
export const roleNames=r=>[...new Set(r.teamSettings?.roles||[])];
export function roleRows(roles=[]){const rows=[];for(const name of roles){const row=rows.find(r=>r.name===name);if(row)row.count++;else rows.push({name,count:1});}return rows;}
export function expandRoleRows(rows){
 const names=new Set();return rows.flatMap(({name,count})=>{name=name.trim();if(!name||name.length>80)throw Error('역할 이름은 1~80자로 입력하세요.');if(names.has(name))throw Error('같은 역할은 기존 행의 인원수를 수정하세요.');if(!Number.isInteger(count)||count<1||count>20)throw Error('역할 인원은 1~20명입니다.');names.add(name);return Array(count).fill(name);});
}
export const audienceRoles=b=>Array.isArray(b.assignment?.visibleRoles)?b.assignment.visibleRoles:b.assignment?.mode==='role'?[b.assignment.role]:[];
export const roleVisible=(room,b,role)=>!roleViewsEnabled(room)||!audienceRoles(b).length||audienceRoles(b).includes(role);
export function roleReferences(room,name){return {blocks:room.content.filter(b=>audienceRoles(b).includes(name)||b.assignment?.mode==='role'&&b.assignment.role===name||b.completion?.mode==='role'&&b.completion.role===name||b.unlock?.conditions.some(c=>c.role===name)).length,chats:(room.chatRooms||[]).filter(c=>c.scope==='roles'&&c.roles.includes(name)).length};}
export function validateTeamSettings(room){
 if(room.playMode!=='team')return [];
 const errors=[],t=room.teamSettings||{},names=roleNames(room);
 if(t.rolesEnabled){
  if(!names.length||names.some(n=>typeof n!=='string'||!n.trim()||n.length>80))errors.push('역할 이름과 인원을 확인하세요.');
  for(const b of room.content){
   const audience=roleViewsEnabled(room)?audienceRoles(b):[],refs=[...audience,...(b.assignment?.mode==='role'?[b.assignment.role]:[]),...(b.completion?.mode==='role'?[b.completion.role]:[]),...(b.unlock?.conditions||[]).map(c=>c.role).filter(Boolean)];
   if(refs.some(n=>!names.includes(n)))errors.push(`${b.title}: 존재하지 않는 역할을 참조합니다. 대상과 조건을 수정하세요.`);
   if(audience.length){
    if(b.assignment.mode==='role'&&!audience.includes(b.assignment.role)||b.completion.mode==='role'&&!audience.includes(b.completion.role))errors.push(`${b.title}: 표시 대상과 배정·완료 역할이 겹치지 않습니다.`);
    if(b.questionType!=='qr'&&b.completion.mode==='all'&&names.some(n=>!audience.includes(n)))errors.push(`${b.title}: 역할 전용 블록은 특정 역할 또는 배정된 팀원 완료 조건을 사용하세요.`);
    if(b.questionType==='qr'&&(room.qrMissions||[]).some(m=>m.id===b.qrMissionId&&m.mode==='UNIQUE_MEMBER')&&names.some(n=>!audience.includes(n)))errors.push(`${b.title}: 팀원별 서로 다른 QR은 모든 팀원이 볼 수 있어야 합니다.`);
   }
  }
 }
 return errors;
}
export const waitingSettings=r=>({title:'내 할 일을 완료했습니다!',body:'다른 팀원이 조건을 완료할 때까지 기다려주세요.',showCounts:true,...r.teamSettings?.waiting});
