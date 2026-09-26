import {QUESTION_TYPES} from './model.js';
import {normalizeStages} from './stages.js';

export const STORY_EXPORT_DEFAULTS=Object.freeze({scope:'story',numbers:true,stages:false,answers:false});
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ensp:' ',emsp:' ',ndash:'–',mdash:'—',hellip:'…',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',bull:'•',middot:'·',copy:'©',reg:'®',times:'×',divide:'÷',le:'≤',ge:'≥'};

// Deterministic text conversion: no DOM insertion, network requests or document mutation.
export function cleanStoryText(value){
 return String(value??'').replace(/\r\n?/g,'\n')
  .replace(/<!--[^]*?-->/g,'').replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi,'')
  .replace(/<(\/?)([a-z][\w:-]*)(?:\s+(?:"[^"]*"|'[^']*'|[^'">])*)?\s*\/?>/gi,(_,closing,tag)=>{
   tag=tag.toLowerCase();if(tag==='br'||tag==='hr')return '\n';
   if(tag==='li')return closing?'\n':'- ';
   if(['td','th'].includes(tag))return closing?'\t':'';
   return ['p','div','section','article','header','footer','blockquote','pre','ul','ol','tr','h1','h2','h3','h4','h5','h6'].includes(tag)?'\n\n':'';
  })
  .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(whole,key)=>{
   if(key[0]!=='#')return entities[key]??entities[key.toLowerCase()]??whole;
   const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
   return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):whole;
  }).replace(/[ \t]+$/gm,'').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g,'\n\n').trim();
}

export function buildStoryTextExport(room,options={}){
 const settings={...STORY_EXPORT_DEFAULTS,...options};
 const source=normalizeStages(structuredClone(room));
 const ordered=source.stageGroups.flatMap((stage,i)=>source.content.filter(b=>b.stageId===stage.id).map(block=>({block,stage,ordinal:i+1})));
 const chunks=[];let lastStage=null;
 for(const [index,{block:b,stage,ordinal}] of ordered.entries()){
  if(!['story','guide','question'].includes(b.type)||settings.scope==='story'&&b.type!=='story'||settings.scope==='story-guide'&&b.type==='question')continue;
  if(settings.stages&&lastStage!==stage.id){const name=cleanStoryText(stage.name);chunks.push(`[스테이지 ${ordinal}${name?' · '+name:''}]`);lastStage=stage.id;}
  const heading=(settings.numbers?`${index+1}. `:'')+cleanStoryText(b.title),body=cleanStoryText(b.body),parts=[heading];
  if(body)parts.push(body);
  if(b.type==='question'){
   parts.push(`[문제 유형: ${QUESTION_TYPES[b.questionType]||'문제'}]`);
   const choices=b.questionType==='ox'?['O','X']:['choice','multi','order','match'].includes(b.questionType)?b.options||[]:[];
   if(choices.length)parts.push('[선택지]\n'+choices.map((v,i)=>`${i+1}. ${cleanStoryText(v)}`).join('\n'));
   const completion={qr:'QR 스캔',approval:'교사 승인',switch:'버튼 / 스위치 조작',condition:'조건 충족'}[b.questionType];
   if(completion)parts.push(`[완료 방식: ${completion}]`);
   else if(settings.answers&&settings.scope==='all'){
    const answers=(b.answers||[]).map(cleanStoryText).filter(Boolean);
    if(answers.length){
     const text=b.questionType==='match'?(b.answers||[]).map((v,i)=>`- ${cleanStoryText(b.options?.[i])||`${i+1}번 항목`} → ${cleanStoryText(v)}`).join('\n'):
      b.questionType==='order'?answers.map((v,i)=>`${i+1}. ${v}`).join('\n'):answers.length===1?answers[0]:answers.map(v=>'- '+v).join('\n');
     parts.push('[정답]\n'+text);
    }
   }
  }
  chunks.push(parts.join('\n\n').trim());
 }
 return chunks.join('\n\n\n').trim();
}

export function storyExportFilename(title){
 const name=cleanStoryText(title).replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/g,'').slice(0,100).trim()||'방탈출';
 return `${name}_스토리.txt`;
}
