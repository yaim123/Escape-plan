import test from 'node:test';
import assert from 'node:assert/strict';
import { LivePlayClient } from '../src/data/play.js';
import { controlPanel,elapsedLabel,auditHtml } from '../src/ui/teacher-controls.js';
test('teacher control network retry keeps request ID and ownership auth',async()=>{
  const calls=[];let fail=true;
  const client=new LivePlayClient({rpc:async(name,body,auth)=>{calls.push({name,body,auth});if(fail){fail=false;throw Error('network');}return {revision:2};}});
  await assert.rejects(client.control('session','pause',{p_scope:'session'},1));
  await client.control('session','pause',{p_scope:'session'},1);
  assert.equal(calls[0].body.p_request,calls[1].body.p_request);assert.equal(calls[1].auth,true);
  await client.control('session','resume',{p_scope:'session'},2);assert.notEqual(calls[1].body.p_request,calls[2].body.p_request);
});
test('management panel shows explicit scope and escapes student/audit text',()=>{
  const game={participants:[{id:'one',name:'<학생>'}],playMode:'individual',contents:[{id:'block',title:'<문제>',stage:'1'}],teamCount:1};
  const html=controlPanel(game,{scope:'student',participant:'one'});
  assert.ok(html.includes('해당 학생만'));assert.ok(html.includes('&lt;학생&gt;'));assert.ok(!html.includes('value="team"'));
  assert.ok(auditHtml([{created_at:'2026-09-24',action:'complete',scope:'student',details:{targets:[{name:'<img>'}]}}]).includes('&lt;img&gt;'));
  assert.equal(elapsedLabel(61000),'1분 1초');
});
