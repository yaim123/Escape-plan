import {newRoom,duplicateRoom,normalizeRoom} from './model.js';
export function blockLibraryPayload(room,blockId){
 const block=room.content.find(b=>b.id===blockId);if(!block)throw Error('보관할 블록을 선택하세요.');
 return structuredClone({version:1,block,chatRooms:(room.chatRooms||[]).filter(c=>block.chatRoomIds?.includes(c.id)),qrMissions:(room.qrMissions||[]).filter(m=>m.id===block.qrMissionId||m.codes.some(q=>q.id===block.qrId))});
}
export function importLibraryBlock(payload,stageId){
 if(payload?.version!==1||!payload.block||!['story','guide','question'].includes(payload.block.type))throw Error('보관된 블록 형식을 확인하세요.');
 const base=newRoom();base.content=[structuredClone(payload.block)];base.qrMissions=structuredClone(payload.qrMissions||[]);base.chatRooms=structuredClone(payload.chatRooms||[]);
 const owned=new Set([base.content[0].id,...base.qrMissions.flatMap(m=>[m.id,...m.codes.map(q=>q.id)])]);
 const unlock=base.content[0].unlock,removed=unlock.conditions.filter(c=>!owned.has(c.blockId)).length;
 unlock.conditions=unlock.conditions.filter(c=>owned.has(c.blockId));if(unlock.mode==='N'){unlock.count=Math.min(unlock.count,unlock.conditions.length);if(!unlock.conditions.length){unlock.mode='AND';unlock.count=1;}}
 const copy=duplicateRoom(normalizeRoom(base)),block=copy.content[0];block.stageId=stageId;
 return {block,chatRooms:copy.chatRooms||[],qrMissions:copy.qrMissions||[],removedConditions:removed};
}
