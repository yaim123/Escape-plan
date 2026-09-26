// Failed external assets must never prevent answering or advancing.
export function mountAssetFallback(root){
 for(const el of root.querySelectorAll('img[data-media],video[data-media],audio[data-media]')){
  const fail=()=>{el.hidden=true;};el.onerror=fail;if(el.tagName==='IMG'&&el.complete&&!el.naturalWidth)fail();
 }
 for(const surface of root.querySelectorAll('.display-image')){
  const raw=surface.style.getPropertyValue('--display-image'),match=raw.match(/^url\(['"]?(.*?)['"]?\)$/);if(!match?.[1])continue;
  const img=new Image();img.onerror=()=>{surface.classList.replace('display-image','display-theme');surface.style.removeProperty('--display-image');};img.src=match[1];
 }
}
