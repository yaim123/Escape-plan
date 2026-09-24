import { validateRoom } from '../core/model.js';
const KEY = 'escape-studio:rooms:v1';
export class LocalRepository {
  constructor(storage = globalThis.localStorage) { this.storage = storage; this.mode = 'local'; }
  async list() {
    const raw = this.storage.getItem(KEY);
    if (!raw) return [];
    let rooms;
    try { rooms = JSON.parse(raw); } catch { throw Error('저장 데이터를 읽을 수 없습니다. 브라우저 데이터를 지우지 말고 JSON 백업을 확인하세요.'); }
    if (!Array.isArray(rooms)) throw Error('저장 데이터 형식이 올바르지 않습니다.');
    return rooms.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async save(room) {
    const errors = validateRoom(room); if (errors.length) throw Error(errors[0]);
    const rooms = await this.list(), index = rooms.findIndex(r => r.id === room.id);
    const saved = structuredClone({ ...room, updatedAt: new Date().toISOString() });
    if (index < 0) rooms.push(saved); else rooms[index] = saved;
    try { this.storage.setItem(KEY, JSON.stringify(rooms)); } catch { throw Error('저장 공간이 부족하거나 브라우저가 저장을 차단했습니다. JSON으로 백업하세요.'); }
    return saved;
  }
  async remove(id) { this.storage.setItem(KEY, JSON.stringify((await this.list()).filter(r => r.id !== id))); }
}
export function exportRoom(room) {
  const blob = new Blob([JSON.stringify(room, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `${room.title.replace(/[<>:"/\\|?*]/g, '_')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
