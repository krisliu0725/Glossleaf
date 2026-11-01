import {normalizeDoi,metadataSchema} from '../../shared/metadata'
import {fromCrossref} from './doi'
import {titleSimilarity} from '../../shared/metadata-match'
import type {MetadataDraft,MetadataCandidate} from '../../shared/m4'
/** Bounded, fixed-host metadata retrieval. Never fetch a publisher-supplied URL. */
export async function metadataJson(url:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<any>{
 const response=await fetcher(url,{headers:{Accept:'application/json','User-Agent':'Glossleaf/0.8.0 (local reference workspace)'},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])})
 if(!response.ok){const error=new Error(response.status===404?'未找到元数据，请尝试题名检索或手动填写':response.status===429?'元数据服务请求频繁，请稍后再试':'元数据查询失败（HTTP '+response.status+'）') as Error&{status:number};error.status=response.status;throw error}
 if(!response.body)throw new Error('元数据服务未返回内容')
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0
 try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>2_000_000)throw new Error('元数据响应超过大小上限');chunks.push(r.value)}}finally{await reader.cancel().catch(()=>undefined)}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function fromDataCite(raw:Record<string,any>,doi:string):MetadataDraft{
 if(normalizeDoi(String(raw.doi??''))!==doi)throw new Error('元数据 DOI 与请求不一致，未采用结果')
 const types:Record<string,string>={JournalArticle:'journalArticle',Book:'book',BookChapter:'bookSection',ConferencePaper:'conferencePaper',Dissertation:'thesis',Report:'report',Dataset:'dataset',Preprint:'preprint',Text:'other'}
 const fields:Record<string,string>={DOI:doi,metadataSource:'DataCite REST API',metadataSourceJson:JSON.stringify(raw),metadataRetrievedAt:new Date().toISOString()}
 if(typeof raw.publisher==='string')fields.publisher=raw.publisher;else if(raw.publisher?.name)fields.publisher=raw.publisher.name
 if(typeof raw.url==='string')fields.url=raw.url
 const abstract=raw.descriptions?.find((d:any)=>d.descriptionType==='Abstract');if(abstract?.description)fields.abstractNote=abstract.description
 if(raw.container?.title)fields.publicationTitle=raw.container.title
 const creators=(Array.isArray(raw.creators)?raw.creators:[]).map((c:any,index:number)=>{const person=c.nameType==='Personal'&&(c.familyName||c.givenName);return {order:index,role:'author',nameMode:person?'person':'literal',familyName:person?c.familyName??null:null,givenName:person?c.givenName??null:null,literalName:person?null:c.name??null}}).filter((c:any)=>c.literalName||c.familyName||c.givenName)
 return metadataSchema.parse({title:raw.titles?.[0]?.title,type:types[raw.types?.resourceTypeGeneral]??'other',date:raw.publicationYear?String(raw.publicationYear):null,language:typeof raw.language==='string'?raw.language:null,creators,fields})
}
export async function resolveDoi(raw:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<{doi:string;draft:MetadataDraft;source:string}>{
 const doi=normalizeDoi(raw),cross='https://api.crossref.org/works/'+encodeURIComponent(doi)
 try{const data=await metadataJson(cross,signal,fetcher);if(data.status!=='ok'||!data.message)throw new Error('元数据响应格式不受支持');return {doi,draft:fromCrossref(data.message,doi),source:cross}}
 catch(e){if((e as Error&{status?:number}).status!==404)throw e}
 const url='https://api.datacite.org/dois/'+encodeURIComponent(doi),data=await metadataJson(url,signal,fetcher)
 return {doi,draft:fromDataCite(data.data?.attributes??{},doi),source:url}
}
export async function findMetadata(query:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<MetadataCandidate[]>{
 const input=query.trim();if(!input||input.length>500)throw new Error('请输入 DOI 或题名（最多 500 字）')
 if(/^(?:10\.|doi:|https?:\/\/(?:dx\.)?doi\.org\/)/i.test(input)){const r=await resolveDoi(input,signal,fetcher);return [{...r,match:'identifier',similarity:1}]}
 const url=new URL('https://api.crossref.org/works');url.searchParams.set('query.bibliographic',input);url.searchParams.set('rows','6')
 const data=await metadataJson(url.href,signal,fetcher);if(!Array.isArray(data.message?.items))throw new Error('元数据响应格式不受支持')
 const candidates:MetadataCandidate[]=[]
 for(const raw of data.message.items){try{const doi=normalizeDoi(String(raw.DOI)),draft=fromCrossref(raw,doi);candidates.push({doi,draft,source:'https://api.crossref.org/works/'+encodeURIComponent(doi),match:'title',similarity:titleSimilarity(input,draft.title)})}catch{/* Skip malformed candidates without losing other results. */}}
 return [...new Map(candidates.sort((a,b)=>b.similarity-a.similarity).map(c=>[c.doi,c])).values()]
}
