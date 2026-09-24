// Generate the exact Unicode P/S category character class used by core/answers.js.
// No runtime package or answer data is included in this generated pattern.
import { readFile,writeFile } from 'node:fs/promises';
const ranges=[]; let first=null,last=null;
for(let point=0;point<=0x10ffff;point++) {
  if(/[\p{P}\p{S}]/u.test(String.fromCodePoint(point))) { if(first===null) first=point; last=point; }
  else if(first!==null) { ranges.push([first,last]); first=last=null; }
}
if(first!==null) ranges.push([first,last]);
const escape = point => String.fromCodePoint(point).replace(/[\\\]\[\-^]/g,'\\$&');
const pattern='['+ranges.map(([a,b])=>escape(a)+(b>a?'-'+escape(b):'')).join('')+']';
const path='supabase/003_live_play.sql', sql=await readFile(path,'utf8');
await writeFile(path,sql.replace(/if coalesce\(\(p_options->>'punctuation'\)::boolean,false\) then v:=regexp_replace\(v,'.*?','','g'\); end if;/,
  `if coalesce((p_options->>'punctuation')::boolean,false) then v:=regexp_replace(v,'${pattern.replaceAll("'","''")}','','g'); end if;`));
console.log(`Generated Unicode punctuation/symbol class: ${ranges.length} ranges.`);
