import type {Segment} from '@shared/m3'
import type {ReaderData} from '@shared/reader'
import {normalizeBlockText} from './analyze'
export const ignored=(s:Segment):boolean=>s.kind==='margin'||s.kind==='reference'
export function documentBlocks(pages:Record<number,Segment[]>,data:ReaderData,metadata:{authors?:string[]}={}):Segment[]{
 let rows=Object.entries(pages).sort((a,b)=>Number(a[0])-Number(b[0])).flatMap(([,rows])=>rows).map(s=>({...s}))
 const edge=new Map<string,Set<number>>()
 for(const s of rows)if(s.bounds&&s.pageHeight&&(s.bounds[1]<s.pageHeight*.14||s.bounds[3]>s.pageHeight*.88)&&s.text.length<160){
  const signature=s.text.replace(/\d+/g,'#').replace(/\s/g,'').toLowerCase()
  const key=(s.bounds[1]<s.pageHeight*.14?'top:':'bottom:')+signature
  const set=edge.get(key)??new Set<number>();set.add(s.pageIndex);edge.set(key,set)
 }
 const plain=(text:string):string=>text.replace(/[\s\p{P}\p{N}]/gu,'').toLowerCase()
 const authors=(metadata.authors??[]).map(plain).filter(Boolean)
 rows=rows.map(s=>{if(s.pageIndex!==0||s.text.length>160||!authors.length||!['body','heading'].includes(s.kind))return s;let text=plain(s.text);let found=false;for(const name of authors)if(text.includes(name)){text=text.replace(name,'');found=true}return found&&!text?{...s,kind:'margin' as const}:s})
 let refs=false
 rows=rows.map(s=>{
  if(s.bounds&&s.pageHeight){const key=(s.bounds[1]<s.pageHeight*.14?'top:':'bottom:')+s.text.replace(/\d+/g,'#').replace(/\s/g,'').toLowerCase();if((s.bounds[1]<s.pageHeight*.14||s.bounds[3]>s.pageHeight*.88)&&(edge.get(key)?.size??0)>=3)return {...s,kind:'margin' as const}}
  if(s.kind==='reference')refs=true
  if(/^(appendix|acknowledg|附录|致谢)/i.test(s.text))refs=false
  return refs&&s.kind!=='margin'?{...s,kind:'reference' as const}:s
 })
 const firstAbstract=rows.findIndex(s=>s.pageIndex===0&&s.kind==='abstract')
 if(firstAbstract>=0){
  rows=rows.map((s,index)=>{
   if(index>=firstAbstract||s.pageIndex!==0||s.kind!=='body'||!s.bounds||!s.pageWidth||s.text.length>100)return s
   const centered=s.bounds[0]>s.pageWidth*.2&&s.bounds[2]<s.pageWidth*.8
   const nameLike=/^[\p{L}\p{N}\s·,，、*†.()-]+$/u.test(s.text)&&!/[。；！？:：]/.test(s.text)
   return centered&&nameLike?{...s,kind:'margin' as const}:s
  })
 }
 const result:Segment[]=[]
 for(const s of rows){
  const prev=result.filter(x=>!ignored(x)).at(-1)
  const pageBoundary=prev&&s.pageIndex===prev.pageIndex+1
  const columnBoundary=prev&&s.pageIndex===prev.pageIndex&&s.column!==prev.column
  if(prev&&s.kind==='body'&&['body','abstract'].includes(prev.kind)&&prev.endsContinuation&&s.startsContinuation&&(pageBoundary||columnBoundary)){
   const previous=prev.parts??[{pageIndex:prev.pageIndex,rects:prev.rects,text:prev.text}]
   prev.parts=[...previous,{pageIndex:s.pageIndex,rects:s.rects,text:s.text}]
   prev.text=normalizeBlockText(prev.text+'\n'+s.text);prev.endsContinuation=s.endsContinuation
  }else result.push(s)
 }
 for(const override of data.overrides){
  const index=result.findIndex(s=>s.id===override.id)
  if(override.action==='replace'&&override.segment){
   const custom=override.segment,rects=custom.rects
   for(let i=result.length-1;i>=0;i--)if(result[i].pageIndex===custom.pageIndex&&result[i].rects.every(r=>rects.some(c=>c[0]<=r[0]+2&&c[1]<=r[1]+2&&c[2]>=r[2]-2&&c[3]>=r[3]-2)))result.splice(i,1)
   const next=result.findIndex(s=>s.pageIndex>custom.pageIndex);result.splice(next<0?result.length:next,0,custom)
   result.sort((a,b)=>a.pageIndex-b.pageIndex||(b.rects[0]?.[3]??0)-(a.rects[0]?.[3]??0));continue
  }
  if(index<0)continue
  if(override.action==='ignore')result[index]={...result[index],kind:'margin'}
  if(override.action==='merge'&&index>0){
   let before=index-1;while(before>=0&&ignored(result[before]))before--
   if(before<0)continue
   const a=result[before],b=result[index];a.parts=[...(a.parts??[{pageIndex:a.pageIndex,rects:a.rects,text:a.text}]),...(b.parts??[{pageIndex:b.pageIndex,rects:b.rects,text:b.text}])]
   a.text=normalizeBlockText(a.text+'\n'+b.text);result.splice(index,1)
  }
 }
 return result
}
export function detectLanguage(rows:Segment[]):'zh'|'en'|null{
 const text=rows.filter(s=>!ignored(s)).map(s=>s.text).join('').slice(0,20000),han=(text.match(/\p{Script=Han}/gu)??[]).length,latin=(text.match(/[A-Za-z]/g)??[]).length
 if(han+latin<120)return null
 if(han/(han+latin)>.65)return 'zh'
 const words=text.toLowerCase().match(/[a-z]+/g)??[],markers=new Set(words.filter(w=>['the','and','of','in','to','with','is','are','for','that'].includes(w)))
 if(latin/(han+latin)>.9&&markers.size>=3)return 'en'
 return null
}
