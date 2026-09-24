import { getConfig } from '../src/data/config.js';
import { SupabaseRepository } from '../src/data/supabase.js';
import { runConnectionChecks } from '../src/data/diagnostics.js';
// No tokens/passwords are accepted by this public connectivity check.
const repo = new SupabaseRepository(getConfig(), { storage: undefined });
console.log(`Supabase 공개 연결 검사: ${repo.config.url}`);
const results = await runConnectionChecks(repo, result => console.log(JSON.stringify(result)));
if (results.some(r => r.status === 'fail')) process.exitCode = 1;
