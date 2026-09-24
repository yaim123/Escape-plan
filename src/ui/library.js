import { esc, icon, button, formatDate, modal, toast, confirmDialog } from './dom.js';
import { newRoom, duplicateRoom, parseImport } from '../core/model.js';
import { exportRoom } from '../data/storage.js';
import { exampleRoom } from '../data/examples.js';
export async function renderLibrary(root, app) {
  const rooms = await app.repo.list();
  root.innerHTML = `<div class="page-heading"><div><div class="eyebrow">MY WORKSPACE</div><h1>내 방탈출</h1><p>작은 단서에서 시작되는, 우리 반만의 이야기</p></div><div class="actions">${button('JSON 불러오기', 'import', '', 'upload')}${button('새 방탈출 만들기', 'create', 'primary', 'plus')}</div></div>
    <section class="studio-banner"><div class="banner-mark">${icon('key')}</div><div><span class="eyebrow">상상하고, 연결하고, 탈출하다</span><h2>오늘의 수업을 하나의 모험으로.</h2><p>이야기와 문제를 이어 붙여 나만의 방탈출을 만들어보세요.</p></div>${button('예제 살펴보기', 'example', 'light', 'arrow')}</section>
    <div class="library-toolbar"><div class="filter-tabs" role="group" aria-label="콘텐츠 필터"><button class="active" data-filter="all">전체 <span>${rooms.length}</span></button><button data-filter="individual">개인전</button><button data-filter="team">팀전</button></div><label class="search">${icon('search')}<input id="search-rooms" placeholder="방탈출 검색" aria-label="방탈출 검색"></label></div>
    <div id="room-grid" class="room-grid"></div>
    <div class="library-foot">${icon('guide')}<p>${app.repo.mode === 'local' ? '로컬 체험 공간입니다. 이 브라우저에 저장되며, JSON 내보내기로 소중한 콘텐츠를 백업할 수 있어요.' : '교사 계정의 개인 작업 공간입니다. 콘텐츠는 Supabase에 저장됩니다.'}</p></div>`;
  let filter = 'all', query = '';
  const draw = () => {
    const shown = rooms.filter(r => (filter === 'all' || r.playMode === filter) && `${r.title} ${r.description} ${r.subject}`.toLowerCase().includes(query.toLowerCase()));
    root.querySelector('#room-grid').innerHTML = shown.map((r, i) => `<article class="room-card" data-id="${r.id}"><button class="room-cover color-${i % 4}" data-action="edit" aria-label="${esc(r.title)} 편집"><div class="cover-top"><span class="tag">${esc(r.subject)}</span><span class="cover-mode">${icon(r.playMode === 'team' ? 'users' : 'key')}${r.playMode === 'team' ? '팀전' : '개인전'}</span></div><div class="cover-main"><span class="cover-label">ESCAPE ROOM</span><h2>${esc(r.title)}</h2></div><div class="cover-bottom"><span>${r.content.length}개의 단서</span><span class="cover-arrow">${icon('arrow')}</span></div></button><div class="room-card-body"><h3>${esc(r.title)}</h3><p>${esc(r.description || '새로운 이야기를 채워주세요.')}</p><div class="room-meta"><span>${icon('clock')}${formatDate(r.updatedAt)} 수정</span><span>코드 ${esc(r.roomCode)}</span></div><div class="card-actions">${button('편집하기', 'edit', 'subtle', 'file')}${button('테스트', 'test', '', 'play')}${app.repo.mode === 'cloud' ? button('대기실', 'lobby', '', 'users') + button('수업 기록', 'history', '', 'file') : ''}<details class="dropdown"><summary aria-label="콘텐츠 메뉴">···</summary><div>${button('복제', 'duplicate', '', 'copy')}${button('JSON 내보내기', 'export', '', 'download')}${button('삭제', 'delete', 'danger-text', 'trash')}</div></details></div></div></article>`).join('') + ((!query && filter === 'all') ? `<button class="new-room-card" data-action="create"><span>${icon('plus')}</span><strong>새로운 방탈출 만들기</strong><p>다음 모험은 어떤 이야기인가요?</p></button>` : '');
    if (!shown.length && (query || filter !== 'all')) root.querySelector('#room-grid').innerHTML = '<div class="empty"><h3>아직 일치하는 방탈출이 없어요</h3><p>다른 검색어나 플레이 방식을 선택해주세요.</p></div>';
  };
  draw();
  root.querySelector('#search-rooms').oninput = e => { query = e.target.value; draw(); };
  root.querySelectorAll('[data-filter]').forEach(el => el.onclick = () => { filter = el.dataset.filter; root.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === el)); draw(); });
  root.onclick = async e => {
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    const room = rooms.find(r => r.id === btn.closest('[data-id]')?.dataset.id);
    try {
      switch (btn.dataset.action) {
        case 'create': modal(`<form class="modal-body" id="create-form"><span class="eyebrow">NEW ESCAPE ROOM</span><h2>새로운 이야기의 시작</h2><label class="field"><span>방탈출 이름</span><input name="title" placeholder="예: 자정의 도서관" required maxlength="200" autofocus></label><label class="field"><span>플레이 방식</span><select name="mode"><option value="individual">개인전</option><option value="team">팀전</option></select></label><p class="muted">이름과 설정은 나중에 자유롭게 바꿀 수 있어요.</p><div class="actions end"><button class="btn primary" type="submit">만들기 ${icon('arrow')}</button></div></form>`, d => d.querySelector('form').onsubmit = async event => { event.preventDefault(); const data = new FormData(event.target); const r = newRoom(data.get('title').trim()); r.playMode = data.get('mode'); try { await app.repo.save(r); d.close(); app.navigate(`editor/${r.id}`); } catch (err) { toast(err.message, true); } }); break;
        case 'example': { const r = exampleRoom(); await app.repo.save(r); app.navigate(`editor/${r.id}`); break; }
        case 'edit': app.navigate(`editor/${room.id}`); break;
        case 'history': app.navigate('history/' + room.id); break;
        case 'lobby': app.navigate('lobby/' + room.id); break;
        case 'test': app.navigate(`test/${room.id}`); break;
        case 'duplicate': { await app.repo.save(duplicateRoom(room)); toast('방탈출을 복제했습니다. 새로운 방 코드가 발급되었어요.'); await renderLibrary(root, app); break; }
        case 'export': exportRoom(room); toast('JSON 백업을 내보냈습니다.'); break;
        case 'delete': if (await confirmDialog('방탈출을 삭제할까요?', `“${room.title}” 콘텐츠가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`)) { await app.repo.remove(room.id); toast('방탈출을 삭제했습니다.'); await renderLibrary(root, app); } break;
        case 'import': { const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.onchange = async () => { try { const f = input.files[0]; if (!f) return; if (f.size > 2_000_000) throw Error('JSON 파일은 2MB 이하여야 합니다.'); const r = parseImport(await f.text()); r.title = r.title.replace(/ \(복사\)$/, ''); await app.repo.save(r); toast('새로운 콘텐츠로 불러왔습니다.'); await renderLibrary(root, app); } catch (err) { toast(err.message, true); } }; input.click(); break; }
      }
    } catch (err) { toast(err.message, true); }
  };
}
