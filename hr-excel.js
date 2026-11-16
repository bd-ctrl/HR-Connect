// Write a small, uncompressed OOXML workbook without a third-party CDN.
(function(root){
 const encoder=new TextEncoder();
 const xml=value=>String(value??'')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'')
  .replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 const decl='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 const sheetsNS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const relNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const packageNS='http://schemas.openxmlformats.org/package/2006/relationships';
 const col=index=>index<26?String.fromCharCode(65+index):col(Math.floor(index/26)-1)+col(index%26);
 function worksheet(rows,widths){
  const bound=col(rows[0].length-1)+rows.length;
  return decl+`<worksheet xmlns="${sheetsNS}"><dimension ref="A1:${bound}"/>
   <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
   <cols>${widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('')}</cols>
   <sheetData>${rows.map((row,i)=>`<row r="${i+1}">${row.map((value,j)=>{
    if(value===null||value===undefined)return '';
    const ref=col(j)+(i+1);
    if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}"><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
   }).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:${bound}"/></worksheet>`;
 }
 const crcTable=Uint32Array.from({length:256},(_,n)=>{
  for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);
  return n;
 });
 function zip(files){
  const parts=[],directory=[];
  let offset=0,dirSize=0;
  const header=(size,fields)=>{
   const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);
   for(const [position,value,wide] of fields)view[wide?'setUint32':'setUint16'](position,value,true);
   return bytes;
  };
  for(const [path,content] of files){
   const name=encoder.encode(path),data=encoder.encode(content);
   let crc=0xffffffff;
   for(const byte of data)crc=(crc>>>8)^crcTable[(crc^byte)&255];
   crc^=0xffffffff;
   const local=header(30,[[0,0x04034b50,true],[4,20],[12,33],[14,crc,true],[18,data.length,true],[22,data.length,true],[26,name.length]]);
   const central=header(46,[[0,0x02014b50,true],[4,20],[6,20],[14,33],[16,crc,true],[20,data.length,true],[24,data.length,true],[28,name.length],[42,offset,true]]);
   parts.push(local,name,data);directory.push(central,name);
   offset+=local.length+name.length+data.length;dirSize+=central.length+name.length;
  }
  const end=header(22,[[0,0x06054b50,true],[8,files.length],[10,files.length],[12,dirSize,true],[16,offset,true]]);
  return new Blob([...parts,...directory,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 }
 function workbook(sheets){
  const files=[
   ['[Content_Types].xml',decl+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
   ['_rels/.rels',decl+`<Relationships xmlns="${packageNS}"><Relationship Id="rId1" Type="${relNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
   ['xl/workbook.xml',decl+`<workbook xmlns="${sheetsNS}" xmlns:r="${relNS}"><sheets>${sheets.map(({name},i)=>`<sheet name="${xml(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
   ['xl/_rels/workbook.xml.rels',decl+`<Relationships xmlns="${packageNS}">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${relNS}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`]
  ];
  sheets.forEach(({rows,widths},i)=>files.push([`xl/worksheets/sheet${i+1}.xml`,worksheet(rows,widths)]));
  return zip(files);
 }
 const date=value=>value?new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'';
 const scoreColumns=['ความเร็ว','ความถูกต้อง','การสื่อสาร','เฉลี่ยรวม','จำนวนผู้ประเมินที่ใช้คำนวณ'];
 function report(reports){
  const rounds=[['รอบเดือน','ผู้ส่งการประเมิน','ผู้ถูกประเมิน','แบบประเมิน','คะแนนรอตรวจ','คะแนนอนุมัติ','คะแนนไม่อนุมัติ','คะแนนผ่านอัตโนมัติ']];
  const people=[['รอบเดือน','รหัสผู้ถูกประเมิน','ผู้ถูกประเมิน','แผนก',...scoreColumns]];
  const departments=[['รอบเดือน','แผนก',...scoreColumns]];
  const detail=[['รอบเดือน','รหัสแบบประเมิน','รหัสผู้ถูกประเมิน','ผู้ถูกประเมิน','แผนก','รหัสผู้ประเมินแบบไม่ระบุชื่อ','วันเวลาที่ส่ง (ไทย)','โปรเจกต์','ด้านที่ประเมิน','คะแนน / 5','เหตุผลผู้ประเมิน','สถานะตรวจสอบ','หมายเหตุ HR','วันเวลาที่ตรวจ (ไทย)']];
  for(const {round,counts,people:recipients,departments:teams,submissions} of reports){
   const statuses=new Map();
   for(const a of submissions)for(const answer of a.answers){
    statuses.set(answer.status,(statuses.get(answer.status)||0)+1);
    detail.push([round,a.id,a.target,a.name,a.department,a.rater,date(a.created),a.context,answer.dimension,answer.score,answer.reason,answer.status,answer.note,date(answer.reviewedAt)]);
   }
   const statusCounts=['รอ HR ตรวจสอบ','อนุมัติ','ไม่อนุมัติ','ผ่านอัตโนมัติ'].map(status=>statuses.get(status)||0);
   rounds.push([round,counts.raters,counts.recipients,submissions.length,...statusCounts]);
   for(const row of recipients)people.push([round,row.target,row.name,row.department,...row.means,row.overall,row.raters]);
   for(const row of teams)departments.push([round,row.department,...row.means,row.overall,row.raters]);
  }
  return workbook([
   {name:'สรุปรอบ',rows:rounds,widths:[15,22,20,16,18,18,19,23]},
   {name:'รายบุคคล',rows:people,widths:[15,24,24,22,18,18,18,18,31]},
   {name:'รายแผนก',rows:departments,widths:[15,24,18,18,18,18,31]},
   {name:'รายละเอียดรายคะแนน',rows:detail,widths:[15,27,24,24,22,32,28,36,20,15,55,24,48,28]}
  ]);
 }
 root.CubicExcel={report};
})(typeof window==='undefined'?globalThis:window);
