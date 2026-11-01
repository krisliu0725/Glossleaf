// Unembedded standard CJK PDF font; PDF.js resolves Adobe's bundled CMaps.
const fs=require('node:fs')
module.exports=function(path){
 const objects=[]
 objects[1]='<< /Type /Catalog /Pages 2 0 R >>'
 objects[2]='<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>'
 const hex=s=>Buffer.from(s,'utf16le').swap16().toString('hex').toUpperCase()
 for(let p=0;p<3;p++){
  const lines=[
   ['人工智能与数字社会 2026 年第 2 期',52,770,10],
   [p===0?'Academic Evidence and Public Policy':'研究方法与证据分析',50,710,p===0?20:16],
   ['李明',260,680,12],
   ['DOI: 10.1234/synthetic.paper',50,650,10],
   ['摘要：风 险叠加 、 不确定性与不可预测性增强，',50,590,12],
   ['研究需要可靠证据。我们将制度分析与政策实践相联系，',50,572,12],
   ['讨论如何建立审慎而透明的解释框架。',50,554,12],
   ['关键词：人工智能；研究方法；公共治理',50,515,12],
   ['一、研究问题与方法',50,470,15],
   ['  当前，公共治理中的知识与解释需要综合理解，',50,430,12],
   ['研究者应重视资料来源，并对结论的适用范围保持审慎。',50,412,12],
   ['  第二段讨论概念边界与具体情境，避免把不同来源',50,370,12],
   ['中的陈述直接视为同一种证据，保留完整的研究过程。',50,352,12],
   ['注：这是隔离合成材料，不包含用户文献。',50,90,9],
   [String(p+1),300,25,10]
  ]
  let stream=''
  for(const [text,x,y,size]of lines){const cjk=/[\u3400-\u9fff]/.test(text);stream+='BT /'+(cjk?'C1':'F1')+' '+size+' Tf '+x+' '+y+' Td '+(cjk?'<'+hex(text)+'>':'('+text.replace(/[()\\]/g,'\\$&')+')')+' Tj ET\n'}
  const n=3+p*2;objects[n]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R /C1 10 0 R >> >> /Contents '+(n+1)+' 0 R >>'
  objects[n+1]='<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'endstream'
 }
 objects[9]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
 objects[10]='<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [11 0 R] >>'
 objects[11]='<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 12 0 R /DW 1000 >>'
 objects[12]='<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>'
 let result='%PDF-1.4\n',offsets=[0]
 for(let i=1;i<objects.length;i++){offsets[i]=Buffer.byteLength(result);result+=i+' 0 obj\n'+objects[i]+'\nendobj\n'}
 const xref=Buffer.byteLength(result);result+='xref\n0 '+objects.length+'\n0000000000 65535 f \n'
 for(let i=1;i<objects.length;i++)result+=String(offsets[i]).padStart(10,'0')+' 00000 n \n'
 result+='trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';fs.writeFileSync(path,result)
}
