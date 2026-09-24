// Read-only deployment check. Does not create an Auth user or participant.
import { SupabaseRepository } from '../src/data/supabase.js';
import { SUPABASE_CONFIG } from '../src/config.js';
const repo = new SupabaseRepository(SUPABASE_CONFIG, { storage: null });
try {
  await repo.request('/rest/v1/rpc/escape_student_lobby', { method: 'POST', auth: false, body: { p_token: '0'.repeat(64) } });
  throw Error('Unexpected successful response for an invalid participant token');
} catch (error) {
  if (error.code === '42501') console.log('Lobby RPC installed; invalid recovery token rejected (42501).');
  else { console.error(`${error.code || 'ERROR'}: ${error.message}`); process.exitCode = 1; }
}
