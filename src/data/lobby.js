import { getConfig, SupabaseRepository } from './supabase.js';
export const makeRecoveryToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
export function studentJoinUrl(code,base){const url=new URL(base);url.search='';url.hash='/join?code='+encodeURIComponent(code);return url.href;}
export function codeFromUrl(url = location.href) {
  const parsed = new URL(url);
  const candidate = parsed.hash.match(/^#\/join\/([0-9]{6})(?:$|\?)/)?.[1] || parsed.searchParams.get('code') || new URLSearchParams(parsed.hash.split('?')[1]).get('code') || '';
  return /^\d{6}$/.test(candidate) ? candidate : '';
}
export class LobbyClient {
  constructor(repo = null, storage = globalThis.localStorage) {
    this.repo = repo || new SupabaseRepository(getConfig(), { storage: null }); this.storage = storage;
  }
  key(code) { return `escape-studio:participant:${this.repo.config.url}:${code}`; }
  saved(code) { try { return JSON.parse(this.storage.getItem(this.key(code)) || 'null'); } catch { return null; } }
  forget(code) { this.storage.removeItem(this.key(code)); }
  rpc(name, body, teacher = false) { return this.repo.request(`/rest/v1/rpc/${name}`, { method: 'POST', body, auth: teacher }); }
  teacher(action, id) { this.repo.requireUser(); return this.rpc('escape_teacher_lobby', { p_action: action, p_id: id }, true); }
  snapshot(contentId,action='inspect',info={}) {this.repo.requireUser();return this.rpc('escape_lobby_snapshot',{p_content:contentId,p_action:action,p_session:info.state?.sessionId||null,p_version:info.version||null,p_snapshot_version:info.snapshotVersion||null,p_allow_assets:action!=='inspect',p_failed_assets:info.failedAssets||[]},true);}
  async join(code, identity) {
    const previous = this.saved(code), token = previous?.token || makeRecoveryToken();
    // Persist BEFORE sending: a lost response/reload retries the same identity.
    this.storage.setItem(this.key(code), JSON.stringify({ token, ...identity }));
    const result = await this.rpc('escape_join_lobby', { p_code: code, p_token: token, ...identity });
    this.storage.setItem(this.key(code), JSON.stringify({ token, ...identity, participantId: result.participantId, sessionId: result.sessionId }));
    this.storage.setItem(`escape-studio:active-room:${this.repo.config.url}`,code);
    return result;
  }
  student(code, action = 'read', extra = {}) {
    const saved = this.saved(code); if (!saved?.token) throw Error('참가 기록이 없습니다. 방 코드로 입장하세요.');
    return this.rpc('escape_student_lobby', { p_token: saved.token, p_action: action, ...extra });
  }
}
