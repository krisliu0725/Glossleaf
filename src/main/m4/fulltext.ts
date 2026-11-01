import {lookup} from 'node:dns/promises'
import {get} from 'node:https'
import {isIP} from 'node:net'
import {Readable} from 'node:stream'
import {promises as fs} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {normalizeDoi} from '../../shared/metadata'
import type {ItemDetail} from '../../shared/domain'
import {metadataJson} from './metadata'
export const fullTextActivity={downloads:0,restoring:false}
export function isPublicAddress(address:string):boolean {
 const family=isIP(address)
 if(family===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19))}
 if(family===6){const v=address.toLowerCase();return /^[23]/.test(v)&&!v.startsWith('2001:db8:')&&!v.startsWith('2002:')&&!v.startsWith('2001:0:')}
 return false
}
export async function publicEndpoint(raw:string,resolver:typeof lookup=lookup):Promise<{url:URL;address:string;family:number}>{
 const url=new URL(raw),host=url.hostname.replace(/^\[|\]$/g,'')
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.hash||/^(localhost)$|\.(localhost|local|internal)$/i.test(host))throw new Error('全文地址必须是公开 HTTPS 地址')
 const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await resolver(host,{all:true})
 if(!addresses.length||addresses.some(v=>!isPublicAddress(v.address)))throw new Error('全文地址不能指向本机或私有网络')
 const address=addresses.find(v=>v.family===4)??addresses[0];return {url,...address}
}
/** Pin the vetted DNS result to the TLS request, including on every redirect. */
export async function fetchPublic(raw:string,signal:AbortSignal):Promise<Response>{
 const {url,address,family}=await publicEndpoint(raw)
 signal.throwIfAborted()
 return new Promise((resolve,reject)=>{
  const req=get(url,{signal,family,lookup:(_host,_options,callback)=>callback(null,address,family),headers:{Accept:'application/pdf','Accept-Encoding':'identity','User-Agent':'Glossleaf/0.8.0'}},res=>{
   try{const headers=new Headers();for(const [key,value]of Object.entries(res.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value)
    const status=res.statusCode??502,empty=[204,205,304].includes(status);if(empty)res.resume()
    resolve(new Response(empty?null:Readable.toWeb(res) as ReadableStream,{status,headers}))
   }catch(e){res.destroy();reject(e)}
  });req.on('error',reject)
 })
}
export async function savePdf(raw:string,target:string,signal:AbortSignal,fetcher:(url:string,signal:AbortSignal)=>Promise<Response>=fetchPublic):Promise<{url:string;bytes:number}>{
 let url=raw,response:Response|undefined
 for(let redirects=0;redirects<=4;redirects++){
  response=await fetcher(url,signal)
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new Error('全文跳转未返回地址');url=new URL(location,url).href;continue
  }
  break
 }
 if(!response?.ok||!response.body){await response?.body?.cancel();throw new Error('未取得可下载的 PDF（HTTP '+(response?.status??0)+'）')}
 const cap=150*1024*1024;if(Number(response.headers.get('content-length'))>cap){await response.body.cancel();throw new Error('PDF 超过 150 MB 下载上限')}
 let file:Awaited<ReturnType<typeof fs.open>>;try{file=await fs.open(target,'wx',0o600)}catch(e){await response.body.cancel();throw e}
 const reader=response.body.getReader(),abort=()=>{void reader.cancel(signal.reason).catch(()=>undefined)};signal.addEventListener('abort',abort,{once:true});let bytes=0,prefix=Buffer.alloc(0),tail=Buffer.alloc(0),complete=false
 try{
  while(true){signal.throwIfAborted();const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>cap)throw new Error('PDF 超过 150 MB 下载上限')
   const chunk=Buffer.from(r.value);if(prefix.length<1024)prefix=Buffer.concat([prefix,chunk.subarray(0,1024-prefix.length)]);tail=Buffer.concat([tail,chunk]).subarray(-2048)
   await file.writeFile(chunk)
  }
  signal.throwIfAborted()
  if(!prefix.includes('%PDF-')||!tail.includes('%%EOF'))throw new Error('服务器返回的不是完整 PDF，未保存附件')
  complete=true;return {url,bytes}
 }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>undefined);await file.close();if(!complete)await fs.rm(target,{force:true})}
}
export interface FullTextResult{status:'downloaded'|'existing'|'unavailable';message:string;source?:string;bytes?:number}
export async function fullTextCandidates(item:ItemDetail,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<string[]>{
 if(!item.fields.DOI)throw new Error('请先补全并核对 DOI，再获取全文')
 const doi=normalizeDoi(item.fields.DOI),urls:string[]=[];let lookupFailed=false
 // Fixed DOI lookup; never guess a paper from a filename similarity score.
 try{
  const data=await metadataJson('https://api.openalex.org/works/https://doi.org/'+encodeURIComponent(doi),signal,fetcher)
  if(normalizeDoi(String(data.doi??''))===doi)for(const location of [data.best_oa_location,...(Array.isArray(data.locations)?data.locations:[])])if(location?.is_oa===true&&typeof location.pdf_url==='string')urls.push(location.pdf_url)
 }catch(e){if(signal.aborted)throw e;lookupFailed=true}
 // Publisher-deposited direct PDF links are a fallback; login/HTML pages fail validation.
 try{let raw=JSON.parse(item.fields.metadataSourceJson??'{}');if(!raw.DOI||normalizeDoi(String(raw.DOI))!==doi){const data=await metadataJson('https://api.crossref.org/works/'+encodeURIComponent(doi),signal,fetcher);raw=data.message??{}}if(raw.DOI&&normalizeDoi(String(raw.DOI))===doi)for(const link of Array.isArray(raw.link)?raw.link:[])if(link['content-type']==='application/pdf'&&typeof link.URL==='string')urls.push(link.URL)}catch(e){if(signal.aborted)throw e;if(lookupFailed)throw new Error('全文检索服务暂不可用，文献记录已保留，请稍后重试')}
 return [...new Set(urls)].filter(url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password}catch{return false}}).slice(0,3)
}
export async function downloadFullText(item:ItemDetail,libraryDir:string,signal:AbortSignal,attach:(file:string,source:string)=>Promise<unknown>,options:{metadataFetcher?:typeof fetch;pdfFetcher?:(url:string,signal:AbortSignal)=>Promise<Response>}={}):Promise<FullTextResult>{
 if(item.documents.some(d=>d.activeVersionId))return {status:'existing',message:'已有本地附件，无需重复下载'}
 const urls=await fullTextCandidates(item,signal,options.metadataFetcher),dir=join(libraryDir,'.tmp','downloads');await fs.mkdir(dir,{recursive:true})
 let lastError='未找到可直接下载的全文；文献记录已保留，可关联本地文件'
 for(const url of urls){const target=join(dir,randomUUID()+'.pdf')
  try{const saved=await savePdf(url,target,signal,options.pdfFetcher);signal.throwIfAborted();await attach(target,saved.url);return {status:'downloaded',message:'全文已下载到书府',source:saved.url,bytes:saved.bytes}}
  catch(e){if(signal.aborted)throw e;lastError=e instanceof Error?e.message:'全文下载未完成'}
  finally{await fs.rm(target,{force:true})}
 }
 return {status:'unavailable',message:urls.length?'全文下载未完成，文献记录已保留：'+lastError:lastError}
}
/** Crash leftovers are app-owned UUID files; leave recent files alone for another running session. */
export async function cleanupDownloadStaging(libraryDir:string,now=Date.now()):Promise<void>{
 const dir=join(libraryDir,'.tmp','downloads');await fs.mkdir(dir,{recursive:true})
 for(const entry of await fs.readdir(dir,{withFileTypes:true}))if(entry.isFile()&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.pdf$/i.test(entry.name)){
  const file=join(dir,entry.name),st=await fs.stat(file);if(now-st.mtimeMs>24*60*60*1000)await fs.rm(file,{force:true})
 }
}
