import {offerLocalImport} from './local-import.js';
import { esc, button, toast, field } from './dom.js';
import { getConfig, setConfig, SupabaseRepository } from '../data/supabase.js';
import { resetConfig } from '../data/config.js';
import { runConnectionChecks } from '../data/diagnostics.js';
import { authErrorMessage } from '../data/auth-errors.js';
export function renderSettings(root, app) {
  const config = getConfig();
  root.innerHTML = `<div class="page-heading"><div><div class="eyebrow">WORKSPACE SETTINGS</div><h1>저장 공간 설정</h1><p>먼저 로컬에서 시작하고, 준비되면 교사 계정을 연결하세요.</p></div></div><div class="settings-grid"><section class="panel"><span class="pill">바로 사용 가능</span><h2>이 브라우저에 저장</h2><p>계정 없이 방탈출을 만들고 테스트할 수 있습니다. 다른 기기로 옮길 때는 JSON 파일을 내보내세요.</p>${button('로컬 작업 공간 열기', 'local', 'primary')}</section><section class="panel"><span class="pill neutral">Supabase</span><h2>온라인 저장 연결</h2><p>프로젝트를 만들고 제공된 데이터베이스 설정을 적용한 뒤 연결하세요. 로컬 콘텐츠는 자동으로 업로드되지 않습니다.</p><form id="config-form">${field('프로젝트 URL', `<input name="url" type="url" placeholder="https://your-project.supabase.co" value="${esc(config?.url || '')}" required>`)}${field('공개용 publishable / anon 키', `<input name="key" type="password" autocomplete="off" placeholder="sb_publishable_…" value="${esc(config?.key || '')}" required>`, '비밀키 및 service_role 키는 사용하지 않습니다.')}<button class="btn primary" type="submit">연결 정보 저장</button><p class="form-message" role="status"></p></form></section><section class="panel span-two"><h2>현재 제공 범위</h2><p>콘텐츠 제작·저장·미리보기·개인 및 가상 팀 테스트를 사용할 수 있습니다. 실제 학생 입장·팀 선택·실시간 대기실과 문제 플레이를 지원합니다. 서버 정답 판정, 재접속 복구, 팀 진행 공유 및 교사 진행도를 확인할 수 있습니다. 교사의 전체 일시정지·재개와 학생/팀 진행 관리도 지원합니다. 실제 힌트, 탈출 결과와 순위, 결과 보관 및 같은 코드의 새 수업 초기화를 지원합니다. QR 스캔형 문제와 서버 QR 검증을 지원합니다.</p><p class="muted">온라인 저장은 프로젝트 연결 후 확인이 필요합니다. 설정만 저장했다고 데이터베이스 연결이 완료된 것은 아닙니다.</p></section></div>`;
  root.querySelector('[data-action="local"]').onclick = () => { app.useLocal(); app.navigate('library'); };
  root.querySelector('form').onsubmit = e => { e.preventDefault(); const data = new FormData(e.target); try { setConfig(data.get('url').trim(), data.get('key').trim()); toast('연결 정보를 저장했습니다. 교사 계정으로 로그인하세요.'); app.navigate('login'); } catch (err) { root.querySelector('.form-message').textContent = err.message; } };
  const configForm = root.querySelector('#config-form');
  configForm.insertAdjacentHTML('beforeend', '<p class="muted">기본값은 src/config.js에서 읽습니다. 이 화면에서 저장한 값은 현재 브라우저에서만 기본값보다 우선합니다.</p>' + button('배포 기본 설정 사용', 'reset-config'));
  root.querySelector('[data-action="reset-config"]').onclick = () => { resetConfig(); renderSettings(root, app); toast('배포 기본 설정을 불러왔습니다.'); };
  root.querySelector('.settings-grid').insertAdjacentHTML('beforeend', `<section class="panel span-two"><h2>Supabase 연결 검사</h2><p>프로젝트 연결과 테이블 권한을 확인합니다. 교사 로그인 상태에서는 검사 전용 콘텐츠 한 건을 생성·조회·수정한 뒤 정리합니다.</p><p class="muted">검사 대상: <strong>${esc(config?.url || '설정 없음')}</strong></p><div class="actions">${button('연결·읽기·쓰기 검사', 'diagnose', 'primary') }<a class="btn" href="#/login">교사 로그인</a></div><div id="diagnostic-results" class="diagnostic-results" aria-live="polite"></div></section>`);
  root.querySelector('[data-action="diagnose"]').onclick = async e => {
    const btn = e.currentTarget, output = root.querySelector('#diagnostic-results'); btn.disabled = true; output.innerHTML = '<p>검사 중…</p>';
    let first = true;
    try {
      const configured = getConfig(); if (!configured) throw Error('먼저 연결 정보를 설정하세요.');
      const repo = app.repo.mode === 'cloud' && app.repo.config.url === configured.url && app.repo.config.key === configured.key ? app.repo : new SupabaseRepository(configured);
      await runConnectionChecks(repo, result => { if (first) { output.innerHTML = ''; first = false; } output.insertAdjacentHTML('beforeend', `<div class="diagnostic-row ${esc(result.status)}"><strong>${esc({ pass: '통과', fail: '확인 필요', pending: '대기', info: '안내' }[result.status])} · ${esc(result.name)}</strong><p>${esc(result.message)}</p></div>`); });
    } catch (error) { output.textContent = error.message; } finally { btn.disabled = false; }
  };
}
export function renderLogin(root, app) {
  const config = getConfig();
  root.innerHTML = `<div class="auth-wrap"><div class="auth-intro"><span class="eyebrow">TEACHER WORKSPACE</span><h1>선생님의 다음 모험을<br>이어가세요.</h1><p>교사 계정으로 로그인하면 제작한 콘텐츠를 온라인에 저장할 수 있습니다.</p></div><section class="panel auth-card"><h2>교사 로그인</h2>${config ? `<form id="auth-form">${field('이메일', '<input type="email" name="email" autocomplete="username" placeholder="teacher@school.kr" required>')}${field('비밀번호', '<input type="password" name="password" autocomplete="current-password" required>')}<button class="btn primary wide" type="submit">로그인</button><button class="btn wide" type="submit" name="signup" value="yes">새 교사 계정 만들기</button><p class="form-message" role="status"></p></form>` : `<p>아직 온라인 저장 공간이 연결되지 않았습니다.</p>${button('Supabase 연결 설정', 'settings', 'primary wide')}`}<div class="divider">또는</div>${button('로컬 체험 계속하기', 'local', 'wide')}</section></div>`;
  root.querySelector('.auth-card h2').insertAdjacentHTML('afterend', '<p class="muted">Supabase 관리 사이트와 별개의 교사 계정입니다. 처음 사용하는 이메일은 아래에서 가입한 뒤 인증 메일을 확인하세요.</p>');
  if (config) root.querySelector('#auth-form').insertAdjacentHTML('beforeend', `<p class="muted" style="overflow-wrap:anywhere">연결 프로젝트: ${esc(new URL(config.url).hostname)}</p>`);
  root.querySelector('[data-action="local"]').onclick = () => { app.useLocal(); app.navigate('library'); };
  root.querySelector('[data-action="settings"]')?.addEventListener('click', () => app.navigate('settings'));
  root.querySelector('form')?.addEventListener('submit', async e => { e.preventDefault(); const data = new FormData(e.target), repo = new SupabaseRepository(config), msg = root.querySelector('.form-message'); const signup = e.submitter?.name === 'signup'; const buttons = [...e.target.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true); msg.textContent = '연결 중…'; try { const result = await repo[signup ? 'signUp' : 'signIn'](data.get('email'), data.get('password')); if (!result.access_token) { msg.textContent = '가입 요청을 처리했습니다. 받은 편지함과 스팸함에서 인증 메일을 확인한 뒤 로그인하세요. 이미 가입한 주소라면 기존 비밀번호로 로그인하세요.'; return; } app.useCloud(repo); await offerLocalImport(repo); app.navigate('library'); } catch (err) { msg.textContent = authErrorMessage(err); } finally { buttons.forEach(b => b.disabled = false); } });
}
