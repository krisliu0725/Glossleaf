import type { PdfAnchor, Rect } from './m3'
/** Accept the older Zotero-shaped object as well as Jian's page-anchor array. */
export function readAnchors(raw: string, version: string, quote=''): PdfAnchor[] {
 let value: unknown
 try {value=JSON.parse(raw)} catch {return []}
 const list=Array.isArray(value)?value:value&&typeof value==='object'&&'rects'in value?[value]:[]
 return list.flatMap(v=>{
  if(!v||typeof v!=='object'||!Number.isInteger(v.pageIndex)||v.pageIndex<0||!Array.isArray(v.rects))return []
  const rects=v.rects.filter((r:unknown)=>Array.isArray(r)&&r.length===4&&r.every(n=>typeof n==='number'&&Number.isFinite(n))) as Rect[]
  return [{documentVersionId:version,pageIndex:v.pageIndex,rects,...(v.kind==='point'&&Array.isArray(v.point)&&v.point.length===2&&v.point.every((x:unknown)=>typeof x==='number'&&x>=0&&x<=1)?{kind:'point' as const,point:v.point as [number,number]}:{}),prefix:typeof v.prefix==='string'?v.prefix:undefined,suffix:typeof v.suffix==='string'?v.suffix:undefined,orderKey:typeof v.orderKey==='number'?v.orderKey:undefined,exact:typeof v.exact==='string'?v.exact:quote}]
 })
}
