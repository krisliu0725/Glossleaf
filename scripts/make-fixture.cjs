const fs=require('node:fs')
module.exports=function createFixture(path,count=2,navigation=false){
 const texts=[[
 'Academic Reading: A Reproducible Study',
 'Research design connects evidence with careful interpretation.',
 'A river bank is different from a financial bank [12].',
 'This paragraph tests contextual translation and saved quotations.',
 '',
 'Methods',
 'We compare source paragraphs with their translated counterparts.',
 'Readers can select text and preserve its original location.',
 '',
 'Results',
 'Stable anchors remain correct after restarting the application.',
 'A glossary keeps important research terms consistent.'
 ],[
 'Discussion',
 'Evidence should be interpreted with attention to context.',
 'The same phrase can require a different translation.',
 '',
 'References',
 '[12] Example Author. Academic reading. 2026.',
 'https://example.org'
 ]]
 const font=3+count*2,link=font+1,outlines=link+1,chapter1=outlines+1,chapter2=outlines+2;const objs=[];objs[1]='<< /Type /Catalog /Pages 2 0 R '+(navigation?'/PageLabels << /Nums [0 << /S /D /St 189 >>] >> /Outlines '+outlines+' 0 R ':'')+'>>';objs[2]='<< /Type /Pages /Kids ['+Array.from({length:count},(_,i)=>(3+i*2)+' 0 R').join(' ')+'] /Count '+count+' >>'
 for(let i=0;i<count;i++){
  const page=3+i*2,stream=page+1;let y=730;let content=''
  for(const [j,text] of texts[i%texts.length].entries()){content+=`BT /F1 ${j===0?20:12} Tf 50 ${y} Td (${text.replace(/[()\\]/g,'\\$&')}) Tj ET\n`;y-=j===0?40:24}
  objs[page]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${process.env.JIAN_TEST_VARIANT==='rotate'?'/Rotate 90 /CropBox [10 15 602 782]':''} /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R ${i===1?'/Annots ['+link+' 0 R]':''} >>`
  objs[stream]=`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`
 }
 objs[font]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';objs[link]='<< /Type /Annot /Subtype /Link /Rect [50 520 220 545] /A << /S /URI /URI (https://example.org) >> >>'
 if(navigation){objs[outlines]='<< /Type /Outlines /First '+chapter1+' 0 R /Last '+chapter2+' 0 R /Count 2 >>';objs[chapter1]='<< /Title (Introduction) /Parent '+outlines+' 0 R /Next '+chapter2+' 0 R /Dest [3 0 R /Fit] >>';objs[chapter2]='<< /Title (Methods) /Parent '+outlines+' 0 R /Prev '+chapter1+' 0 R /Dest ['+(3+Math.min(1,count-1)*2)+' 0 R /Fit] >>'}
 let out='%PDF-1.4\n',offsets=[0]
 for(let i=1;i<objs.length;i++){offsets[i]=Buffer.byteLength(out);out+=`${i} 0 obj\n${objs[i]}\nendobj\n`}
 const pos=Buffer.byteLength(out);out+=`xref\n0 ${objs.length}\n0000000000 65535 f \n`;for(let i=1;i<objs.length;i++)out+=String(offsets[i]).padStart(10,'0')+' 00000 n \n'
 out+=`trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;fs.writeFileSync(path,out)
}
if(require.main===module)module.exports(process.argv[2])
