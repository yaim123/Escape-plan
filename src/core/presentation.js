export const DISPLAY_FIELDS={title:'방탈출 제목',description:'방탈출 설명',stage:'스테이지 번호',stageName:'스테이지 이름',progress:'전체 진행도',completed:'완료 블록 수',elapsed:'경과 시간',remaining:'남은 시간',connection:'실시간 연결 상태',mode:'개인전 / 팀전',student:'학생 이름',team:'팀 번호 / 이름',role:'역할',score:'현재 점수',wrong:'오답 횟수',hints:'사용 / 남은 힌트',penalty:'적용된 페널티',rank:'현재 순위',board:'공개 참가자 / 팀 현황',blockTitle:'블록 제목',blockType:'블록 유형'};
export const DISPLAY_MODES={always:'항상 표시',info:'ⓘ 정보 아이콘에 표시',hidden:'표시하지 않음'};
export const newDisplaySettings=()=>Object.fromEntries(Object.keys(DISPLAY_FIELDS).map(k=>[k,['title','progress','blockTitle','blockType'].includes(k)?'always':'info']));
export function displayPolicy(settings,key,immersive=false){const legacy=['title','stage','progress','completed','elapsed','connection','mode','team','role','wrong','board','blockTitle','blockType'];const mode=settings?.[key]|| (legacy.includes(key)?'always':'info');return immersive&&mode==='always'?'info':mode;}
export function normalizePresentation(room){
 room.theme={color:'#0c766d',background:'',bgm:'',...room.theme};
 room.design={backgroundColor:'#f4f7f7',text:'auto',card:'light',...room.design};
 room.sound={volume:.35,allowMute:true,...room.sound};
 if(room.studentDisplaySettings)room.studentDisplaySettings={...newDisplaySettings(),...room.studentDisplaySettings};
 return room;
}
export const createdOrder=(a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(a.id).localeCompare(String(b.id));
