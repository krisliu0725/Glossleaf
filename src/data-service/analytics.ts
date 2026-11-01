import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Db, Row } from './db'
import type { AnalyticsQuery, AnalyticsSettings, ApiAttempt, DashboardSnapshot, ReadingSample, TokenSummary } from '../shared/analytics'
const token = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable()
export const attemptSchema = z.object({ id:z.string().uuid(),operationId:z.string().uuid(),attempt:z.number().int().min(1).max(10),startedAt:z.string().datetime(),finishedAt:z.string().datetime(),provider:z.enum(['compatible','gemini','ollama','anthropic']),endpointHost:z.string().max(255).regex(/^[a-zA-Z0-9.:[\]-]+$/),model:z.string().min(1).max(200),purpose:z.enum(['interactive','background','test']),status:z.enum(['completed','failed','cancelled']),httpStatus:z.number().int().min(100).max(599).nullable(),inputTokens:token,outputTokens:token,totalTokens:token,cachedInputTokens:token,reasoningTokens:token,estimatedInputTokens:z.number().int().min(0),estimatedOutputTokens:z.number().int().min(0) })
function scalar(db:Db,sql:string,args:unknown[]=[]):number{return Number(db.get(sql,args)?.n??0)}
export function analyticsSettings(db:Db):AnalyticsSettings {
 let since=db.get("SELECT value FROM meta WHERE key='analytics_since'")?.value
 if(!since){since=new Date().toISOString();db.run("INSERT INTO meta VALUES('analytics_since',?) ON CONFLICT(key) DO NOTHING",[since])}
 return {enabled:db.get("SELECT value FROM meta WHERE key='analytics_enabled'")?.value!=='false',trackingSince:String(since)}
}
/** Unicode character count excluding whitespace; mixed-language word proxy = Han characters + Latin/other word sequences. */
export function textCounts(text:string):{characters:number;words:number} {
 const characters=Array.from(text.replace(/\s/gu,'')).length
 const han=text.match(/\p{Script=Han}/gu)?.length??0
 const words=text.replace(/\p{Script=Han}/gu,' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length??0
 return {characters,words:han+words}
}
export function recordAttempt(db:Db,raw:unknown):boolean {
 if(!analyticsSettings(db).enabled)return false
 const a=attemptSchema.parse(raw)
 const captureSince=String(db.get("SELECT value FROM meta WHERE key='analytics_capture_since'")?.value??analyticsSettings(db).trackingSince)
 if(Date.parse(a.startedAt)<Date.parse(captureSince))return false
 if(Date.parse(a.finishedAt)<Date.parse(a.startedAt))throw new Error('请求完成时间早于开始时间')
 const keys=Object.keys(a)
 return db.run(`INSERT OR IGNORE INTO analytics_attempt(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,keys.map(k=>a[k as keyof ApiAttempt])).changes>0
}
export function recordReading(db:Db,raw:unknown):boolean {
 if(!analyticsSettings(db).enabled)return false
 const s=z.object({id:z.string().uuid(),sessionId:z.string().uuid(),documentVersionId:z.string().uuid(),pageIndex:z.number().int().min(0).max(100000),startedAt:z.string().datetime(),finishedAt:z.string().datetime(),visit:z.boolean()}).parse(raw) satisfies ReadingSample
 const captureSince=String(db.get("SELECT value FROM meta WHERE key='analytics_capture_since'")?.value??analyticsSettings(db).trackingSince)
 if(Date.parse(s.startedAt)<Date.parse(captureSince))return false
 const ms=Date.parse(s.finishedAt)-Date.parse(s.startedAt)
 if(ms<0||ms>20000)throw new Error('阅读采样时间无效')
 const doc=db.get(`SELECT d.itemId,v.pageCount FROM document_version v JOIN document d ON d.activeVersionId=v.id JOIN entity e ON e.id=d.itemId WHERE v.id=? AND e.deletedAt IS NULL`,[s.documentVersionId])
 if(!doc||doc.pageCount!==null&&s.pageIndex>=Number(doc.pageCount))return false
 const page=db.get("SELECT rawText FROM search_source WHERE documentVersionId=? AND pageIndex=? AND kind='body'",[s.documentVersionId,s.pageIndex])
 const counts=page?textCounts(String(page.rawText)):null
 return db.run('INSERT OR IGNORE INTO analytics_reading VALUES(?,?,?,?,?,?,?,?,?,?)',[s.id,s.sessionId,s.documentVersionId,doc.itemId,s.pageIndex,s.startedAt,s.finishedAt,s.visit?1:0,counts?.characters??null,counts?.words??null]).changes>0
}
export function recordOperation(db:Db,kind:string,status='completed',count=1):void {
 if(!analyticsSettings(db).enabled)return
 if(!['import','export','search','annotation','comment','cache_hit','error','job_completed','job_failed'].includes(kind)||!['completed','failed','cancelled'].includes(status))return
 db.run('INSERT INTO analytics_operation VALUES(?,?,?,?,?)',[randomUUID(),kind,status,Math.max(0,Math.min(1000000,Math.trunc(count))),new Date().toISOString()])
}
const emptyTokens=():TokenSummary=>({inputTokens:null,outputTokens:null,totalTokens:null,cachedInputTokens:null,reasoningTokens:null,attempts:0,completed:0,failed:0,cancelled:0,reportedAttempts:0,unknownAttempts:0,estimatedInputTokens:0,estimatedOutputTokens:0})
function addTokens(t:TokenSummary,r:Row):void {
 t.attempts++;t[String(r.status) as 'completed'|'failed'|'cancelled']++
 if(r.totalTokens!==null)t.reportedAttempts++;else t.unknownAttempts++
 for(const k of ['inputTokens','outputTokens','totalTokens','cachedInputTokens','reasoningTokens'] as const)if(r[k]!==null)t[k]=(t[k]??0)+Number(r[k])
 t.estimatedInputTokens+=Number(r.estimatedInputTokens);t.estimatedOutputTokens+=Number(r.estimatedOutputTokens)
}
export function dayKey(at:number,timezone:string):string {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at))
 return ['year','month','day'].map(k=>parts.find(p=>p.type===k)?.value).join('-')
}
/** Split UTC intervals at actual local midnight; also handles DST, UTC offsets and timezone changes. */
export function splitDays(start:number,end:number,timezone:string):Array<{day:string;ms:number}> {
 const result:Array<{day:string;ms:number}>=[]
 while(start<end){const day=dayKey(start,timezone);let next=end
  if(dayKey(end-1,timezone)!==day){let lo=start+1,hi=end;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(dayKey(mid,timezone)===day)lo=mid+1;else hi=mid}next=lo}
  result.push({day,ms:next-start});start=next
 }
 return result
}
export function snapshot(db:Db,query:AnalyticsQuery,now=new Date()):DashboardSnapshot {
 const parsed=z.object({range:z.enum(['7','30','90','all']),timezone:z.string().max(100).optional()}).parse(query)
 const timezone=parsed.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone
 dayKey(now.getTime(),timezone) // Reject invalid IANA zones before querying.
 const settings=analyticsSettings(db),from=parsed.range==='all'?Date.parse(settings.trackingSince):Math.max(Date.parse(settings.trackingSince),now.getTime()-Number(parsed.range)*86400000),since=new Date(from).toISOString(),until=now.toISOString()
 const reading=db.all('SELECT * FROM analytics_reading WHERE finishedAt>=? AND startedAt<=?',[since,until])
 const attempts=db.all('SELECT * FROM analytics_attempt WHERE startedAt>=? AND startedAt<=?',[since,until])
 const operations=db.all('SELECT kind,status,sum(count) AS n FROM analytics_operation WHERE createdAt>=? AND createdAt<=? GROUP BY kind,status',[since,until])
 const op=(kind:string,status='completed')=>Number(operations.find(r=>r.kind===kind&&r.status===status)?.n??0)
 const trend=new Map<string,{day:string;activeMs:number;pageVisits:number;totalTokens:number;unknownAttempts:number}>()
 const day=(key:string)=>{let t=trend.get(key);if(!t){t={day:key,activeMs:0,pageVisits:0,totalTokens:0,unknownAttempts:0};trend.set(key,t)}return t}
 // Empty dates remain visible and the chart never implies missing days were untracked before enabling.
 for(let ts=from;ts<=now.getTime();ts+=86400000)day(dayKey(ts,timezone));day(dayKey(now.getTime(),timezone))
 let activeMs=0,pageVisits=0,visitedCharacters=0,visitedWords=0
 const pages=new Map<string,{characters:number;words:number;available:boolean}>(),sessions=new Set<string>(),documents=new Set<string>(),itemTimes=new Map<string,number>()
 for(const r of reading){
  const start=Math.max(from,Date.parse(String(r.startedAt))),end=Math.min(now.getTime(),Date.parse(String(r.finishedAt))),duration=Math.max(0,end-start)
  activeMs+=duration;sessions.add(String(r.sessionId));documents.add(String(r.documentVersionId))
  itemTimes.set(String(r.itemId),(itemTimes.get(String(r.itemId))??0)+duration)
  for(const part of splitDays(start,end,timezone))day(part.day).activeMs+=part.ms
  const key=`${r.documentVersionId}:${r.pageIndex}`
  let counts=pages.get(key)
  if(!counts){const source=r.characters===null?db.get("SELECT rawText FROM search_source WHERE kind='body' AND documentVersionId=? AND pageIndex=?",[r.documentVersionId,r.pageIndex]):null;const c=source?textCounts(String(source.rawText)):{characters:Number(r.characters??0),words:Number(r.words??0)};counts={...c,available:r.characters!==null||!!source};pages.set(key,counts)}
  if(r.visit&&Date.parse(String(r.startedAt))>=from){pageVisits++;visitedCharacters+=counts.characters;visitedWords+=counts.words;day(dayKey(Date.parse(String(r.startedAt)),timezone)).pageVisits++}
 }
 const tokens=emptyTokens(),modelMap=new Map<string,TokenSummary&{provider:string;model:string;endpointHost:string}>(),purposeMap=new Map<string,TokenSummary&{purpose:ApiAttempt['purpose']}>()
 for(const r of attempts){addTokens(tokens,r);const key=JSON.stringify([r.provider,r.model,r.endpointHost]);let model=modelMap.get(key);if(!model){model={...emptyTokens(),provider:String(r.provider),model:String(r.model),endpointHost:String(r.endpointHost)};modelMap.set(key,model)}addTokens(model,r)
  const p=String(r.purpose) as ApiAttempt['purpose'];let purpose=purposeMap.get(p);if(!purpose){purpose={...emptyTokens(),purpose:p};purposeMap.set(p,purpose)}addTokens(purpose,r)
  const t=day(dayKey(Date.parse(String(r.startedAt)),timezone));if(r.totalTokens===null)t.unknownAttempts++;else t.totalTokens+=Number(r.totalTokens)
 }
 const live="JOIN entity e ON e.id=i.id WHERE e.deletedAt IS NULL"
 const topics=new Map<string,{id:string;label:string;documents:number;activeMs:number;basis:'confirmed'|'tag'}>(),fields=new Map<string,{id:string;label:string;documents:number;activeMs:number;basis:'confirmed'|'collection'}>()
 const classifications=db.all(`SELECT c.* FROM analytics_classification c JOIN item i ON i.id=c.itemId ${live}`),confirmed=new Set(classifications.map(r=>String(r.itemId)))
 function category<T extends {id:string;label:string;documents:number;activeMs:number;basis:'confirmed'|'tag'|'collection'}>(map:Map<string,T>,id:string,label:string,itemId:string,basis:T['basis']):void{const c=map.get(id)??{id,label,documents:0,activeMs:0,basis} as T;c.documents++;c.activeMs+=itemTimes.get(itemId)??0;map.set(id,c)}
 for(const r of classifications){for(const label of JSON.parse(String(r.topicsJson)) as string[])category(topics,'confirmed:'+label,label,String(r.itemId),'confirmed');if(r.field)category(fields,'confirmed:'+r.field,String(r.field),String(r.itemId),'confirmed')}
 for(const r of db.all(`SELECT t.id,t.name,x.itemId FROM tag t JOIN item_tag x ON x.tagId=t.id JOIN item i ON i.id=x.itemId ${live}`))if(!confirmed.has(String(r.itemId)))category(topics,'tag:'+r.id,String(r.name),String(r.itemId),'tag')
 // 集合不再参与「研究方向」：文件夹名是用户自订的组织方式，不是文献内容。
 // 领域只保留用户显式确认过的分类，避免把自建目录误当成学科分布。
 const count=(table:string)=>scalar(db,`SELECT count(*) AS n FROM ${table}`)
 const currentIndex="document_index x JOIN document d ON d.activeVersionId=x.documentVersionId JOIN item i ON i.id=d.itemId JOIN entity e ON e.id=i.id WHERE e.deletedAt IS NULL AND d.availability='managed'"
 const liveAnnotations="annotation a JOIN entity e ON e.id=a.id WHERE e.deletedAt IS NULL"
 return {generatedAt:until,range:parsed.range,timezone,settings,
 reading:{activeMs,sessions:sessions.size,documents:documents.size,uniquePages:pages.size,pageVisits,uniqueVisitedCharacters:[...pages.values()].reduce((n,c)=>n+c.characters,0),uniqueVisitedWords:[...pages.values()].reduce((n,c)=>n+c.words,0),visitedCharacters,visitedWords,pagesWithText:[...pages.values()].filter(p=>p.available).length},readingDocuments: readingDocuments(db,reading,from,now.getTime()),tokens,models:[...modelMap.values()].sort((a,b)=>(b.totalTokens??0)-(a.totalTokens??0)),purposes:[...purposeMap.values()],trend:[...trend.values()].sort((a,b)=>a.day.localeCompare(b.day)),
 library:{items:scalar(db,`SELECT count(*) AS n FROM item i ${live}`),documents:scalar(db,`SELECT count(*) AS n FROM document d JOIN item i ON i.id=d.itemId ${live}`),managedBytes:scalar(db,'SELECT coalesce(sum(byteSize),0) AS n FROM file_blob'),linkedDocuments:scalar(db,'SELECT count(*) AS n FROM document d JOIN document_version v ON v.id=d.activeVersionId JOIN external_file_grant g ON g.id=v.externalGrantId JOIN entity e ON e.id=d.itemId WHERE e.deletedAt IS NULL'),linkedBytes:scalar(db,'SELECT coalesce(sum(g.byteSize),0) AS n FROM external_file_grant g WHERE g.id IN(SELECT v.externalGrantId FROM document d JOIN document_version v ON v.id=d.activeVersionId JOIN entity e ON e.id=d.itemId WHERE e.deletedAt IS NULL)'),indexedPages:scalar(db,"SELECT count(*) AS n FROM search_source s JOIN document d ON d.activeVersionId=s.documentVersionId JOIN entity e ON e.id=d.itemId WHERE s.kind='body' AND e.deletedAt IS NULL AND d.availability='managed'"),indexedDocuments:scalar(db,`SELECT count(*) AS n FROM ${currentIndex} AND x.status='completed'`),pendingDocuments:scalar(db,`SELECT count(*) AS n FROM ${currentIndex} AND x.status IN('pending','indexing')`),failedDocuments:scalar(db,`SELECT count(*) AS n FROM ${currentIndex} AND x.status='failed'`),annotations:scalar(db,`SELECT count(*) AS n FROM ${liveAnnotations} AND a.type!='note'`),comments:scalar(db,`SELECT count(*) AS n FROM ${liveAnnotations} AND a.type!='note' AND trim(coalesce(a.comment,''))!=''`),notes:scalar(db,'SELECT count(*) AS n FROM note n JOIN entity e ON e.id=n.id WHERE e.deletedAt IS NULL')+scalar(db,`SELECT count(*) AS n FROM ${liveAnnotations} AND a.type='note'`),translations:count('translation_record'),glossaryTerms:count('glossary_entry'),cachedTranslations:count('translation_cache')},
 activity:{annotations:op('annotation'),comments:op('comment'),translations:tokens.completed,imports:op('import'),exports:op('export'),errors:op('error')+tokens.failed,cacheHits:op('cache_hit'),searches:op('search'),jobsCompleted:op('job_completed'),jobsFailed:op('job_failed')},topics:[...topics.values()].sort((a,b)=>b.activeMs-a.activeMs||b.documents-a.documents).slice(0,50),fields:[...fields.values()].sort((a,b)=>b.activeMs-a.activeMs||b.documents-a.documents).slice(0,50),
 notices:['阅读时长仅计入窗口聚焦、系统未闲置且阅读器持续心跳的采样区间；不代表持续注视或理解。','字数/词数是访问页可提取文本的代理值；不等于实际逐字阅读。扫描页未索引时计为未知。','Token 仅累计服务返回的用量；未返回保持未知。估算值单独列出，不用于计费。','话题/领域优先使用用户确认分类；未分类文献以标签为代理，集合不再作为话题来源，不自动推断。','概览的文库存量包含历史数据；期间活动与网络用量只统计启用后的本机记录。']}
}
function readingDocuments(db:Db,rows:Row[],from:number,until:number):DashboardSnapshot['readingDocuments'] {
 const map=new Map<string,DashboardSnapshot['readingDocuments'][number]&{pages:Set<number>}>()
 for(const r of rows){const id=String(r.documentVersionId);let d=map.get(id)
  if(!d){const item=db.get('SELECT i.title FROM item i WHERE id=?',[r.itemId]);const c=db.get('SELECT topicsJson,field FROM analytics_classification WHERE itemId=?',[r.itemId]);d={itemId:String(r.itemId),title:String(item?.title??'已移除文献'),documentVersionId:id,activeMs:0,uniquePages:0,uniqueVisitedCharacters:0,uniqueVisitedWords:0,topics:c?JSON.parse(String(c.topicsJson)):[],field:c?.field?String(c.field):null,pages:new Set()};map.set(id,d)}
  d.activeMs+=Math.max(0,Math.min(until,Date.parse(String(r.finishedAt)))-Math.max(from,Date.parse(String(r.startedAt))))
  const pageIndex=Number(r.pageIndex)
  if(!d.pages.has(pageIndex)){d.pages.add(pageIndex);const source=r.characters===null?db.get("SELECT rawText FROM search_source WHERE kind='body' AND documentVersionId=? AND pageIndex=?",[id,pageIndex]):null;const counts=source?textCounts(String(source.rawText)):{characters:Number(r.characters??0),words:Number(r.words??0)};d.uniquePages++;d.uniqueVisitedCharacters+=counts.characters;d.uniqueVisitedWords+=counts.words}
 }
 return [...map.values()].sort((a,b)=>b.activeMs-a.activeMs).slice(0,100).map(({pages,...d})=>d)
}
export function dispatchAnalytics(db:Db,method:string,p:Record<string,unknown>):unknown {
 switch(method){
 case 'analytics.snapshot':return snapshot(db,p as unknown as AnalyticsQuery)
 case 'analytics.settings':{if(p.enabled!==undefined){z.boolean().parse(p.enabled);const previous=analyticsSettings(db).enabled;db.run("INSERT INTO meta VALUES('analytics_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[String(p.enabled)]);if(p.enabled&&!previous)db.run("INSERT INTO meta VALUES('analytics_capture_since',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[new Date().toISOString()])}return analyticsSettings(db)}
 case 'analytics.reading':return recordReading(db,p)
 case 'analytics.attempt':return recordAttempt(db,p)
 case 'analytics.operation':{recordOperation(db,String(p.kind),String(p.status??'completed'),Number(p.count??1));return true}
 case 'analytics.clear':{db.transaction(()=>{for(const table of ['analytics_reading','analytics_attempt','analytics_operation'])db.run(`DELETE FROM ${table}`);db.run("INSERT INTO meta VALUES('analytics_since',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[new Date().toISOString()]);db.run("DELETE FROM meta WHERE key='analytics_capture_since'")});return analyticsSettings(db)}
 case 'analytics.export':return JSON.stringify({version:1,exportedAt:new Date().toISOString(),settings:analyticsSettings(db),definitions:{reading:'focus-and-idle-gated sampling; text counts proxy',tokens:'provider reported; null means unknown; estimates separate'},reading:db.all('SELECT * FROM analytics_reading'),attempts:db.all('SELECT * FROM analytics_attempt'),operations:db.all('SELECT * FROM analytics_operation'),classifications:db.all('SELECT * FROM analytics_classification')},null,2)
 case 'analytics.classifications':{const itemId=z.string().uuid().parse(p.itemId),r=db.get('SELECT * FROM analytics_classification WHERE itemId=?',[itemId]);return r?{itemId,topics:JSON.parse(String(r.topicsJson)),field:r.field}:null}
 case 'analytics.classify':{const c=z.object({itemId:z.string().uuid(),topics:z.array(z.string().trim().min(1).max(80)).max(20),field:z.string().trim().min(1).max(80).nullable()}).parse(p);if(!db.get('SELECT i.id FROM item i JOIN entity e ON e.id=i.id WHERE i.id=? AND e.deletedAt IS NULL',[c.itemId]))throw new Error('文献不存在');db.transaction(()=>{db.run('INSERT INTO analytics_classification VALUES(?,?,?,?) ON CONFLICT(itemId) DO UPDATE SET topicsJson=excluded.topicsJson,field=excluded.field,confirmedAt=excluded.confirmedAt',[c.itemId,JSON.stringify([...new Set(c.topics)]),c.field,new Date().toISOString()]);db.run("INSERT OR IGNORE INTO search_dirty VALUES(?,'metadata',?)",['item:'+c.itemId,c.itemId]);});return true}
 default:throw new Error('未知统计方法')
 }
}
