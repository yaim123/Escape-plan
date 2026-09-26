import test from 'node:test';
import assert from 'node:assert/strict';
import {qrRasterLayout,qrFilename} from '../src/core/qr-download.js';
import {qrSuccessDetail} from '../src/core/qr-feedback.js';
import {GRADES,classification,matchesRoom} from '../src/core/classification.js';
import {newRoom,normalizeRoom} from '../src/core/model.js';

test('PNG module grid is >=800px, square and integer-aligned with a four-module quiet zone',()=>{
 for(let modules=21;modules<=177;modules+=4){const p=qrRasterLayout(modules);assert.ok(p.size>=800);assert.equal(p.margin,4*p.cellSize);assert.equal(p.size,modules*p.cellSize+2*p.margin);assert.equal(p.size%p.cellSize,0);}
 assert.throws(()=>qrRasterLayout(0));
});
test('QR filenames retain Korean names and remove Windows-invalid characters',()=>{
 assert.equal(qrFilename(' 과학실:문?*<>/\\|". '),'과학실문_QR.png');
 assert.equal(qrFilename('CON','svg'),'CON_QR.svg');assert.equal(qrFilename('...'),'QR_QR.png');
 assert.ok(qrFilename('가'.repeat(200)).length<=107);assert.equal(qrFilename('공유\u0000\nQR'),'공유QR_QR.png');
});
test('high-school grades persist and filter exactly while legacy rooms remain unclassified',()=>{
 assert.deepEqual(GRADES,['중1','중2','중3','고1','고2','고3','공통','기타']);
 for(const grade of GRADES){const r=newRoom();r.metadata={grade};const saved=normalizeRoom(JSON.parse(JSON.stringify(r)));assert.equal(classification(saved).grade,grade);for(const g of GRADES)assert.equal(matchesRoom(saved,{grade:g}),g===grade);}
 const old=newRoom();delete old.metadata;assert.equal(classification(normalizeRoom(old)).grade,'');assert.equal(matchesRoom(old),true);assert.equal(matchesRoom(old,{grade:'기타'}),false);
});
test('scan feedback uses receipt recognized/required counts and never guesses missing progress',()=>{
 for(const mode of ['ALL','N_OF_M','UNIQUE_MEMBER'])assert.equal(qrSuccessDetail({mode,found:2,required:4,total:9}),'현재 2 / 4개 발견');
 assert.equal(qrSuccessDetail({mode:'ANY',found:1,required:1}),'');
 assert.equal(qrSuccessDetail({mode:'N_OF_M',found:2,total:4}),'');assert.equal(qrSuccessDetail(null),'');
});
