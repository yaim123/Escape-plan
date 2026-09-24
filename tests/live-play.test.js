import test from 'node:test';
import assert from 'node:assert/strict';
import { LivePlayClient } from '../src/data/play.js';
import { liveAnswerControls } from '../src/ui/live-play.js';
test('network retry reuses a submission ID and does not persist the answer',async()=>{
  const calls=[]; let fail=true;
  const lobby={saved:()=>({token:'token'}),rpc:async(name,body,teacher)=>{calls.push({name,body,teacher});if(fail){fail=false;throw Object.assign(Error('offline'),{status:0});}return{outcome:'wrong'};}};
  const client=new LivePlayClient(lobby);
  await assert.rejects(client.submit('123456','block','wrong'));
  await client.submit('123456','block','wrong');
  assert.equal(calls[0].body.p_request,calls[1].body.p_request);assert.equal(client.pending,null);
  await client.submit('123456','block','wrong');assert.notEqual(calls[1].body.p_request,calls[2].body.p_request);
  assert.ok(calls.every(c=>!c.teacher));
});
test('matching UI uses projected candidates, never a raw answer mapping',()=>{
  const html=liveAnswerControls({type:'question',questionType:'match',options:['왼쪽'],matchChoices:['후보1','후보2'],answers:['SECRET_MAPPING']});
  assert.ok(html.includes('후보1'));assert.ok(!html.includes('SECRET_MAPPING'));
  assert.ok(!liveAnswerControls({type:'question',questionType:'approval'}).includes('type="submit"'));
});
