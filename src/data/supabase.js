import { validateRoom } from '../core/model.js';
import { validateConfig, sessionKey } from './config.js';
export { getConfig, setConfig } from './config.js';
// Only a public publishable/anon key belongs in the browser. RLS owns authorization.
export class SupabaseError extends Error {
  constructor(message, status, code) { super(message); this.name = 'SupabaseError'; this.status = status; this.code = code; }
}
export class SupabaseRepository {
  constructor(config, { storage = globalThis.sessionStorage, fetcher = globalThis.fetch } = {}) {
    this.config = validateConfig(config.url, config.key); this.mode = 'cloud'; this.storage = storage; this.fetcher = fetcher.bind(globalThis); this.storageKey = sessionKey(this.config);
    try { this.session = JSON.parse(storage?.getItem(this.storageKey) || 'null'); } catch { this.session = null; }
  }
  async request(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
    if (auth && this.session?.expires_at * 1000 < Date.now() + 60000) await this.refresh();
    const requestHeaders = new Headers({ 'Content-Type': 'application/json', ...headers });
    requestHeaders.set('apikey', this.config.key);
    requestHeaders.delete('Authorization');
    if (auth && this.session) requestHeaders.set('Authorization', `Bearer ${this.session.access_token}`);
    let res;
    try { res = await this.fetcher(this.config.url + path, { method, headers: requestHeaders, signal: AbortSignal.timeout(20000), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
    catch (error) { throw new SupabaseError(error.name === 'TimeoutError' ? 'Supabase 응답 시간이 초과되었습니다.' : 'Supabase에 연결하지 못했습니다. 네트워크와 프로젝트 주소를 확인하세요.', 0, 'NETWORK_ERROR'); }
    const text = await res.text(); let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw new SupabaseError(data?.msg || data?.message || data?.error_description || `요청 실패 (${res.status})`, res.status, data?.error_code || data?.code);
    return data;
  }
  storeSession(data) { if (data?.access_token) { this.session = { ...data, expires_at: data.expires_at || Date.now() / 1000 + data.expires_in }; this.storage?.setItem(this.storageKey, JSON.stringify(this.session)); } }
  async signIn(email, password) { const data = await this.request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false }); this.storeSession(data); return data; }
  async signUp(email, password) { const data = await this.request('/auth/v1/signup', { method: 'POST', body: { email, password }, auth: false }); this.storeSession(data); return data; }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => { try { const data = await this.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: this.session.refresh_token }, auth: false }); this.storeSession(data); } catch (error) { if (error.status === 400 || error.status === 401) { this.session = null; this.storage?.removeItem(this.storageKey); } throw error; } finally { this.refreshing = null; } })();
    return this.refreshing;
  }
  async signOut() { try { await this.request('/auth/v1/logout', { method: 'POST' }); } finally { this.session = null; this.storage?.removeItem(this.storageKey); } }
  async getUser() { this.requireUser(); return this.request('/auth/v1/user'); }
  async get(id) { this.requireUser(); return (await this.request(`/rest/v1/escape_contents?id=eq.${encodeURIComponent(id)}&select=*`))[0] || null; }
  requireUser() { if (!this.session?.user?.id) throw Error('교사 로그인이 필요합니다.'); return this.session.user.id; }
  async list() { this.requireUser(); const rows = await this.request('/rest/v1/escape_contents?select=*&order=updated_at.desc'); return rows.map(r => ({ ...r.document, id: r.id, roomCode: r.room_code, updatedAt: r.updated_at })); }
  async save(room) {
    const errors = validateRoom(room); if (errors.length) throw Error(errors[0]);
    const owner = this.requireUser();
    const rows = await this.request('/rest/v1/escape_contents?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: { id: room.id, owner_id: owner, room_code: room.roomCode, title: room.title, document: room } });
    return { ...rows[0].document, updatedAt: rows[0].updated_at };
  }
  async remove(id) { this.requireUser(); await this.request(`/rest/v1/escape_contents?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); }
}
