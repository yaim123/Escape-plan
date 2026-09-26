// Signup uses GoTrue's implicit flow, independently of the application's hash router.
export function authRedirectUrl(href = globalThis.location.href) {
  const u = new URL(href); u.search = '?auth=confirm'; u.hash = ''; return u.href;
}
export function readAuthCallback(href) {
  const u = new URL(href), p = new URLSearchParams(u.search);
  const fragment = u.hash.slice(1);
  if (!fragment.startsWith('/')) for (const [k,v] of new URLSearchParams(fragment)) p.set(k,v);
  const detected = p.get('auth') === 'confirm' || p.has('access_token') || p.has('error') || p.has('error_description') || p.has('error_code') || p.has('token_hash') || (p.has('code') && !/^\d{6}$/.test(p.get('code')));
  if (!detected) return null;
  return {accessToken:p.get('access_token'), error:p.get('error_code') || p.get('error'), code:p.get('code'), tokenHash:p.get('token_hash')};
}
export async function verifyAuthCallback(callback, config, fetcher = globalThis.fetch) {
  if (callback.error) return {ok:false, message:'인증 링크가 만료되었거나 이미 사용되었습니다. 이미 인증했다면 로그인해 주세요. 로그인할 수 없다면 새 인증 메일을 요청해 주세요.'};
  // This application never starts PKCE: no verifier exists to safely exchange a query code.
  if (!callback.accessToken || !config) return {ok:false, message:'이 인증 링크를 확인할 수 없습니다. 가입한 사이트에서 새 인증 메일을 요청하거나 이미 인증한 계정으로 로그인해 주세요.'};
  try {
    const response = await fetcher(config.url + '/auth/v1/user', {headers:{apikey:config.key,Authorization:'Bearer '+callback.accessToken},signal:AbortSignal.timeout(20000)});
    const user = response.ok ? await response.json() : null;
    return user?.email_confirmed_at ? {ok:true,message:'이제 교사 계정으로 로그인할 수 있습니다.'} : {ok:false,message:'이메일 인증을 확인하지 못했습니다. 만료되었거나 사용한 링크라면 로그인하거나 새 인증 메일을 요청해 주세요.'};
  } catch { return {ok:false,message:'인증 상태를 확인할 서버에 연결하지 못했습니다. 잠시 후 교사 로그인을 시도해 주세요.'}; }
}
