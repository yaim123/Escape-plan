import {safeUrl} from '../core/model.js';
import {esc} from './dom.js';
export function contrastInk(color){
 const hex=/^#[a-f0-9]{6}$/i.test(color||'')?color:'#0c766d';
 const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
 const l=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];return (l+.05)/.05>=1.05/(l+.05)?'#111111':'#ffffff';
}
export function displayAttributes(b,theme={}){
 const mode=b.display==='full'?'theme':['card','theme','image'].includes(b.display)?b.display:'card';
 const color=/^#[a-f0-9]{6}$/i.test(theme.color||'')?theme.color:'#0c766d';
 const url=safeUrl(b.backgroundUrl).replace(/["'\\<>\r\n]/g,c=>'%'+c.charCodeAt(0).toString(16));
 return `class="display-surface display-${mode}" style="--display-color:${color};--display-ink:${contrastInk(color)};--display-image:url('${esc(url)}')"`;
}
