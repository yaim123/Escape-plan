// Run explicitly: node scripts/verify-lobby-sql.mjs. PostgreSQL engine test using PGlite.
// Install @electric-sql/pglite@0.5.8
// or unpack its official npm tarball under artifacts/pglite/package/.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { newRoom } from '../src/core/model.js';
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); }
catch { ({ PGlite } = await import('../artifacts/pglite/package/dist/index.js')); }
const db = new PGlite();
const A = crypto.randomUUID(), B = crypto.randomUUID();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema realtime;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create table realtime.test_messages(payload jsonb, event text, topic text, private boolean);
create function realtime.send(p jsonb, e text, t text, b boolean) returns void language sql as $$ insert into realtime.test_messages values(p,e,t,b) $$;`);
await db.query('insert into auth.users values ($1),($2)', [A,B]);
await db.exec(await readFile('supabase/001_foundation.sql', 'utf8'));
await db.exec(await readFile('supabase/002_live_lobby.sql', 'utf8'));
const as = async (role, uid = '') => { await db.exec(`reset role; set role ${role};`); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]); };
const rpc = async (sql, args = []) => (await db.query(sql,args)).rows[0].result;
const teacher = (action,id) => rpc('select public.escape_teacher_lobby($1,$2) result',[action,id]);
const student = (token, action='read', team=null) => rpc('select public.escape_student_lobby($1,$2,$3) result',[token,action,team]);
const join = (code,token,n) => rpc('select public.escape_join_lobby($1,$2,2,6,$3,$4) result',[code,token,n,`학생${n}`]);
const room = newRoom('SQL 검증'); room.playMode='team'; room.teamSettings={...room.teamSettings,teamCount:2,maxMembers:1}; room.content[0].answers=['SECRET_ANSWER'];
await as('authenticated',A);
await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[room.id,A,room.roomCode,room.title,room]);
await as('authenticated',B);
assert.equal((await db.query('select * from public.escape_contents')).rows.length,0);
assert.equal((await db.query('update public.escape_contents set title=$1 returning id',['intrusion'])).rows.length,0);
assert.equal((await db.query('delete from public.escape_contents returning id')).rows.length,0);
await assert.rejects(teacher('open',room.id), /본인 콘텐츠/);
await as('authenticated',A);
let state = await teacher('open',room.id); const sid=state.sessionId;
assert.equal((await teacher('open',room.id)).sessionId,sid);
assert.equal(JSON.stringify(state).includes('SECRET_ANSWER'),false);
await assert.rejects(teacher('start',sid), /참가 학생/);
await as('anon');
await assert.rejects(db.query('select * from public.escape_sessions'),/permission denied/);
await assert.rejects(db.query('select * from public.escape_participants'),/permission denied/);
await assert.rejects(db.query('select * from public.escape_contents'),/permission denied/);
await assert.rejects(teacher('start',sid),/permission denied/);
await assert.rejects(db.query('select escape_private.roster($1)',[sid]),/permission denied/);
const t1='a'.repeat(64),t2='b'.repeat(64),t3='c'.repeat(64);
state=await join(room.roomCode,t1,1); const p1=state.participantId;
assert.equal((await join(room.roomCode,t1,1)).participantId,p1);
await assert.rejects(join(room.roomCode,t3,1),/이미 참가/);
await join(room.roomCode,t2,2);
await student(t1,'team',1);
await assert.rejects(student(t2,'team',1),/정원이 찬/);
await student(t2,'team',2);
await assert.rejects(student(t3),/찾을 수 없/);
await assert.rejects(student(t1,'team',3),/선택할 수 없/);
await student(t2,'leave');
assert.equal((await student(t1)).participants.length,1);
await student(t1,'team',2);
await join(room.roomCode,t2,2);
await as('authenticated',A);
await assert.rejects(teacher('start',sid),/조를 선택/);
await as('anon'); await student(t2,'team',1);
state=await rpc("select public.escape_student_lobby($1,'profile',null,2,6,2,'변경 이름') result",[t2]);
assert.equal(state.participants.find(p=>p.number===2).name,'변경 이름');
await as('authenticated',B); await assert.rejects(teacher('read',sid),/본인 대기실/);
await as('authenticated',A); state=await teacher('start',sid);
assert.equal(state.status,'playing'); assert.ok(state.startedAt);
assert.equal((await teacher('start',sid)).startedAt,state.startedAt);
await as('anon');
await assert.rejects(student(t1,'team',1),/게임 시작 후/);
await assert.rejects(join(room.roomCode,t3,3),/신규 입장/);
assert.equal((await join(room.roomCode,t1,1)).status,'playing');
assert.equal((await student(t1)).participantId,p1);
await as('authenticated',A); await teacher('close',sid);
assert.equal((await teacher('open',room.id)).status,'lobby');
await db.query('delete from public.escape_contents where id=$1',[room.id]);
// Individual mode skips teams; null capacity permits multiple team members.
for (const mode of ['individual','team']) {
  room.playMode=mode; room.teamSettings.maxMembers=null;
  await db.query('insert into public.escape_contents(id,owner_id,room_code,title,document) values($1,$2,$3,$4,$5)',[room.id,A,room.roomCode,room.title,room]);
  const opened=await teacher('open',room.id);
  await as('anon'); await join(room.roomCode,t1,1); await join(room.roomCode,t2,2);
  if(mode==='individual') { await assert.rejects(student(t1,'team',1),/선택할 수 없/); }
  else { await student(t1,'team',1); assert.equal((await student(t2,'team',1)).participants.filter(p=>p.team===1).length,2); }
  await as('authenticated',A); assert.equal((await teacher('start',opened.sessionId)).status,'playing');
  await db.query('delete from public.escape_contents where id=$1',[room.id]);
}
await as('postgres');
const messages=(await db.query('select * from realtime.test_messages')).rows;
assert.ok(messages.length>5); assert.ok(messages.every(m=>JSON.stringify(m.payload)==='{}' && !m.private));
assert.equal((await db.query('select * from public.escape_participants')).rows.length,0);
await db.close(); console.log('PostgreSQL: two-owner RLS, RPC permissions, recovery, capacity, leave, profile, start lock, safe payload, cleanup PASS');
