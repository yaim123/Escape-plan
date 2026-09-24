import {newRoom,newBlock} from '../src/core/model.js';
import {newQrMission,newQr} from '../src/core/qr.js';
import {mkdir,writeFile} from 'node:fs/promises';
const room=newRoom('폐기용 007 QR 팀전');room.playMode='team';room.teamSettings.teamCount=2;
room.qrMissions=['ANY','ALL','N_OF_M','UNIQUE_MEMBER'].map(mode=>{const m=newQrMission();m.name=mode;m.mode=mode;m.count=2;m.codes=[1,2,3].map(n=>({...newQr(),name:`${mode} QR ${n}`}));return m;});
const story=newBlock('story');story.title='QR 협동 완료';story.body='네 가지 QR 미션을 완료했습니다.';story.unlock.conditions=room.qrMissions.map(m=>({blockId:m.id,event:'qr_complete',member:0,role:''}));room.content=[story];
await mkdir('artifacts/qr',{recursive:true});await writeFile('artifacts/qr/team.json',JSON.stringify(room,null,2));
