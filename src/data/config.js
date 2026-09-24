import { SUPABASE_CONFIG } from '../config.js';
export const CONFIG_KEY = 'escape-studio:supabase';
export const SESSION_KEY = 'escape-studio:teacher-session';
export function validateConfig(url, key) {
  const u = new URL(String(url).trim());
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.username || u.password || u.search || u.hash) throw Error('https://프로젝트.supabase.co 형태의 프로젝트 URL을 입력하세요.');
  key = String(key).trim();
  if (key.startsWith('sb_secret_')) throw Error('비밀키는 사용할 수 없습니다. 공개용 키를 입력하세요.');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    try { if (JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role !== 'anon') throw Error(); }
    catch { throw Error('올바른 publishable 또는 anon 키를 입력하세요.'); }
  }
  return { url: u.origin, key };
}
export function getConfig(storage = globalThis.localStorage) {
  let override;
  try { override = JSON.parse(storage?.getItem(CONFIG_KEY) || 'null'); } catch { /* Use deployment defaults when browser storage is unavailable. */ }
  if (override) return validateConfig(override.url, override.key);
  return SUPABASE_CONFIG.url && SUPABASE_CONFIG.key ? validateConfig(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key) : null;
}
export function setConfig(url, key) {
  const config = validateConfig(url, key);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  // Legacy sessions were not bound to a project and must not be reused.
  sessionStorage.removeItem(SESSION_KEY);
  return config;
}
export function resetConfig() { localStorage.removeItem(CONFIG_KEY); return getConfig(); }
export const sessionKey = config => `${SESSION_KEY}:${config.url}`;
