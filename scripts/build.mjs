import { mkdir, cp } from 'node:fs/promises';
import { SUPABASE_CONFIG } from '../src/config.js';
import { validateConfig } from '../src/data/config.js';
// Fail before publishing if the configured browser key is privileged or malformed.
validateConfig(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
await mkdir('dist', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('src', 'dist/src', { recursive: true });
console.log('GitHub Pages용 정적 파일 생성 완료: dist/');
