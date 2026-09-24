// Submission answers exist only in the current request/in-memory retry. Never persist them.
export class LivePlayClient {
  constructor(lobby) { this.lobby=lobby; this.pending=null; }
  token(code) { const token=this.lobby.saved(code)?.token; if(!token) throw Error('참가 기록이 없습니다.'); return token; }
  read(code) { return this.lobby.rpc('escape_student_play',{p_token:this.token(code),p_action:'read'}); }
  select(code,block) { return this.lobby.rpc('escape_student_play',{p_token:this.token(code),p_action:'select',p_block:block}); }
  async hint(code,block) {
    if(this.hintPending?.block!==block) this.hintPending={block,request:crypto.randomUUID()};
    try{const result=await this.lobby.rpc('escape_student_play',{p_token:this.token(code),p_action:'hint',p_block:block,p_request:this.hintPending.request});this.hintPending=null;return result;}
    catch(error){if(error.status)this.hintPending=null;throw error;}
  }
  async finish(session,action='finish',keep=true) {
    const key=JSON.stringify([session,action,keep]);
    if(this.finishPending?.key!==key)this.finishPending={key,request:crypto.randomUUID()};
    try{const result=await this.lobby.rpc('escape_finish_reset',{p_session:session,p_action:action,p_keep:keep,p_request:this.finishPending.request,p_confirm:true},true);this.finishPending=null;return result;}
    catch(error){if(error.status)this.finishPending=null;throw error;}
  }
  async submit(code,block,input) {
    if(!this.pending || this.pending.code!==code || this.pending.block!==block || JSON.stringify(this.pending.input)!==JSON.stringify(input)) {
      this.pending={code,block,input,request:crypto.randomUUID()};
    }
    const request=this.pending;
    try {
      const result=await this.lobby.rpc('escape_student_play',{p_token:this.token(code),p_action:'submit',p_block:block,p_input:input,p_request:request.request});
      if(this.pending===request) this.pending=null;
      return result;
    } catch(error) { if(error.status && this.pending===request) this.pending=null; throw error; }
  }
  teacher(session,action='read',participant=null,block=null) {
    return this.lobby.rpc('escape_teacher_progress',{p_session:session,p_action:action,p_participant:participant,p_block:block},true);
  }
  async control(session, action, target, revision) {
    const body={p_session:session,p_action:action,...target,p_revision:revision};
    const key=JSON.stringify(body);
    if(this.controlPending?.key!==key) this.controlPending={key,body:{...body,p_request:crypto.randomUUID()}};
    try { const result=await this.lobby.rpc('escape_teacher_control',this.controlPending.body,true);this.controlPending=null;return result; }
    catch(error){if(error.status)this.controlPending=null;throw error;}
  }
  dispose() { this.pending=null; this.controlPending=null; this.hintPending=null; this.finishPending=null; }
}
