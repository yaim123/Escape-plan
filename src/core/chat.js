export const newChatRoom=()=>({id:crypto.randomUUID(),name:'새 대화',scope:'team',roles:[]});
export function validateChat(room){
 const errors=[],rooms=room.chatRooms||[],ids=new Set();
 if(!Array.isArray(rooms)||rooms.length>32)return ['채팅방은 최대 32개입니다.'];
 for(const c of rooms){if(!c||!/^[a-f0-9-]{36}$/i.test(c.id)||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>80||!['team','roles'].includes(c.scope)||!Array.isArray(c.roles)||c.scope==='roles'&&c.roles.some(r=>!room.teamSettings.roles.includes(r))||c.scope==='roles'&&(!room.teamSettings.rolesEnabled||!c.roles.length))errors.push('채팅방 이름·참여 역할을 확인하세요.');ids.add(c?.id);}
 for(const b of room.content)if(b.chatEnabled&&(!Array.isArray(b.chatRoomIds)||!b.chatRoomIds.length||b.chatRoomIds.some(id=>!ids.has(id))))errors.push(`${b.title}: 연결할 채팅방을 선택하세요.`);
 return errors;
}
