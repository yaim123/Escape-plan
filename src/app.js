import {readAuthCallback,verifyAuthCallback} from './data/auth-callback.js';
import { LocalRepository } from './data/storage.js';
import { getConfig, SupabaseRepository } from './data/supabase.js';
import { renderStudentEntry, renderTeacherLobby } from './ui/lobby.js';
import { esc, icon, button, toast } from './ui/dom.js';

const config = getConfig();
const cloud = config ? new SupabaseRepository(config) : null;
const app = {
  repo: sessionStorage.getItem('escape-studio:mode') === 'cloud' && cloud?.session ? cloud : new LocalRepository(),
  cleanup: null,
  useLocal() { this.repo = new LocalRepository(); sessionStorage.setItem('escape-studio:mode', 'local'); },
  useCloud(repo) { this.repo = repo; sessionStorage.setItem('escape-studio:mode', 'cloud'); },
  navigate(route) { location.hash = '#/' + route; }
};
let activeHash = '', transitioning = false;
async function render() {
  if (transitioning) return;
  transitioning = true;
  const requestedHash = location.hash;
  try {
    if (app.cleanup && !(await app.cleanup())) { history.replaceState(null, '', activeHash || '#/library'); return; }
    app.cleanup = null;
    const [route = 'library', id, blockId] = (requestedHash.replace(/^#\/?/, '') || (new URLSearchParams(location.search).has('qr')?'qr':new URLSearchParams(location.search).has('code') ? 'join' : 'library')).split('/');
    if(route==='qr'){document.title='QR 단서 · 열쇠공방';document.querySelector('#app').innerHTML='<main id="view" class="student-shell"></main>';await (await import('./ui/qr.js')).renderQrLink(document.querySelector('#view'),app);activeHash=location.hash;return;}
    if (route === 'join' || route.startsWith('join?')) {
      document.title = '학생 대기실 · 열쇠공방';
      document.querySelector('#app').innerHTML = '<main id="view" class="student-shell"></main>';
      await renderStudentEntry(document.querySelector('#view'), app, id);
      activeHash = location.hash; return;
    }
    const compact = ['editor', 'test'].includes(route);
    document.title = `${route === 'editor' ? '방탈출 제작기' : route === 'test' ? '플레이 테스트' : '내 방탈출'} · 열쇠공방`;
    document.querySelector('#app').innerHTML = `<div class="app-shell ${compact ? 'compact' : ''}"><aside class="app-sidebar"><a class="brand" href="#/library"><span class="brand-icon">${icon('key')}</span><span>열쇠공방<small>ESCAPE STUDIO</small></span></a><div class="workspace-label">제작자 작업 공간</div><nav aria-label="주 메뉴"><a href="#/library" class="nav-item ${['library', 'editor', 'test'].includes(route) ? 'active' : ''}">${icon('grid')}<span>내 방탈출</span></a><a href="#/settings" class="nav-item ${route === 'settings' ? 'active' : ''}">${icon('settings')}<span>저장 공간 설정</span></a></nav><div class="sidebar-help"><span class="version-badge">첫 번째 제작 버전</span><h3>생각을 단서로,<br>수업을 모험으로.</h3><p>스토리와 문제를 연결해<br>새로운 배움을 만들어보세요.</p></div><div class="profile"><span class="avatar">${app.repo.mode === 'local' ? '체' : '교'}</span><div><strong>${app.repo.mode === 'local' ? '로컬 체험' : '교사 작업 공간'}</strong><small>${app.repo.mode === 'local' ? '이 브라우저에 저장' : '온라인 저장'}</small></div></div></aside><div class="app-main"><header class="app-header"><a href="#/library" class="mobile-brand">${icon('key')} 열쇠공방</a><span class="header-label">나만의 교육용 방탈출 제작 공간</span><div class="actions"><span class="storage-badge">${icon(app.repo.mode === 'local' ? 'monitor' : 'check')}${app.repo.mode === 'local' ? '로컬 체험 모드' : 'Supabase 연결'}</span>${app.repo.mode === 'cloud' ? button('로그아웃', 'logout', 'small') : '<a class="btn small" href="#/login">교사 로그인</a>'}</div></header><main id="view" class="view ${compact ? 'full-view' : ''}"></main></div></div>`;
    document.querySelector('[data-action="logout"]')?.addEventListener('click', async () => { try { await app.repo.signOut(); } catch (err) { toast(err.message, true); } finally { app.useLocal(); app.navigate('login'); } });
    const view = document.querySelector('#view');
    if (route === 'editor' && id) await (await import('./ui/editor.js')).renderEditor(view, app, id);
    else if (route === 'test' && id) await (await import('./ui/player.js')).renderPlayer(view, app, id, blockId);
    else if (route === 'lobby' && id) await renderTeacherLobby(view, app, id);
    else if (route === 'history' && id) await (await import('./ui/results.js')).renderHistory(view,app,id);
    else if (route === 'rls-check') await (await import('./ui/rls-check.js')).renderRlsCheck(view, app);
    else if (route === 'settings') (await import('./ui/settings.js')).renderSettings(view, app);
    else if (route === 'login') (await import('./ui/settings.js')).renderLogin(view, app);
    else await (await import('./ui/library.js')).renderLibrary(view, app);
    activeHash = requestedHash; window.scrollTo(0, 0);
  } catch (err) {
    const view = document.querySelector('#view') || document.querySelector('#app');
    view.innerHTML = `<div class="empty"><h1>작업 공간을 열지 못했습니다</h1><p>${esc(err.message)}</p><div class="actions center"><a class="btn primary" href="#/settings">저장 공간 설정</a><a class="btn" href="#/library">내 방탈출</a></div></div>`;
  } finally { transitioning = false; if (location.hash !== requestedHash && location.hash !== activeHash) render(); }
}
const callback = readAuthCallback(location.href);
if (callback) {
  // Clear callback credentials before rendering or network access; login/import stay separate.
  history.replaceState(null,'',location.pathname+'#/auth-confirm');
  document.querySelector('#app').innerHTML='<main class="student-shell"><p>이메일 인증 확인 중…</p></main>';
  const result=await verifyAuthCallback(callback,config);
  document.querySelector('#app').innerHTML=`<main class="student-shell"><section class="panel"><h1>${result.ok?'이메일 인증이 완료되었습니다.':'이메일 인증 링크 안내'}</h1><p>${esc(result.message)}</p><a class="btn primary" href="#/login">로그인하기</a></section></main>`;
} else render();
window.addEventListener('hashchange', render);
