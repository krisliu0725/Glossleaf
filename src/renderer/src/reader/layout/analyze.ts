import type { Rect, Segment } from '@shared/m3'
export interface Glyph {text:string;x0:number;y0:number;x1:number;y1:number;rect:Rect;index:number}
const median=(xs:number[],fallback=12):number=>{const s=xs.filter(Number.isFinite).sort((a,b)=>a-b);return s[Math.floor(s.length/2)]??fallback}
export function normalizeBlockText(text:string):string{
 return text.normalize('NFC').replace(/([A-Za-z])-\s*\n\s*([a-z])/g,'$1$2')
 .replace(/([\p{Script=Han}])[ \t]+(?=[\p{Script=Han}，。；：！？、）》」』】])/gu,'$1')
 .replace(/([（《「『【])[ \t]+(?=[\p{Script=Han}])/gu,'$1')
 .replace(/([，。；：！？、])[ \t]+(?=[\p{Script=Han}])/gu,'$1')
 .replace(/([\p{Script=Han}，、；：])\s*\n\s*(?=[\p{Script=Han}])/gu,'$1')
 .replace(/\s*\n\s*/g,' ').replace(/[ \t]+/g,' ').trim()
}
function classify(text:string,y0:number,y1:number,height:number,size:number,bodySize:number,pageIndex:number):Segment['kind']{
 if(/^(?:doi\s*[:：]?\s*10\.|https?:\/\/doi\.org\/|10\.\d{4,9}\/)/i.test(text)||/^(基金项目|资助项目|作者简介|收稿日期|修回日期|文章编号|中图分类号|文献标识码)\s*[:：]/.test(text))return 'margin'
 if(pageIndex===0&&y0<height*.3&&size>bodySize*1.4)return 'title'
 if((y0<height*.065||y1>height*.95)&&text.length<140)return 'margin'
 if(/^(references|bibliography|参考文献|參考文獻|引用文献)\s*[:：]?\s*$/i.test(text))return 'reference'
 if(/^(摘要|摘 要|abstract)\s*[:：]?\s*/i.test(text))return 'abstract'
 if(/^(关键词|关 键 词|keywords|key words)\s*[:：]/i.test(text))return 'keywords'
 if(/^(图|表|figure|fig\.|table)\s*\d+/i.test(text))return 'caption'
 if(y0>height*.8&&size<bodySize*.82)return 'footnote'

 if(/^(?:introduction|methods?|materials(?: and methods)?|results?|discussion|conclusions?|background|致谢|引言|结论|讨论|方法|结果)\s*$/i.test(text))return 'heading'
 if(size>bodySize*1.18||/^(?:[一二三四五六七八九十]+[、．.]|\d+(?:\.\d+)*[.、]?\s+[A-Z\p{Script=Han}])/u.test(text)&&text.length<90)return 'heading'
 return 'body'
}
export function analyzePage(glyphs:Glyph[],width:number,height:number,pageIndex:number):Segment[]{
 const gs=glyphs.filter(g=>g.text.trim()&&g.x1>g.x0&&g.y1>g.y0)
 if(!gs.length)return []
 const fs=median(gs.map(g=>g.y1-g.y0)),narrow=gs.filter(g=>g.x1-g.x0<width*.6)
 let split:number|null=null,best=0
 for(let x=Math.floor(width*.3);x<width*.7;x+=2){
  const left=narrow.filter(g=>g.x1<x-6),right=narrow.filter(g=>g.x0>x+6),cross=narrow.filter(g=>g.x0<x+6&&g.x1>x-6)
  if(left.length<5||right.length<5||cross.length>narrow.length*.03)continue
  const overlap=Math.min(Math.max(...left.map(g=>g.y1)),Math.max(...right.map(g=>g.y1)))-Math.max(Math.min(...left.map(g=>g.y0)),Math.min(...right.map(g=>g.y0)))
  const score=overlap/height-cross.length/Math.max(1,narrow.length)
  if(score>best&&score>.12){split=x;best=score}
 }
 const spanning=split===null?[]:gs.filter(g=>g.x0<split!-6&&g.x1>split!+6)
 const cuts=[0,...new Set(spanning.map(g=>g.y1+fs*.3).sort((a,b)=>a-b)),height]
 const results:Segment[]=[]
 for(let band=0;band<cuts.length-1;band++){
  const local=gs.filter(g=>g.y0>=cuts[band]&&g.y0<cuts[band+1])
  const groups=split===null?[local]:[local.filter(g=>spanning.includes(g)),local.filter(g=>!spanning.includes(g)&&g.x0<split!),local.filter(g=>!spanning.includes(g)&&g.x0>=split!)]
  for(let columnIndex=0;columnIndex<groups.length;columnIndex++){
   const column=groups[columnIndex];if(!column.length)continue
   const lines:Glyph[][]=[]
   for(const g of [...column].sort((a,b)=>a.y0-b.y0||a.x0-b.x0)){
    const line=lines.find(l=>Math.abs(l[0].y0-g.y0)<Math.max(fs*.3,2))
    if(line)line.push(g);else lines.push([g])
   }
   lines.forEach(l=>l.sort((a,b)=>a.x0-b.x0))
   const leading=median(lines.slice(1).map((l,i)=>l[0].y0-lines[i][0].y0).filter(n=>n>fs*.6&&n<fs*3),fs*1.4)
   const colX=Math.min(...column.map(g=>g.x0)),colRight=Math.max(...column.map(g=>g.x1))
   let current:Glyph[][]=[]
   function flush():void{
    if(!current.length)return
    const items=current.flat(),raw=current.map(l=>l.map(g=>g.text).join(' ')).join('\n'),text=normalizeBlockText(raw)
    const y0=Math.min(...items.map(g=>g.y0)),y1=Math.max(...items.map(g=>g.y1)),size=median(items.map(g=>g.y1-g.y0)),kind=classify(text,y0,y1,height,size,fs,pageIndex)
    const first=current[0],last=current.at(-1)!,right=Math.max(...last.map(g=>g.x1))
    results.push({id:pageIndex+':'+items[0].index,pageIndex,text,rects:items.map(g=>g.rect),kind,confidence:split?.75:.9,
      bounds:[Math.min(...items.map(g=>g.x0)),y0,Math.max(...items.map(g=>g.x1)),y1],pageWidth:width,pageHeight:height,column:columnIndex,
      startsContinuation:first[0].x0-colX<fs*.75&&!/^(?:摘要|关键词|abstract|keywords)/i.test(text),
      endsContinuation:right>=colRight-fs*2&&!/[.!?。！？：:]\s*[”’"』」)]?$/.test(text)})
    current=[]
   }
   for(const line of lines){
    const prev=current.at(-1)
    if(prev){
     const prevText=prev.map(g=>g.text).join(' '),prevRight=Math.max(...prev.map(g=>g.x1))
     const gap=line[0].y0-Math.max(...prev.map(g=>g.y1))
     const prevKind=classify(normalizeBlockText(prevText),prev[0].y0,Math.max(...prev.map(g=>g.y1)),height,median(prev.map(g=>g.y1-g.y0)),fs,pageIndex)
     if(['margin','reference','title','heading','keywords'].includes(prevKind)||classify(normalizeBlockText(line.map(g=>g.text).join(' ')),line[0].y0,line[0].y1,height,median(line.map(g=>g.y1-g.y0)),fs,pageIndex)==='heading'||gap>Math.max(fs*.6,leading-fs+fs*.45)||Math.abs(median(line.map(g=>g.y1-g.y0))-median(prev.map(g=>g.y1-g.y0)))>fs*.25||
       line[0].x0-colX>fs*.9&&prev[0].x0-colX<fs*.5||
       prevRight<colRight-fs*2&&/[.!?。！？]$/.test(prevText)||
       /^(?:DOI|基金项目|作者简介|关键词|Keywords)\s*[:：]/i.test(line.map(g=>g.text).join(' ')))flush()
    }
    current.push(line)
   }
   flush()
  }
 }
 return results
}
