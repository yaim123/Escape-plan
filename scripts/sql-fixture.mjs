// Disposable local PostgreSQL engine. Never reads a hosted project URL or credentials.
import {readFile,readdir} from 'node:fs/promises';
import {storageFixture} from './storage-fixture.mjs';
export async function sqlFixture(){
 let PGlite;try{({PGlite}=await import('@electric-sql/pglite'));}catch{({PGlite}=await import('../artifacts/pglite/package/dist/index.js'));}
 const db=new PGlite(),teachers=[crypto.randomUUID(),crypto.randomUUID()];
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema realtime;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table realtime.test_messages(payload jsonb,event text,topic text,private boolean);
 create function realtime.send(p jsonb,e text,t text,b boolean) returns void language sql as $$insert into realtime.test_messages values(p,e,t,b)$$;`);
 await db.query('insert into auth.users values($1),($2)',teachers);
 for(const f of (await readdir('supabase')).filter(f=>/^\d+.*\.sql$/.test(f)).sort()){if(f.startsWith('011'))await storageFixture(db);await db.exec(await readFile('supabase/'+f,'utf8'));}
 // Transaction-scoped roles cannot cross-contaminate simultaneous test calls.
 const query=(sql,args=[],role='anon',user=teachers[0])=>db.transaction(async tx=>{if(!['anon','authenticated','postgres'].includes(role))throw Error('Invalid fixture role');await tx.exec(`set local role ${role}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[role==='authenticated'?user:'']);return tx.query(sql,args);});
 const rpc=async(name,params={},role='anon',user=teachers[0])=>{if(!/^escape_[a-z_]+$/.test(name)||Object.keys(params).some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Invalid fixture RPC');const values=Object.entries(params).map(([k,v])=>v!==null&&(k==='p_input'||typeof v==='object')?JSON.stringify(v):v),names=Object.keys(params);return(await query(`select public.${name}(${names.map((n,i)=>`${n}=>$${i+1}`).join(',')}) result`,values,role,user)).rows[0].result;};
 return {db,teachers,query,rpc};
}
