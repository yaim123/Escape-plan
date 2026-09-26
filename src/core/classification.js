export const GRADES=['중1','중2','중3','고1','고2','고3','공통','기타'];
export const SUBJECTS=['과학','수학','국어','영어','사회','기술·가정','정보','기타'];
export const GENRES=['공포','미스터리','추리','모험','탐험','교육','코믹','SF','판타지','기타'];
export function parseTags(value){const seen=new Set();return (Array.isArray(value)?value:String(value||'').split(/[,，\n]/)).map(t=>String(t).trim().slice(0,50)).filter(t=>{const key=t.toLocaleLowerCase();if(!t||seen.has(key))return false;seen.add(key);return true;}).slice(0,30);}
export function classification(room){const m=room.metadata||{};return {grade:GRADES.includes(m.grade)?m.grade:'',subject:SUBJECTS.includes(m.subject)?m.subject:!Object.hasOwn(m,'subject')&&SUBJECTS.includes(room.subject)?room.subject:'',genres:[...new Set((Array.isArray(m.genres)?m.genres:[]).filter(g=>GENRES.includes(g)))],tags:parseTags(m.tags)};}
export function matchesRoom(room,{query='',mode='all',grade='',subject='',genre='',tag=''}={}){
 const m=classification(room);return (mode==='all'||room.playMode===mode)&&(!grade||m.grade===grade)&&(!subject||m.subject===subject)&&(!genre||m.genres.includes(genre))&&(!tag||m.tags.includes(tag))&&[room.title,room.description,room.subject,m.grade,m.subject,...m.genres,...m.tags].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
export function delayMinutes(room){const n=room.rules?.delayMinutes;return n===undefined?3:Number.isInteger(n)&&n>=0&&n<=10?n:3;}
