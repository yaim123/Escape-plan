import {esc} from './dom.js';
export function progressMeter(value){const percent=Math.max(0,Math.min(100,Math.round(Number(value)||0)));return `<span class="compact-progress" aria-label="진행률 ${percent}%"><progress max="100" value="${percent}"></progress><small>${esc(percent)}%</small></span>`;}
