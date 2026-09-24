import { newRoom, uid } from '../core/model.js';

const tables = ['escape_contents', 'escape_sessions', 'escape_participants', 'escape_events'];
export const isPermissionDenied = error => [401, 403].includes(error.status) && error.code === '42501';
const details = error => `${error.message}${error.status ? ` · HTTP ${error.status}` : ''}${error.code ? ` / ${error.code}` : ''}`;

// Only this run's generated IDs are mutated. Never change RLS or live-session data.
export async function runConnectionChecks(repo, onResult = () => {}) {
  const results = [];
  const add = (name, status, message) => { const result = { name, status, message }; results.push(result); onResult(result); };
  try {
    await repo.request('/auth/v1/settings', { auth: false });
    add('프로젝트 연결', 'pass', 'Project URL과 공개키로 Auth 서비스에 연결했습니다.');
  } catch (error) { add('프로젝트 연결', 'fail', details(error)); return results; }
  for (const table of tables) {
    try {
      await repo.request(`/rest/v1/${table}?select=id&limit=1`, { auth: false });
      add(`${table} 익명 조회`, 'fail', '예상과 달리 조회가 허용되었습니다. 준비된 SQL의 익명 접근 금지 설정을 확인하세요.');
    } catch (error) {
      add(`${table} 익명 조회`, isPermissionDenied(error) ? 'pass' : 'fail', isPermissionDenied(error) ? `의도한 접근 차단 · HTTP ${error.status} / 42501` : details(error));
    }
  }
  if (!repo.session) { add('교사 읽기·쓰기', 'pending', '교사 로그인 후 다시 실행하세요. 공개키만으로는 교사 데이터를 저장할 수 없습니다.'); return results; }
  let owner;
  try {
    owner = (await repo.getUser()).id;
    if (!owner || owner !== repo.requireUser()) throw Error('로그인 사용자 정보를 확인할 수 없습니다.');
    add('교사 인증', 'pass', '서버에서 로그인한 사용자를 확인했습니다.');
  } catch (error) { add('교사 인증', 'fail', details(error)); return results; }

  const cleanup = new Map();
  const row = room => ({ id: room.id, owner_id: owner, room_code: room.roomCode, title: room.title, document: room });
  try {
    const room = newRoom(`연결 확인 · ${new Date().toISOString()}`);
    cleanup.set(room.id, 'own');
    await repo.save(room);
    add('교사 콘텐츠 쓰기', 'pass', '테스트용 콘텐츠 한 건을 저장했습니다.');
    let saved = await repo.get(room.id);
    if (!saved || saved.owner_id !== owner || saved.title !== room.title || saved.document.title !== room.title) throw Error('저장한 콘텐츠가 예상과 다릅니다.');
    add('교사 콘텐츠 읽기', 'pass', '저장한 제목·원본 문서·소유자가 일치합니다.');
    room.title += ' · 수정';
    await repo.save(room);
    saved = await repo.get(room.id);
    if (!saved || saved.title !== room.title || saved.document.title !== room.title || saved.room_code !== room.roomCode) throw Error('콘텐츠 수정 또는 고정 방 코드 확인에 실패했습니다.');
    add('교사 콘텐츠 수정', 'pass', '수정한 내용이 반영되고 방 코드가 유지됩니다.');

    const anonymous = newRoom('익명 쓰기 차단 테스트');
    cleanup.set(anonymous.id, 'probe');
    try {
      await repo.request('/rest/v1/escape_contents', { method: 'POST', auth: false, body: row(anonymous) });
      add('익명 쓰기 차단', 'fail', '비로그인 저장이 허용되었습니다. 권한 설정 확인이 필요합니다.');
    } catch (error) {
      if (isPermissionDenied(error)) cleanup.delete(anonymous.id);
      add('익명 쓰기 차단', isPermissionDenied(error) ? 'pass' : 'fail', isPermissionDenied(error) ? '비로그인 상태의 저장 요청이 42501로 차단됩니다.' : details(error));
    }
    const forged = newRoom('다른 소유자 쓰기 차단 테스트');
    cleanup.set(forged.id, 'probe');
    try {
      await repo.request('/rest/v1/escape_contents', { method: 'POST', body: { ...row(forged), owner_id: uid() } });
      add('소유자 RLS 검사', 'fail', '다른 소유자를 지정한 저장이 허용되었습니다. RLS 설정 확인이 필요합니다.');
    } catch (error) {
      if (isPermissionDenied(error)) cleanup.delete(forged.id);
      add('소유자 RLS 검사', isPermissionDenied(error) ? 'pass' : 'fail', isPermissionDenied(error) ? '로그인 사용자와 다른 owner_id를 지정한 저장이 42501로 차단됩니다.' : details(error));
    }
    for (const table of tables.slice(1)) {
      try { await repo.request(`/rest/v1/${table}?select=id&limit=1`); add(`${table} 교사 직접 조회`, 'fail', '후속 개발용 테이블이 앱에 열려 있습니다. 현재 SQL의 접근 차단 설정을 확인하세요.'); }
      catch (error) { add(`${table} 교사 직접 조회`, isPermissionDenied(error) ? 'pass' : 'fail', isPermissionDenied(error) ? '후속 개발용 테이블의 앱 직접 접근이 의도대로 차단됩니다.' : details(error)); }
    }
  } catch (error) { add('교사 읽기·쓰기 검사', 'fail', details(error)); }
  finally {
    for (const [id, kind] of cleanup) {
      try {
        const removed = await repo.request(`/rest/v1/escape_contents?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
        if (!Array.isArray(removed) || removed.length !== 1 || removed[0].id !== id) throw Error('테스트 행 삭제 여부를 확인하지 못했습니다.');
        if (await repo.get(id)) throw Error('삭제 후에도 테스트 행이 조회됩니다.');
        add(kind === 'own' ? '테스트 콘텐츠 삭제' : '검사 중 생성된 행 정리', 'pass', '이번 검사에서 만든 행만 삭제하고 재조회로 확인했습니다.');
      } catch (error) { add('테스트 데이터 정리 확인 필요', 'fail', `${details(error)} · 확인할 테스트 ID: ${id}`); }
    }
  }
  add('검사 범위', 'info', '익명 차단과 소유자 위조 쓰기를 검사했습니다. 두 교사 계정 사이의 조회·수정·삭제 격리는 별도 검증이 필요합니다.');
  return results;
}
