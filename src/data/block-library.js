import {parseTags} from '../core/classification.js';
import {MediaStorage,collectStoragePaths} from './media-storage.js';
const KEY='escape-studio:block-library:local:v1';
export class BlockLibrary{
 constructor(repo){this.repo=repo;}
 async list(){if(this.repo.mode==='cloud'){this.repo.requireUser();return this.repo.request('/rest/v1/escape_block_library?select=*&order=created_at.desc,id.asc');}return JSON.parse(this.repo.storage.getItem(KEY)||'[]');}
 async save(payload,tags=[]){const entry={id:crypto.randomUUID(),title:payload.block.title,type:payload.block.type,tags:parseTags(tags),payload:structuredClone(payload)};
  if(this.repo.mode==='cloud')return (await this.repo.request('/rest/v1/escape_block_library',{method:'POST',headers:{Prefer:'return=representation'},body:{...entry,owner_id:this.repo.requireUser()}}))[0];
  entry.created_at=new Date().toISOString();this.repo.storage.setItem(KEY,JSON.stringify([entry,...await this.list()]));return entry;
 }
 async remove(entry){if(this.repo.mode==='cloud'){this.repo.requireUser();await this.repo.request('/rest/v1/escape_block_library?id=eq.'+encodeURIComponent(entry.id),{method:'DELETE'});let cleanupFailed=false;await new MediaStorage(this.repo).removeUnused(collectStoragePaths(entry.payload,this.repo.config)).catch(()=>{cleanupFailed=true;});return {cleanupFailed};}else this.repo.storage.setItem(KEY,JSON.stringify((await this.list()).filter(e=>e.id!==entry.id)));}
}
