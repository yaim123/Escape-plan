import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { newRoom,newBlock } from '../src/core/model.js';
import { isComplete,isUnlocked,assignedMembers } from '../src/core/conditions.js';
import { checkAnswer } from '../src/core/answers.js';
process.on('uncaughtException',error=>{console.error(error.message,error.where||'',error.stack?.split('\n').filter(s=>s.includes('verify-results-sql')).join('\n')||'');process.exit(1);});
let PGlite; try { ({PGlite}=await import('@electric-sql/pglite')); } catch { ({PGlite}=await import('../artifacts/pglite/package/dist/index.js')); }
const db=new PGlite(); const A=crypto.randomUUID(), B=crypto.randomUUID();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema realtime;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create table realtime.test_messages(payload jsonb);
create function realtime.send(p jsonb,e text,t text,b boolean) returns void language sql as $$ insert into realtime.test_messages values(p) $$;`);
await db.query('insert into auth.users values($1),($2)',[A,B]);
for(const file of ['001_foundation','002_live_lobby','003_live_play','004_teacher_controls','005_teacher_team_event_fix','006_results_and_reset','007_qr_interaction']) await db.exec(await readFile(`supabase/${file}.sql`,'utf8'));
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

const {newQrMission,newQr}=await import('../src/core/qr.js');
const scan=(t,q)=>call('select public.escape_scan_qr($1,$2) result',[t,q.token]);
for(const mode of ['ANY','ALL','N_OF_M','UNIQUE_MEMBER']){
 const room=newRoom('QR '+mode);room.playMode='team';const m=newQrMission();m.mode=mode;m.count=2;m.codes=[newQr(),newQr(),newQr()];room.qrMissions=[m];const q=newBlock();q.answers=['SECRET'];q.unlock.conditions=[{blockId:m.id,event:'qr_complete',member:0,role:''}];room.content=[q];
 const sid=(await save(room)).sessionId;await as('anon');await join(room,tokens[0],1);await join(room,tokens[1],2);await lobby(tokens[0],1);await lobby(tokens[1],1);
 await as('authenticated',A);await teacher('start',sid);await as('anon');assert.equal((await play(tokens[0])).current,null);
 await scan(tokens[0],m.codes[0]);assert.equal((await scan(tokens[1],m.codes[0])).duplicate,true);assert.equal((await play(tokens[1])).qr[0].found,1);
 if(mode!=='ANY'){assert.equal((await play(tokens[0])).current,null);await scan(tokens[0],m.codes[1]);}
 if(mode==='ALL'){assert.equal((await play(tokens[0])).current,null);await scan(tokens[0],m.codes[2]);}
 if(mode==='UNIQUE_MEMBER'){assert.equal((await play(tokens[0])).current,null);await scan(tokens[1],m.codes[2]);}
 assert.equal((await play(tokens[1])).current.id,q.id);assert.equal((await play(tokens[1])).qr[0].done,true);assert.ok(!JSON.stringify(await play(tokens[1])).includes(m.codes[0].token));
 await assert.rejects(scan(tokens[0],newQr()),/활성 QR/);await as('authenticated',A);assert.equal((await dash(sid)).participants[0].qr[0].done,true);
 await finish(sid,'reset',false);await db.query('delete from public.escape_contents where id=$1',[room.id]);
}
const room=newRoom('개인 QR');const m=newQrMission();m.scope='student';room.qrMissions=[m];const q=newBlock();q.answers=['YES'];q.unlock.conditions=[{blockId:m.codes[0].id,event:'qr_scanned'}];room.content=[q];const sid=(await save(room)).sessionId;
await as('anon');await join(room,tokens[0],1);await join(room,tokens[1],2);await assert.rejects(scan(tokens[0],m.codes[0]),/진행 중/);await as('authenticated',A);await teacher('start',sid);await as('anon');await scan(tokens[0],m.codes[0]);assert.equal((await play(tokens[0])).current.id,q.id);assert.equal((await play(tokens[1])).current,null);
await assert.rejects(db.query('select * from public.escape_qr_scans'),/permission denied/);await assert.rejects(db.query('delete from public.escape_qr_scans'),/permission denied/);await as('authenticated',B);await assert.rejects(dash(sid),/본인/);
await as('authenticated',A);await call("select public.escape_teacher_control($1,'pause','session',null,null,null,null,null,$2,$3) result",[sid,(await dash(sid)).revision,crypto.randomUUID()]);await as('anon');await assert.rejects(scan(tokens[1],m.codes[0]),/진행 중/);
await as('authenticated',A);await call("select public.escape_teacher_control($1,'resume','session',null,null,null,null,null,$2,$3) result",[sid,(await dash(sid)).revision,crypto.randomUUID()]);
const doc=structuredClone(room);doc.qrMissions[0].codes[0].active=false;await db.query('update public.escape_contents set document=$2 where id=$1',[room.id,doc]);await as('anon');await assert.rejects(scan(tokens[1],m.codes[0]),/비활성화/);
await as('authenticated',A);await db.query('delete from public.escape_contents where id=$1',[room.id]);await as('postgres');assert.equal((await db.query('select count(*) n from public.escape_qr_scans')).rows[0].n,0);
await db.close();console.log('PASS QR: personal/team, ANY/ALL/N_OF_M/UNIQUE_MEMBER, unique team claim, foreign QR denied, existing conditions, safe projection, dashboard, reset cascade/RLS');
