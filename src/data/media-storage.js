export const MEDIA_BUCKET='escape-media';
export const FILE_LIMITS={image:15*1024*1024,audio:20*1024*1024,video:100*1024*1024};
const types={image:['image/jpeg','image/png','image/webp','image/gif'],audio:['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/ogg','audio/webm'],video:['video/mp4','video/webm']};
export function validateFile(file,kind){if(!types[kind]?.includes(file.type))throw Error('지원하지 않는 파일 형식입니다. 이미지 JPG/PNG/WebP/GIF, 음성 MP3/M4A/WAV/OGG, 영상 MP4/WebM을 사용하세요.');if(file.size>FILE_LIMITS[kind])throw Error(`${kind==='image'?15:kind==='audio'?20:100}MB 이하 파일을 선택하세요.${kind==='video'?' YouTube 또는 외부 영상 URL 사용을 권장합니다.':''}`);return file;}
export function storagePath(url,config){try{const u=new URL(url),base=new URL(config.url);const prefix='/storage/v1/object/public/'+MEDIA_BUCKET+'/';if(u.origin!==base.origin||!u.pathname.startsWith(prefix))return null;const path=decodeURIComponent(u.pathname.slice(prefix.length));return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(images|audio|video|backgrounds)\/[0-9a-f-]{36}\.[a-z0-9]+$/i.test(path)?path:null;}catch{return null;}}
export function collectStoragePaths(value,config){const out=new Set();function visit(x){if(typeof x==='string'){const p=storagePath(x,config);if(p)out.add(p);}else if(x&&typeof x==='object')Object.values(x).forEach(visit);}visit(value);return [...out];}
export async function optimizeImage(file,mode='recommended',background=false){
 validateFile(file,'image');if(mode==='original'||file.type==='image/gif')return file;
 const bitmap=await createImageBitmap(file);try{
  const limit=mode==='high'||background?1920:1600,scale=Math.min(1,limit/Math.max(bitmap.width,bitmap.height));
  if(scale===1&&file.size<=750*1024)return file;
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  // WebP preserves alpha; no opaque fill is drawn into the canvas.
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',mode==='high'?.9:.83));if(!blob)throw Error('이미지를 최적화하지 못했습니다. 원본 유지로 다시 시도하세요.');
  return blob.size<file.size?new File([blob],file.name.replace(/\.[^.]+$/,'')+'.webp',{type:blob.type}):file;
 }finally{bitmap.close();}
}
export class MediaStorage{
 constructor(repo,{xhrFactory=()=>new XMLHttpRequest()}={}){this.repo=repo;this.xhrFactory=xhrFactory;}
 async upload(roomId,file,kind,{mode='recommended',background=false,onProgress=()=>{}}={}){
  if(this.repo.mode!=='cloud')throw Error('파일 업로드는 온라인 교사 로그인 후 사용할 수 있습니다. URL 입력은 로컬에서도 가능합니다.');
  const owner=this.repo.requireUser();validateFile(file,kind);const blob=kind==='image'?await optimizeImage(file,mode,background):file;
  if(this.repo.session?.expires_at*1000<Date.now()+60000)await this.repo.refresh();
  const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','audio/mpeg':'mp3','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','audio/webm':'webm','video/mp4':'mp4','video/webm':'webm'})[blob.type];
  const path=`${owner}/${roomId}/${background?'backgrounds':kind==='image'?'images':kind}/${crypto.randomUUID()}.${ext}`;
  try{await new Promise((resolve,reject)=>{const xhr=this.xhrFactory();xhr.open('POST',this.repo.config.url+'/storage/v1/object/'+MEDIA_BUCKET+'/'+path);xhr.setRequestHeader('apikey',this.repo.config.key);xhr.setRequestHeader('Authorization','Bearer '+this.repo.session.access_token);xhr.setRequestHeader('Content-Type',blob.type);xhr.setRequestHeader('x-upsert','false');xhr.setRequestHeader('cache-control','3600');xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(Error('파일 업로드 실패: '+(xhr.status===413?'프로젝트 Storage의 업로드 용량 제한도 확인하세요.':xhr.responseText||xhr.status)));xhr.onerror=()=>reject(Error('파일 업로드 중 연결이 끊겼습니다. 다시 시도하세요.'));xhr.ontimeout=()=>reject(Error('파일 업로드 시간이 초과되었습니다.'));xhr.timeout=180000;xhr.send(blob);});}
  catch(error){await this.removeUnused([path]).catch(()=>{});throw error;}
  onProgress(100);return {url:this.repo.config.url+'/storage/v1/object/public/'+MEDIA_BUCKET+'/'+path,path,name:file.name,size:blob.size,originalSize:file.size,type:kind,mime:blob.type};
 }
 async removeUnused(paths){
  if(this.repo.mode!=='cloud'||!paths.length)return [];
  const unused=await this.repo.request('/rest/v1/rpc/escape_unused_media',{method:'POST',body:{p_paths:[...new Set(paths)]}});
  if(unused.length)await this.repo.request('/storage/v1/object/'+MEDIA_BUCKET,{method:'DELETE',body:{prefixes:unused}});
  return unused;
 }
 async commit(asset,save,verify){
  try{await save();return asset;}catch(error){
   // A lost save response may still have committed. Never delete until a read confirms no reference.
   try{if(await verify(asset.url))return asset;await this.removeUnused([asset.path]);}catch{throw Error(error.message+' 업로드 파일은 안전을 위해 보존했습니다. 저장 상태를 확인하고 다시 시도하세요.');}
   throw error;
  }
 }
}
