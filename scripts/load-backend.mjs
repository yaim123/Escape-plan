// Default: disposable PostgreSQL/WASM. Hosted requests require an explicit staging opt-in.
import {readFile} from 'node:fs/promises';
import {sqlFixture} from './sql-fixture.mjs';
export function stagingConfig(env,production='rxknixllqewkvgfnpshu.supabase.co'){
 const url=new URL(env.ESCAPE_LOAD_URL||'http://invalid'),key=env.ESCAPE_LOAD_PUBLIC_KEY,jwt=env.ESCAPE_LOAD_TEACHER_JWT;
 if(env.ESCAPE_LOAD_CONFIRM!=='disposable-staging'||env.ESCAPE_LOAD_ALLOW_HOST!==url.hostname||url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||production.includes(url.hostname)||url.hostname==='rxknixllqewkvgfnpshu.supabase.co')throw Error('Staging guard: use a separate disposable project, explicit URL/host and ESCAPE_LOAD_CONFIRM=disposable-staging.');
 if(!key||!jwt||key.startsWith('sb_secret_'))throw Error('Staging requires a publishable/anon key and a test teacher access JWT.');
 const role=token=>{try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url')).role;}catch{return null;}};
 if((!key.startsWith('sb_publishable_')&&role(key)!=='anon')||role(jwt)!=='authenticated')throw Error('Admin/service keys are not accepted.');
 return {url,key,jwt};
}
export async function loadBackend(staging=false){
 if(!staging){
  const fixture=await sqlFixture();return {...fixture,kind:'local PGlite (serialized SQL queue; not multi-connection PostgreSQL)',
   create:r=>fixture.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[r.id,fixture.teachers[0],r.roomCode,r.title,r],'authenticated'),
   remove:r=>fixture.query('delete from public.escape_contents where id=$1',[r.id],'authenticated'),close:()=>fixture.db.close()};
 }
 // No application config fallback, no secret/admin keys, no non-HTTPS remote targets.
 const production=await readFile('src/config.js','utf8').catch(()=> 'rxknixllqewkvgfnpshu.supabase.co');
 const {url,key,jwt}=stagingConfig(process.env,production);
 let count=0;const created=new Set();
 const request=async(path,{method='GET',body,teacher=false,cleanup=false}={})=>{
  if(!cleanup&&++count>1800)throw Error('Load request budget exceeded (1800).');
  const response=await fetch(new URL(path,url),{method,headers:{apikey:key,'Content-Type':'application/json',...(teacher?{Authorization:'Bearer '+jwt}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const value=await response.text();let json;try{json=JSON.parse(value);}catch{json=value;}
  if(!response.ok)throw Error(typeof json==='object'?json.message:'Staging HTTP '+response.status);return json;
 };
 const user=await request('/auth/v1/user',{teacher:true});if(!user.id)throw Error('Invalid test teacher JWT.');
 return {kind:'explicit disposable staging (HTTP; private SQL audit unavailable)',query:null,
  rpc:(name,params,role)=>request('/rest/v1/rpc/'+name,{method:'POST',body:params,teacher:role==='authenticated'}),
  create:async r=>{if(!r.title.startsWith('[LOAD TEST]'))throw Error('Test content prefix required');created.add(r.id);return request('/rest/v1/escape_contents',{method:'POST',teacher:true,body:{id:r.id,owner_id:user.id,room_code:r.roomCode,title:r.title,document:r}});},
  remove:async r=>{if(!created.has(r.id))throw Error('Refusing to remove an unowned test ID');await request('/rest/v1/escape_contents?id=eq.'+r.id,{method:'DELETE',teacher:true,cleanup:true});const rows=await request('/rest/v1/escape_contents?id=eq.'+r.id+'&select=id',{teacher:true,cleanup:true});if(rows.length)throw Error('Staging cleanup verification failed');created.delete(r.id);},
  close:async()=>{if(created.size)throw Error('Test content cleanup incomplete: '+[...created].join(', '));}};
}
