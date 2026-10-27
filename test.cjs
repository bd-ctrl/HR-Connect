const assert=require('node:assert/strict'),L=(()=>{const m={exports:{}};new Function('module','exports',require('node:fs').readFileSync('./public/logic.js','utf8'))(m,m.exports);return m.exports})();let checks=0;
function ok(v){assert.ok(v);checks++}function eq(a,b){assert.deepEqual(a,b);checks++}
const base={target:'non',context:'',collaborated:true,scores:[4,4,5],reasons:['','','']};
eq(L.validate(base,'open',[]),[]); // context is optional
for(let dim=0;dim<3;dim++)for(let score=1;score<=5;score++){
 const f={...base,scores:[4,4,4],reasons:['','','']};f.scores[dim]=score;
 eq(L.validate(f,'open',[]).length,score<=3?1:0);f.reasons[dim]='ตัวอย่างสถานการณ์';eq(L.validate(f,'open',[]).length,0);
}
ok(L.validate({...base,scores:[null,4,5]},'open',[]).length);ok(L.validate({...base,scores:[4,4]},'open',[]).length);ok(L.validate({...base,scores:[0,4,5]},'open',[]).length);ok(L.validate({...base,scores:[6,4,5]},'open',[]).length);
ok(L.validate({...base,target:'me'},'open',[]).length);ok(L.validate({...base,target:'win'},'open',[]).length);ok(L.validate({...base,collaborated:false},'open',[]).length);ok(L.validate(base,'review',[]).length);ok(L.validate(base,'released',[]).length);
ok(L.validate(base,'open',[{target:'non',rater:'me',round:'2026-10'}]).length);eq(L.validate(base,'open',[{target:'non',rater:'me',round:'2026-09'}]),[]);
function row(n,scores=[4,4,4],opts={}){return {id:'r'+n,rater:'a'+n,target:'non',round:'2026-10',status:'submitted',scores,decisions:scores.map(s=>s<=3?'pending':'auto'),...opts}}
let rows=[row(0,[3,4,4]),row(1),row(2)];
eq(L.pending(rows).length,1);eq(L.pending(rows.slice(0,2)).length,0);eq(L.eligibleRows(rows.slice(0,2)),[]);eq(L.eligibleRows(rows).length,3);eq(L.canRelease(rows),false);
eq(L.aggregate(rows).dims[0].mean,null);rows[0].decisions[0]='approved';eq(L.canRelease(rows),true);eq(L.aggregate(rows).dims[0].mean,11/3);
rows[0].decisions[0]='rejected';eq(L.canRelease(rows),true);eq(L.aggregate(rows).dims[0].mean,null);eq(L.aggregate(rows).overall,null);eq(L.aggregate(rows).dims[1].mean,4);
rows.push(row(3));eq(L.aggregate(rows).dims[0].mean,4);eq(L.aggregate(rows).overall,4);
eq(L.eligibleRows([...rows,row(8,[1,1,1],{target:'ploy'})]).length,4);
eq(L.aggregate([row(0),row(0),row(1)]).overall,null);eq(L.pending([row(0,[3,4,4]),row(0,[3,4,4]),row(1)]).length,0);
eq(L.aggregate([row(0),row(1),row(2,[5,5,5],{status:'draft'})]).overall,null);
let result=L.aggregate([row(0,[4,3,5],{decisions:['auto','approved','auto']}),row(1,[4,3,5],{decisions:['auto','approved','auto']}),row(2,[4,3,5],{decisions:['auto','approved','auto']})]);eq(result.overall,4);
eq(L.quarterEligible([result,result,result]),false);let high=L.aggregate([row(0),row(1),row(2)]);eq(L.quarterEligible([high,high,high]),true);eq(L.quarterEligible([high,high]),false);eq(L.quarterEligible([high,high,{...high,overall:null}]),false);
console.log(checks+' business-rule checks passed');
// Validate seeded eligibility and closed-round deletion on the same domain functions used by UI.
const vm=require('node:vm'),fs=require('node:fs');const sandbox={GlowLogic:L,GlowLogin:{active:()=>false,render:()=>{}},localStorage:{getItem:()=>null},matchMedia:()=>({matches:true}),document:{querySelector:()=>null,addEventListener:()=>{}},window:{}};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync('./public/app.js','utf8'),sandbox);
const initial=vm.runInContext('seed()',sandbox),current=initial.records.filter(r=>r.round==='2026-10');
eq(L.pending(current).length,5);eq(L.eligibleRows(current).length,current.length-2);ok(!L.pending(current).some(x=>x.record.target==='ploy'));
const keep=L.eligibleRows(current),closed=initial.records.filter(r=>r.round!=='2026-10'||keep.includes(r));eq(closed.filter(r=>r.round==='2026-10'&&r.target==='ploy').length,0);eq(closed.filter(r=>r.round!=='2026-10').length,initial.records.filter(r=>r.round!=='2026-10').length);
console.log('Seed, queue and discard checks passed; total '+checks);
