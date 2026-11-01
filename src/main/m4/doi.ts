import { normalizeDoi, metadataSchema } from '../../shared/metadata'
import type { MetadataDraft } from '../../shared/m4'
import type { Creator } from '../../shared/domain'
const typeMap: Record<string,string>={'journal-article':'journalArticle','book':'book','monograph':'book','book-chapter':'bookSection','proceedings-article':'conferencePaper','dissertation':'thesis','report':'report','posted-content':'preprint','dataset':'dataset'}
export function fromCrossref(raw: Record<string,unknown>, doi:string): MetadataDraft {
 const texts=(v:unknown):string=>Array.isArray(v)?String(v[0]??''):typeof v==='string'?v:''
 if(normalizeDoi(String(raw.DOI??''))!==doi)throw new Error('元数据 DOI 与请求不一致，未采用结果')
 const title=texts(raw.title);if(!title.trim())throw new Error('服务未返回有效题名')
 const creators:Creator[]=[]
 for(const role of ['author','editor'])for(const v of (Array.isArray(raw[role])?raw[role]:[]) as Array<Record<string,unknown>>) {
  const literal=texts(v.name),family=texts(v.family),given=texts(v.given)
  if(!(literal||family||given))continue
  creators.push({order:creators.length,role,nameMode:literal?'literal':'person',givenName:literal?null:given||null,familyName:literal?null:family||null,literalName:literal||null})
 }
 const issued=(raw.published??raw.issued) as {'date-parts'?:number[][]}|undefined
 let parts=issued?.['date-parts']?.[0]?.slice(0,3)
 if(parts?.length){if(!Number.isInteger(parts[0])||parts[0]<1||parts[0]>9999)parts=undefined;else if(parts.length>1&&(!Number.isInteger(parts[1])||parts[1]<1||parts[1]>12))parts=parts.slice(0,1);else if(parts.length>2&&(!Number.isInteger(parts[2])||parts[2]<1||parts[2]>31))parts=parts.slice(0,2)}
 const date=parts?.length&&parts.every(Number.isInteger)?parts.map((n,i)=>i?String(n).padStart(2,'0'):String(n)).join('-'):null
 const fields:Record<string,string>={DOI:doi,metadataSource:'Crossref REST API',metadataSourceJson:JSON.stringify(raw),metadataRetrievedAt:new Date().toISOString(),originalType:String(raw.type??'unknown')}
 const names:Record<string,string>={'container-title':'publicationTitle',publisher:'publisher',volume:'volume',issue:'issue',page:'pages',URL:'url',ISBN:'ISBN',ISSN:'ISSN',abstract:'abstractNote','publisher-location':'place'}
 for(const [from,to] of Object.entries(names)){const value=texts(raw[from]);if(value)fields[to]=value}
 return metadataSchema.parse({title,type:typeMap[String(raw.type)]??'other',date,language:texts(raw.language)||null,fields,creators})
}
export async function lookupDoi(raw:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<{doi:string;draft:MetadataDraft;source:string}> {
 const doi=normalizeDoi(raw),url=`https://api.crossref.org/works/${encodeURIComponent(doi)}`
 const response=await fetcher(url,{headers:{Accept:'application/json','User-Agent':'Glossleaf/0.7.0 (local reference workspace)'},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])})
 if(!response.ok)throw new Error(response.status===404?'Crossref 未收录此 DOI；可检查 DOI 或手动编辑元数据':response.status===429?'元数据服务请求频繁，请稍后再试':`元数据查询失败（HTTP ${response.status}）`)
 if(!response.body)throw new Error('元数据服务未返回内容')
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0
 try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>500000)throw new Error('元数据响应超过大小上限');chunks.push(r.value)}}finally{await reader.cancel().catch(()=>undefined)}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {status?:string;message?:Record<string,unknown>}
 if(data.status!=='ok'||!data.message)throw new Error('元数据响应格式不受支持')
 return {doi,draft:fromCrossref(data.message,doi),source:url}
}
