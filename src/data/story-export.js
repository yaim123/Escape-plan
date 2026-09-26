import {storyExportFilename} from '../core/story-export.js';

export function storyTextFile(title,text){
 // UTF-8 BOM also makes Korean readable in older Windows text editors.
 return {filename:storyExportFilename(title),blob:new Blob(['\ufeff',text],{type:'text/plain;charset=utf-8'})};
}
export function downloadStoryText(title,text){
 const {filename,blob}=storyTextFile(title,text),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
export async function copyStoryText(preview){
 try{await navigator.clipboard.writeText(preview.value);return;}catch{/* Permission denied or unsupported: use the selectable preview. */}
 preview.focus();preview.select();
 try{if(document.execCommand('copy'))return;}catch{/* Keep selection for manual copy. */}
 throw Error('자동 복사가 차단되었습니다. 선택된 텍스트를 Ctrl+C 또는 기기의 복사 메뉴로 복사하세요.');
}
