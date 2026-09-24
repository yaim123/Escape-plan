import { safeUrl } from '../core/model.js';
import { esc } from './dom.js';
export function mediaHtml(media = []) {
  return media.map(m => {
    const url = safeUrl(m.url); if (!url) return '';
    if (m.type === 'image') return `<img class="block-image" src="${esc(url)}" alt="${esc(m.alt || '문제 자료')}" loading="lazy" referrerpolicy="no-referrer">`;
    if (m.type === 'audio') return `<audio controls preload="none" src="${esc(url)}"></audio>`;
    const u = new URL(url); let videoId;
    if (['www.youtube.com', 'youtube.com'].includes(u.hostname)) videoId = u.searchParams.get('v');
    if (u.hostname === 'youtu.be') videoId = u.pathname.slice(1);
    if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) return `<iframe title="문제 영상" src="https://www.youtube-nocookie.com/embed/${esc(videoId)}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    return `<video controls preload="none" src="${esc(url)}"></video>`;
  }).join('');
}
