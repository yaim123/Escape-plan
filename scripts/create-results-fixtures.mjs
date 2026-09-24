import {newRoom,newBlock} from '../src/core/model.js';
import {writeFile,mkdir} from 'node:fs/promises';
await mkdir('artifacts/results',{recursive:true});
for(const mode of ['individual','team']){
 const room=newRoom(`폐기용 006 ${mode==='team'?'팀전':'개인전'} 검증`);room.playMode=mode;room.teamSettings.teamCount=2;
 const q=newBlock();q.title='최종 암호';q.body='정답은 열쇠입니다.';q.answers=['열쇠'];q.hints=['문을 열 때 사용합니다.','열쇠'];q.completion.mode=mode==='team'?'all':'any';room.content=[q];
 Object.assign(room.rules,{ranking:'combined',rankVisibility:'live',scoreEnabled:true,hints:mode==='team'?'team':'individual',hintLimit:1,hintPenaltyType:'time',hintPenalty:5,wrongPenaltyType:'time',wrongPenalty:10});
 await writeFile(`artifacts/results/${mode}.json`,JSON.stringify(room,null,2));
}
