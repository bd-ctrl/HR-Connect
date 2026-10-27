(function(root){
const dimensions=['ความเร็ว','ความถูกต้อง','การสื่อสาร'];
const weights=[1,1,1],minimum=3;
function distinct(rows){return new Set(rows.filter(r=>r.status==='submitted').map(r=>r.rater)).size}
function unique(rows){const seen=new Set();return rows.filter(r=>{const k=r.round+'|'+r.target+'|'+r.rater;if(r.status!=='submitted'||seen.has(k))return false;seen.add(k);return true})}
function validate(f,state,rows,eligible=['non','mind','ploy'],round='2026-10'){
 const errors=[];
 if(state!=='open')errors.push('รอบนี้ปิดรับการประเมินแล้ว');
 if(f.target==='me')errors.push('ไม่สามารถประเมินตัวเองได้');
 if(!eligible.includes(f.target))errors.push('กรุณาเลือกผู้ร่วมงานต่างแผนกที่อยู่ในรายการของคุณ');
 if(!f.collaborated)errors.push('กรุณายืนยันว่าได้ร่วมงานจริงในรอบ 30 วันที่ผ่านมา');
 if(rows.some(s=>s.target===f.target&&s.rater==='me'&&s.round===round))errors.push('คุณส่งการประเมินคนนี้แล้วในรอบนี้');
 if(!Array.isArray(f.scores)||f.scores.length!==3)errors.push('ต้องให้คะแนนครบทั้ง 3 ด้าน');
 for(let i=0;i<3;i++){const v=f.scores?.[i];if(!Number.isInteger(v)||v<1||v>5)errors.push('กรุณาให้คะแนนด้าน'+dimensions[i]);else if(v<=3&&!String(f.reasons?.[i]||'').trim())errors.push('กรุณาระบุเหตุผลด้าน'+dimensions[i]);}
 return errors;
}
function eligibleRows(rows){const groups=new Map();for(const r of unique(rows)){const k=r.round+'|'+r.target;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}return [...groups.values()].filter(g=>distinct(g)>=minimum).flat()}
function pending(rows){return eligibleRows(rows).flatMap(r=>r.scores.map((score,i)=>({record:r,dimension:i,score})).filter(x=>x.score<=3&&r.decisions[x.dimension]==='pending'))}
function aggregate(rows){
 const eligible=unique(rows),n=distinct(eligible);
 const dims=[0,1,2].map(i=>{const valid=eligible.filter(r=>r.decisions?.[i]==='approved'||(r.scores[i]>=4&&r.decisions?.[i]==='auto'));const count=distinct(valid);return {count,mean:n>=minimum&&count>=minimum?valid.reduce((a,r)=>a+r.scores[i],0)/valid.length:null}});
 return {count:n,dims,overall:dims.every(d=>d.mean!==null)?dims.reduce((a,d,i)=>a+d.mean*weights[i],0)/weights.reduce((a,b)=>a+b):null};
}
function canRelease(rows){return pending(rows).length===0}
function quarterEligible(results){return results.length===3&&results.every(r=>r.overall!==null&&r.dims.every(d=>d.mean!==null&&d.mean>=4))}
const api={dimensions,weights,minimum,distinct,unique,validate,eligibleRows,pending,aggregate,canRelease,quarterEligible};
if(typeof module!=='undefined')module.exports=api;else root.GlowLogic=api;
})(typeof window!=='undefined'?window:globalThis);
