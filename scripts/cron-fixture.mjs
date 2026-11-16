// PGlite cannot run background workers. Capture scheduling SQL only; never simulate
// successful pg_cron execution. Integration tests invoke the actual cleanup function.
export async function cronFixture(db){
 await db.exec(`create schema cron;
 create table cron.job(jobname text primary key,schedule text,command text);
 create function cron.schedule(text,text,text) returns bigint language sql as $$
 insert into cron.job values($1,$2,$3) on conflict(jobname) do update set schedule=$2,command=$3 returning 1::bigint;$$;
 revoke all on schema cron from public,anon,authenticated;`);
}
