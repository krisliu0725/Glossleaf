import type {MetadataDraft} from './m4'
export function titleSimilarity(a:string,b:string):number {
 const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{S}]/gu,'')
 const x=normalize(a),y=normalize(b);if(!x||!y)return 0;if(x===y)return 1
 const grams=(s:string)=>{const a=[...s],m=new Map<string,number>();for(let i=0;i<a.length-1;i++){const k=a[i]+a[i+1];m.set(k,(m.get(k)??0)+1)}return m}
 const l=grams(x),r=grams(y);let shared=0;for(const [g,n]of l)shared+=Math.min(n,r.get(g)??0)
 return 2*shared/Math.max(1,[...x].length+[...y].length-2)
}
/** First-page identifiers are hints, never an authorization to replace metadata. */
export function doiHints(text:string):string[]{
 return [...new Set((text.match(/\b10\.\d{4,9}\/[^\s<>"\u3000-\u303f\u4e00-\u9fff]+/gi)??[]).map(s=>s.replace(/[.,;:]+$/,'').replace(/\)+$/,m=>m.length>((s.match(/\(/g)??[]).length)?'':m).toLowerCase()))].slice(0,8)
}
export interface MetadataChange {key:string;label:string;before:string;after:string;use:boolean}
const person=(d:MetadataDraft)=>d.creators.map(c=>c.nameMode==='literal'?c.literalName:[c.familyName,c.givenName].filter(Boolean).join(', ')).join('; ')
export function metadataChanges(current:MetadataDraft,incoming:MetadataDraft):MetadataChange[]{
 const basic=[['title','题名',current.title,incoming.title],['type','类型',current.type,incoming.type],['date','日期',current.date??'',incoming.date??''],['language','语言',current.language??'',incoming.language??''],['creators','作者与其他责任者',person(current),person(incoming)]]
 const names:Record<string,string>={DOI:'DOI',publicationTitle:'期刊 / 书名 / 会议名称',volume:'卷',issue:'期',pages:'页码',publisher:'出版社 / 机构',abstractNote:'摘要',url:'URL'}
 for(const [k,v] of Object.entries(incoming.fields))if(!k.startsWith('metadata')&&k!=='originalType')basic.push(['fields.'+k,names[k]??k,current.fields[k]??'',v])
 return basic.filter(([, ,a,b])=>b.trim()&&a!==b).map(([key,label,before,after])=>({key,label,before,after,use:!before.trim()}))
}
export function mergeMetadata(current:MetadataDraft,incoming:MetadataDraft,keys:string[]):MetadataDraft {
 const merged:MetadataDraft={...current,fields:{...current.fields},creators:[...current.creators]}
 for(const key of keys){if(key.startsWith('fields.')){const k=key.slice(7);if(incoming.fields[k])merged.fields[k]=incoming.fields[k]}else if(key==='creators')merged.creators=[...incoming.creators];else if(['title','type','date','language'].includes(key))(merged as any)[key]=(incoming as any)[key]}
 if(keys.length)for(const [k,v]of Object.entries(incoming.fields))if(k.startsWith('metadata'))merged.fields[k]=v
 return merged
}
