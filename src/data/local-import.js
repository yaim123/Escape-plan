import {LocalRepository} from './storage.js';
const key=repo=>`escape-studio:imported:${repo.config.url}:${repo.requireUser()}`;
export async function pendingLocalDrafts(repo,storage=globalThis.localStorage){
  let imported=[];try{imported=JSON.parse(storage.getItem(key(repo))||'[]');}catch{/* retain originals */}
  return (await new LocalRepository(storage).list()).filter(r=>!imported.includes(r.id));
}
export async function importLocalDrafts(repo,rooms,storage=globalThis.localStorage){
  const result={imported:[],failed:[]};let ids=[];try{ids=JSON.parse(storage.getItem(key(repo))||'[]');}catch{}
  for(const room of rooms){try{
    await repo.importDraft(room); // INSERT + authenticated read-back; never overwrite server content.
    if(!ids.includes(room.id))ids.push(room.id);
    storage.setItem(key(repo),JSON.stringify(ids));result.imported.push(room.id);
  }catch(error){result.failed.push({id:room.id,title:room.title,message:error.message});}}
  // Local originals remain available as a backup, even after confirmed import.
  return result;
}
