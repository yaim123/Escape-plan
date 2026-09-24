import { newRoom } from '../core/model.js';
import { esc } from './dom.js';
const key = 'escape-studio:rls-fixture';
export async function renderRlsCheck(root, app) {
  if (app.repo.mode !== 'cloud') { root.innerHTML = '<h1>교사 로그인이 필요합니다</h1><a class="btn" href="#/login">교사 로그인</a>'; return; }
  root.innerHTML = `<section class="panel"><h1>두 교사 RLS 검증</h1><p>A 계정에서 검사 데이터를 만든 뒤, 별도 탭의 B 계정에서 접근 차단을 검사합니다. 마지막으로 A가 원본 보존을 확인하고 검사 데이터를 정리합니다.</p><div class="actions"><button class="btn" data-check="create">A: 검사 데이터 생성</button><button class="btn" data-check="verify">B: 조회·수정·삭제 차단 검사</button><button class="btn" data-check="cleanup">A: 원본 확인 및 정리</button></div><div id="rls-result" role="status"></div></section>`;
  root.onclick = async e => {
    const btn = e.target.closest('[data-check]'); if (!btn) return;
    btn.disabled = true; const out = root.querySelector('#rls-result');
    const report = t => out.insertAdjacentHTML('beforeend', `<p>${esc(t)}</p>`);
    try {
      const user = await app.repo.getUser();
      let fixture = JSON.parse(localStorage.getItem(key) || 'null');
      if (btn.dataset.check === 'create') {
        if (fixture) throw Error('기존 검사 데이터부터 정리하세요.');
        const room = newRoom('RLS 두 교사 검사 전용');
        fixture = { id: room.id, owner: user.id, project: app.repo.config.url, document: room };
        localStorage.setItem(key, JSON.stringify(fixture));
        await app.repo.save(room); report('A 생성 완료. B 계정 탭에서 차단 검사를 실행하세요.');
      } else {
        if (!fixture || fixture.project !== app.repo.config.url) throw Error('이 프로젝트의 A 검사 데이터가 없습니다.');
        const path = `/rest/v1/escape_contents?id=eq.${fixture.id}`;
        if (btn.dataset.check === 'verify') {
          if (fixture.owner === user.id) throw Error('현재 계정은 A입니다. 다른 B 계정으로 로그인하세요.');
          for (const [name, options] of [['조회', {}], ['수정', { method: 'PATCH', body: { title: 'UNEXPECTED B WRITE' }, headers: { Prefer: 'return=representation' } }], ['삭제', { method: 'DELETE', headers: { Prefer: 'return=representation' } }]]) {
            const rows = await app.repo.request(path, options);
            if (!Array.isArray(rows) || rows.length) throw Error(`${name} 차단 실패: 다른 교사의 데이터에 접근할 수 있습니다.`);
            report(`${name} 차단 통과: 반환 및 영향 행 0건`);
          }
          fixture.verified = true; localStorage.setItem(key, JSON.stringify(fixture));
        } else {
          if (fixture.owner !== user.id) throw Error('검사 데이터를 만든 A 계정으로 돌아오세요.');
          const row = await app.repo.get(fixture.id);
          if (row && (row.title !== fixture.document.title || JSON.stringify(row.document) !== JSON.stringify(fixture.document))) {
            // JSONB key ordering is not significant; compare structurally below.
            if (row.title !== fixture.document.title || canonical(row.document) !== canonical(fixture.document)) throw Error('원본 변경 감지: 정리 전에 RLS 문제를 확인하세요.');
          }
          if (!row && fixture.verified) throw Error('A 원본이 사라졌습니다. RLS 검증 실패입니다.');
          if (row) await app.repo.remove(fixture.id);
          if (await app.repo.get(fixture.id)) throw Error('검사 데이터 삭제 확인 실패');
          localStorage.removeItem(key); report(`${fixture.verified ? 'A 원본 보존 확인, 두 계정 검사 완료.' : 'B 검증 미완료.'} 검사 데이터 정리 완료.`);
        }
      }
    } catch (error) { report(error.message); } finally { btn.disabled = false; }
  };
}
function canonical(value) { return JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v); }
