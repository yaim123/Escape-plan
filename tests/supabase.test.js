import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, getConfig, sessionKey } from '../src/data/config.js';
import { SupabaseRepository, SupabaseError } from '../src/data/supabase.js';
import { isPermissionDenied, runConnectionChecks } from '../src/data/diagnostics.js';
import { authErrorMessage } from '../src/data/auth-errors.js';

const config = { url: 'https://project-a.supabase.co', key: 'sb_publishable_test' };
const memory = () => { const map = new Map(); return { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const token = role => `e30.${btoa(JSON.stringify({ role }))}.test`;

test('public configuration accepts only public key types', () => {
  assert.deepEqual(validateConfig(config.url, config.key), config);
  assert.doesNotThrow(() => validateConfig(config.url, token('anon')));
  assert.throws(() => validateConfig(config.url, 'sb_secret_test'));
  assert.throws(() => validateConfig(config.url, token('service_role')));
  assert.throws(() => validateConfig(config.url, 'NEXT_PUBLIC_KEY=sb_publishable_test'));
  for (const url of ['http://example.com', 'https://example.com?secret=x', 'https://user:password@example.com', 'https://example.com/path']) assert.throws(() => validateConfig(url, config.key));
});
test('static default config works without browser storage, overrides are validated', () => {
  assert.equal(getConfig().url, 'https://rxknixllqewkvgfnpshu.supabase.co');
  const storage = memory(); storage.setItem('escape-studio:supabase', JSON.stringify(config)); assert.deepEqual(getConfig(storage), config);
  storage.setItem('escape-studio:supabase', JSON.stringify({ ...config, key: 'sb_secret_test' })); assert.throws(() => getConfig(storage));
});
test('sessions are isolated by project URL', () => {
  const storage = memory(); storage.setItem(sessionKey(config), JSON.stringify({ access_token: 'user-a-token' }));
  assert.equal(new SupabaseRepository(config, { storage }).session.access_token, 'user-a-token');
  assert.equal(new SupabaseRepository({ ...config, url: 'https://project-b.supabase.co' }, { storage }).session, null);
});
test('fetch uses the browser global receiver and public key is not a Bearer token', async () => {
  const repo = new SupabaseRepository(config, { storage: memory(), fetcher: function (url, init) { assert.equal(this, globalThis); assert.equal(init.headers.get('apikey'), config.key); assert.equal(init.headers.has('Authorization'), false); return response({}); } });
  await repo.request('/auth/v1/settings', { auth: false, headers: { Authorization: 'Bearer should-not-be-sent' } });
});
test('authenticated requests carry the user token, anonymous probes never do', async () => {
  const seen = [], repo = new SupabaseRepository(config, { storage: memory(), fetcher: (url, init) => { seen.push(init.headers.get('Authorization')); return response({}); } });
  repo.storeSession({ access_token: 'user-token', expires_in: 3600, user: { id: 'user-a' } });
  await repo.request('/rest/v1/escape_contents'); await repo.request('/rest/v1/escape_contents', { auth: false });
  assert.deepEqual(seen, ['Bearer user-token', null]);
});
test('Postgres permission errors retain HTTP and database codes', async () => {
  const repo = new SupabaseRepository(config, { storage: memory(), fetcher: () => response({ code: '42501', message: 'permission denied' }, 403) });
  await assert.rejects(repo.request('/rest/v1/escape_contents'), error => error instanceof SupabaseError && isPermissionDenied(error));
  assert.equal(isPermissionDenied({ status: 401, code: 'invalid_jwt' }), false);
  assert.equal(isPermissionDenied({ status: 404, code: 'PGRST205' }), false);
});
test('concurrent authenticated requests share a single token refresh', async () => {
  let refreshes = 0;
  const repo = new SupabaseRepository(config, { storage: memory(), fetcher: async url => {
    if (url.includes('grant_type=refresh_token')) { refreshes++; return response({ access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600, user: { id: 'u' } }); }
    return response([]);
  } });
  repo.storeSession({ access_token: 'old-token', refresh_token: 'old-refresh', expires_at: 1, user: { id: 'u' } });
  await Promise.all([repo.request('/rest/v1/escape_contents'), repo.request('/rest/v1/escape_contents')]); assert.equal(refreshes, 1);
});
test('failed connectivity checks do not make table mutations', async () => {
  let calls = 0;
  const results = await runConnectionChecks({ request: async () => { calls++; throw new SupabaseError('Invalid key', 401, 'invalid_api_key'); } });
  assert.equal(calls, 1); assert.equal(results[0].status, 'fail');
});
test('public checks report auth-required without claiming a successful write', async () => {
  const repo = { session: null, request: async path => { if (path.startsWith('/auth')) return {}; throw new SupabaseError('permission denied', 401, '42501'); } };
  const results = await runConnectionChecks(repo); assert.equal(results.filter(r => r.status === 'pass').length, 5); assert.equal(results.at(-1).status, 'pending');
});
test('authentication failures distinguish credentials, confirmation, and mail restrictions', () => {
  assert.match(authErrorMessage({ code: 'invalid_credentials' }), /교사 계정/);
  assert.match(authErrorMessage({ code: 'email_not_confirmed' }), /인증 링크/);
  assert.match(authErrorMessage({ code: 'over_email_send_rate_limit' }), /발송 한도/);
  assert.match(authErrorMessage({ code: 'email_address_not_authorized' }), /메일 발송 설정/);
  assert.equal(authErrorMessage({ message: 'Unexpected server error' }), 'Unexpected server error');
});
test('Auth error_code takes priority over numeric code', async () => {
  const repo = new SupabaseRepository(config, { storage: memory(), fetcher: () => response({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400) });
  await assert.rejects(repo.signIn('test@example.invalid', 'test-password'), error => error.code === 'invalid_credentials' && /교사 계정/.test(authErrorMessage(error)));
});
function diagnosticRepository({ failUpdate = false } = {}) {
  const rows = new Map([['existing-room', { id: 'existing-room', title: 'Existing user data', owner_id: 'teacher' }]]);
  let writes = 0;
  return {
    rows,
    session: { user: { id: 'teacher' } },
    requireUser: () => 'teacher',
    getUser: async () => ({ id: 'teacher' }),
    get: async id => rows.get(id) || null,
    save: async room => { writes++; if (failUpdate && writes === 2) throw Error('Simulated update failure'); rows.set(room.id, { id: room.id, title: room.title, room_code: room.roomCode, document: structuredClone(room), owner_id: 'teacher' }); },
    request: async (path, init = {}) => {
      if (path === '/auth/v1/settings') return {};
      if (init.method === 'DELETE') { const id = new URL('https://example.invalid' + path).searchParams.get('id').slice(3); const row = rows.get(id); rows.delete(id); return row ? [row] : []; }
      throw new SupabaseError('permission denied', init.auth === false ? 401 : 403, '42501');
    }
  };
}
test('authenticated diagnostics verify CRUD and delete only their own generated row', async () => {
  const repo = diagnosticRepository(); const results = await runConnectionChecks(repo);
  assert.equal(results.some(r => r.status === 'fail'), false);
  for (const name of ['교사 콘텐츠 쓰기', '교사 콘텐츠 읽기', '교사 콘텐츠 수정', '소유자 RLS 검사', '테스트 콘텐츠 삭제']) assert.equal(results.find(r => r.name === name)?.status, 'pass');
  assert.deepEqual([...repo.rows.keys()], ['existing-room']);
});
test('diagnostic cleanup runs after update failure without touching existing content', async () => {
  const repo = diagnosticRepository({ failUpdate: true }); const results = await runConnectionChecks(repo);
  assert.equal(results.find(r => r.name === '교사 읽기·쓰기 검사')?.status, 'fail');
  assert.equal(results.find(r => r.name === '테스트 콘텐츠 삭제')?.status, 'pass');
  assert.deepEqual([...repo.rows.keys()], ['existing-room']);
});
