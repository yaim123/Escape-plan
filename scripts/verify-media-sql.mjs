import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { newRoom,newBlock,ensureBlockQr,duplicateRoom,normalizeRoom } from '../src/core/model.js';
import { isComplete,isUnlocked,assignedMembers } from '../src/core/conditions.js';
import { checkAnswer } from '../src/core/answers.js';
process.on('uncaughtException',error=>{console.error(error.message,error.where||'',error.stack?.split('\n').filter(s=>s.includes('verify-media-sql')).join('\n')||'');process.exit(1);});
let PGlite; try { ({PGlite}=await import('@electric-sql/pglite')); } catch { ({PGlite}=await import('../artifacts/pglite/package/dist/index.js')); }
const db=new PGlite(); const A=crypto.randomUUID(), B=crypto.randomUUID();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema realtime;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create table realtime.test_messages(payload jsonb);
create function realtime.send(p jsonb,e text,t text,b boolean) returns void language sql as $$ insert into realtime.test_messages values(p) $$;`);
await db.query('insert into auth.users values($1),($2)',[A,B]);
for(const file of ['001_foundation','002_live_lobby','003_live_play','004_teacher_controls','005_teacher_team_event_fix','006_results_and_reset','007_qr_interaction','008_qr_question_type','009_editor_flow_and_block_qr']) await db.exec(await readFile(`supabase/${file}.sql`,'utf8'));
await db.exec(await readFile('supabase/010_lobby_assets_and_immersive.sql','utf8'));
{await (await import('./storage-fixture.mjs')).storageFixture(db);await db.exec(await readFile('supabase/011_stages_display_and_media.sql','utf8'));}
if(process.argv.includes('--tools'))await db.exec(await readFile('supabase/012_analysis_print_and_block_library.sql','utf8'));
if(process.argv.includes('--qr-ux'))await db.exec(await readFile('supabase/013_qr_scan_receipt.sql','utf8'));
if(process.argv.includes('--team-chat'))await db.exec(await readFile('supabase/014_team_chat_and_rewind.sql','utf8'));
const as=async(role,uid='')=>{await db.exec(`reset role; set role ${role};`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);};
const call=async(sql,args=[])=>(await db.query(sql,args)).rows[0].result;
const teacher=(action,id)=>call('select public.escape_teacher_lobby($1,$2) result',[action,id]);
const join=(r,t,n)=>call('select public.escape_join_lobby($1,$2,2,6,$3,$4) result',[r.roomCode,t,n,`학생${n}`]);
const lobby=(t,team)=>call("select public.escape_student_lobby($1,'team',$2) result",[t,team]);
const play=(t,action='read',block=null,input=null,request=null)=>call('select public.escape_student_play($1,$2,$3,$4,$5) result',[t,action,block,input===null?null:JSON.stringify(input),request]);
const submit=(t,b,input,request=crypto.randomUUID())=>play(t,'submit',b.id,input,request);
const save=async r=>{await as('authenticated',A); await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[r.id,A,r.roomCode,r.title,r]); return teacher('open',r.id);};
const tokens=['a','b','c'].map(x=>x.repeat(64));
const dash=id=>call('select public.escape_teacher_progress($1) result',[id]);
const finish=(id,action='finish',keep=true,request=crypto.randomUUID())=>call('select public.escape_finish_reset($1,$2,$3,$4,true) result',[id,action,keep,request]);
const history=id=>call('select public.escape_result_history($1) result',[id]);



const rpc=(name,args={})=>call(`select public.${name}(${Object.keys(args).map((k,i)=>k+' => $'+(i+1)).join(',')}) result`,Object.values(args));
const insert=async r=>{await as('authenticated',A);await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[r.id,A,r.roomCode,r.title,r]);};
const update=async r=>db.query('update public.escape_contents set document=$2 where id=$1',[r.id,r]);
const r=normalizeRoom(newRoom('자료 원본'));await insert(r);
const path=`${A}/${r.id}/images/${crypto.randomUUID()}.png`,url='https://local.supabase.co/storage/v1/object/public/escape-media/'+path;
const objectInsert=p=>db.query("insert into storage.objects(bucket_id,name) values('escape-media',$1)",[p]);
await objectInsert(path);
await assert.rejects(objectInsert(`${B}/${r.id}/images/${crypto.randomUUID()}.png`),/row-level security/);
await as('authenticated',B);await assert.rejects(objectInsert(`${B}/${r.id}/images/${crypto.randomUUID()}.png`),/row-level security/);
assert.deepEqual(await rpc('escape_unused_media',{p_paths:[path]}),[]);
await as('anon');await assert.rejects(objectInsert(path),/row-level security/);await assert.rejects(rpc('escape_unused_media',{p_paths:[path]}),/permission denied/);
await as('postgres');assert.equal((await db.query("select public from storage.buckets where id='escape-media'")).rows[0].public,true);
await as('authenticated',A);r.content[0].media=[{type:'image',url}];await update(r);
assert.deepEqual(await rpc('escape_unused_media',{p_paths:[path]}),[]);
assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[path])).rows.length,0);
const copy=duplicateRoom(r);await insert(copy);r.content[0].media=[];await update(r);assert.deepEqual(await rpc('escape_unused_media',{p_paths:[path]}),[]);
const sid=(await teacher('open',copy.id)).sessionId;
await as('anon');await join(copy,tokens[0],1);await as('authenticated',A);await teacher('start',sid);
copy.content[0].media=[];await update(copy);assert.deepEqual(await rpc('escape_unused_media',{p_paths:[path]}),[]);
await as('anon');const projection=await play(tokens[0]);assert.equal(projection.current.media[0].url,url);assert.equal(projection.studentName,'학생1');assert.ok(projection.studentDisplaySettings);assert.ok(projection.design);assert.equal(projection.displayStats.penaltyPoints,0);assert.equal(projection.displayStats.hintsUsed,0);assert.ok(!JSON.stringify(projection).includes('answers'));
await as('authenticated',A);await finish(sid);assert.deepEqual(await rpc('escape_unused_media',{p_paths:[path]}),[path]);
assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[path])).rows.length,1);
r.content[0].media=[{type:'image',url}];await assert.rejects(update(r),/이미 삭제/);r.content[0].media=[];
// Archive deletion is content-scoped; active class and fixed code survive.
await finish(sid,'reset',true);const next=(await rpc('escape_library_sessions')).find(x=>x.contentId===copy.id);assert.equal(next.status,'lobby');
const otherSid=(await teacher('open',r.id)).sessionId;await finish(otherSid);await finish(otherSid,'reset',true);assert.equal((await history(r.id)).length,1);
await as('authenticated',B);await assert.rejects(rpc('escape_delete_archives',{p_content:copy.id,p_confirm:true}),/본인/);
await as('anon');await assert.rejects(rpc('escape_delete_archives',{p_content:copy.id,p_confirm:true}),/permission denied/);
await as('authenticated',A);await assert.rejects(rpc('escape_delete_archives',{p_content:copy.id,p_confirm:false}),/확인/);
assert.equal(await rpc('escape_delete_archives',{p_content:copy.id,p_confirm:true}),1);assert.equal((await history(copy.id)).length,0);assert.equal((await history(r.id)).length,1);assert.equal((await rpc('escape_library_sessions')).find(x=>x.contentId===copy.id).sessionId,next.sessionId);
// Room deletion can enumerate own folder, never delete a copied reference.
const p2=`${A}/${r.id}/audio/${crypto.randomUUID()}.mp3`;await objectInsert(p2);r.theme.bgm='https://local.supabase.co/storage/v1/object/public/escape-media/'+p2;await update(r);copy.theme.bgm=r.theme.bgm;await update(copy);
assert.deepEqual(await rpc('escape_room_media',{p_content:r.id}),[p2]);await db.query('delete from public.escape_contents where id=$1',[r.id]);assert.deepEqual(await rpc('escape_unused_media',{p_paths:[p2]}),[]);
await db.query('delete from public.escape_contents where id=$1',[copy.id]);assert.deepEqual(await rpc('escape_unused_media',{p_paths:[p2]}),[p2]);await db.query('delete from storage.objects where name=$1',[p2]);
await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_contents')).rows[0].n,0);assert.equal((await db.query('select count(*) n from storage.objects')).rows[0].n,0);await db.close();
console.log('PASS 011: public bucket, owner-only upload/delete, anon/other teacher denial, immutable replacement, cross-room and active snapshot references, deletion tombstones, safe student projection, scoped archives/reset and cleanup');
