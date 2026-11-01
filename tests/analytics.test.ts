import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Db, openLibrary } from '../src/data-service/db'
import { SCHEMA_SQL, MIGRATIONS } from '../src/data-service/schema'
import { analyticsSettings, dispatchAnalytics, recordAttempt, recordReading, snapshot, splitDays, textCounts } from '../src/data-service/analytics'
import { dispatchM3 } from '../src/data-service/m3'
import { ReadingController } from '../src/main/analytics/reading'
import { reportedUsage, unknownUsage } from '../src/main/analytics/tokens'
import { prepare, translateRemote } from '../src/main/translation/core'
import { TranslationManager } from '../src/main/translation/manager'
import type { ApiAttempt, ReadingSample } from '../src/shared/analytics'
import type { ProviderConfig, TranslationInput } from '../src/shared/m3'
const fixed='2026-10-29T04:00:00.000Z'
function library(){const dir=mkdtempSync(join(tmpdir(),'jian-analytics-'));const db=openLibrary(dir);db.run("INSERT OR REPLACE INTO meta VALUES('analytics_since','2026-10-01T00:00:00.000Z')");return {db,dir,close:()=>{db.close();rmSync(dir,{recursive:true,force:true})}}}
function fixture(db:Db){const item=randomUUID(),doc=randomUUID(),version=randomUUID();for(const [id,kind] of [[item,'item'],[doc,'document'],[version,'document']])db.run('INSERT INTO entity(id,kind,createdAt,updatedAt) VALUES(?,?,?,?)',[id,kind,fixed,fixed]);db.run("INSERT INTO item(id,type,title) VALUES(?,'journalArticle','Fixture private title')",[item]);db.run("INSERT INTO document(id,itemId,displayName,contentType,activeVersionId) VALUES(?,?,'fixture.pdf','application/pdf',?)",[doc,item,version]);db.run("INSERT INTO document_version(id,documentId,externalGrantId,fingerprint,pageCount) VALUES(?,?,'fixture','fp',2)",[version,doc]);return {item,version}}
function reading(version:string,pageIndex:number,start:string,end:string,visit:boolean,sessionId=randomUUID()):ReadingSample{return {id:randomUUID(),sessionId,documentVersionId:version,pageIndex,startedAt:start,finishedAt:end,visit}}
function attempt(p:Partial<ApiAttempt>={}):ApiAttempt{return {id:randomUUID(),operationId:randomUUID(),attempt:1,startedAt:fixed,finishedAt:fixed,provider:'compatible',endpointHost:'api.deepseek.com',model:'fixture',purpose:'interactive',status:'completed',httpStatus:200,...unknownUsage(),estimatedInputTokens:100,estimatedOutputTokens:20,...p}}
test('v3 upgrade creates consistent snapshot before analytics migration and preserves user data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jian-v4-upgrade-'));try{const db=new Db(join(dir,'jian.sqlite'));db.exec(SCHEMA_SQL);db.exec(MIGRATIONS[2]);db.exec(MIGRATIONS[3]);db.run("INSERT INTO meta VALUES('schema_version','3')");db.run("INSERT INTO glossary_entry VALUES('one','library',NULL,'private','用户术语','exact',1)");db.close();const upgraded=openLibrary(dir);assert.equal(upgraded.get("SELECT value FROM meta WHERE key='schema_version'")?.value,'7');assert.equal(upgraded.get('SELECT target FROM glossary_entry')?.target,'用户术语');upgraded.close();const files=readdirSync(join(dir,'migration-snapshots'));assert.equal(files.length,4);const backup=new DatabaseSync(join(dir,'migration-snapshots',files.find(f=>f.includes('before-v4'))!),{readOnly:true});assert.equal(backup.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value,'3');assert.equal(backup.prepare("SELECT name FROM sqlite_master WHERE name='analytics_attempt'").get(),undefined);backup.close()}finally{rmSync(dir,{recursive:true,force:true})}
})
test('reading sampler excludes initial open, focus loss, idle, large gaps and wall clock jumps; page switches remain one session',async()=>{
 let now=Date.parse(fixed),mono=0;const rows:ReadingSample[]=[];const version=randomUUID();const controller=new ReadingController(async value=>{rows.push(value)},()=>now,()=>mono);const value={documentVersionId:version,pageIndex:0,visible:true,active:true}
 await controller.heartbeat(value,true);assert.equal(rows.length,1);assert.equal(rows[0].startedAt,rows[0].finishedAt)
 now+=5000;mono+=5000;await controller.heartbeat({...value,pageIndex:1},true);assert.equal(rows.length,3);assert.equal(rows[1].pageIndex,0);assert.equal(rows[1].visit,false);assert.equal(rows[2].visit,true);assert.equal(rows[0].sessionId,rows[2].sessionId)
 now+=5000;mono+=5000;await controller.heartbeat(value,false);assert.equal(rows.length,3)
 now+=5000;mono+=5000;await controller.heartbeat(value,true);assert.equal(rows.length,4);assert.notEqual(rows[3].sessionId,rows[0].sessionId)
 now+=30000;mono+=30000;await controller.heartbeat(value,true);assert.equal(rows.length,5);assert.equal(rows[4].startedAt,rows[4].finishedAt)
 now+=60000;mono+=5000;await controller.heartbeat(value,true);assert.equal(rows.length,6);assert.equal(rows[5].startedAt,rows[5].finishedAt)
 controller.reset();now+=5000;mono+=5000;await controller.heartbeat({...value,visible:false},true);assert.equal(rows.length,6)
})
test('reading samples deduplicate, count visits separately, and split midnight in the selected timezone',()=>{
 const l=library();try{const {version}=fixture(l.db);const session=randomUUID();const row=reading(version,0,'2026-10-28T15:59:55.000Z','2026-10-28T16:00:05.000Z',true,session)
 l.db.run("INSERT INTO search_source(sourceKey,itemId,kind,documentVersionId,pageIndex,rawText,normalizedText,offsetsJson) SELECT 'p0',d.itemId,'body',?,0,'中文 hello world','text','[]' FROM document d WHERE d.activeVersionId=?",[version,version]);assert.equal(recordReading(l.db,row),true);assert.equal(recordReading(l.db,row),false)
 recordReading(l.db,reading(version,0,'2026-10-29T03:00:00.000Z','2026-10-29T03:00:05.000Z',true,session))
 recordReading(l.db,reading(version,1,'2026-10-29T03:00:05.000Z','2026-10-29T03:00:05.000Z',true,session))
 const s=snapshot(l.db,{range:'7',timezone:'Asia/Shanghai'},new Date(fixed));assert.equal(s.reading.activeMs,15000);assert.equal(s.reading.uniquePages,2);assert.equal(s.reading.pageVisits,3);assert.equal(s.reading.uniqueVisitedCharacters,12);assert.equal(s.reading.visitedCharacters,24);assert.equal(s.reading.uniqueVisitedWords,4);assert.equal(s.reading.pagesWithText,1);assert.equal(s.reading.sessions,1);assert.equal(s.readingDocuments[0].uniquePages,2)
 assert.equal(s.trend.find(t=>t.day==='2026-10-28')?.activeMs,5000);assert.equal(s.trend.find(t=>t.day==='2026-10-29')?.activeMs,10000);assert.throws(()=>snapshot(l.db,{range:'7',timezone:'wrong/zone'}),/time zone/i)
 assert.equal(recordReading(l.db,reading(version,99,fixed,fixed,true)),false)
 assert.throws(()=>recordReading(l.db,reading(version,0,fixed,'2026-10-29T04:01:00.000Z',false)),/采样/)
 assert.deepEqual(textCounts('研究 hello-world 𠮷野'),{characters:15,words:5})
 }finally{l.close()}
})
test('local midnight splitting respects DST and keeps interval totals exact',()=>{
 const start=Date.parse('2026-11-01T03:59:55Z'),end=Date.parse('2026-11-01T04:00:05Z');assert.deepEqual(splitDays(start,end,'America/New_York'),[{day:'2026-10-31',ms:5000},{day:'2026-11-01',ms:5000}]);assert.equal(splitDays(Date.parse('2026-11-01T05:59:55Z'),Date.parse('2026-11-01T06:00:05Z'),'America/New_York').reduce((n,p)=>n+p.ms,0),10000)
})
test('token totals preserve unknown vs reported zero, deduplicate attempts and isolate purpose/model; disabling/clearing retains library',()=>{
 const l=library();try{const {item,version}=fixture(l.db);const known=attempt({inputTokens:10,outputTokens:5,totalTokens:15,cachedInputTokens:3});assert.equal(recordAttempt(l.db,known),true);assert.equal(recordAttempt(l.db,known),false);recordAttempt(l.db,attempt({model:'gemma',provider:'gemini',purpose:'test',status:'cancelled',inputTokens:0,outputTokens:0,totalTokens:0}));recordAttempt(l.db,attempt({purpose:'background',status:'failed'}));
 let s=snapshot(l.db,{range:'all',timezone:'UTC'},new Date(fixed));assert.equal(s.tokens.attempts,3);assert.equal(s.tokens.totalTokens,15);assert.equal(s.tokens.reportedAttempts,2);assert.equal(s.tokens.unknownAttempts,1);assert.equal(s.tokens.cancelled,1);assert.equal(s.tokens.failed,1);assert.equal(s.models.length,2);assert.equal(s.purposes.length,3);assert.equal(s.activity.translations,1);assert.equal(s.activity.annotations,0)
 dispatchAnalytics(l.db,'analytics.classify',{itemId:item,topics:['能源','能源'],field:'社会科学'});recordReading(l.db,reading(version,0,'2026-10-29T03:59:55.000Z',fixed,true));s=snapshot(l.db,{range:'all',timezone:'UTC'},new Date(fixed));assert.equal(s.topics[0].basis,'confirmed');assert.equal(s.topics[0].activeMs,5000);assert.equal(s.fields[0].label,'社会科学');assert.deepEqual(s.readingDocuments[0].topics,['能源']);
 const exported=String(dispatchAnalytics(l.db,'analytics.export',{}));assert.equal(exported.includes('Fixture private title'),false);assert.equal(exported.includes('Bearer'),false);assert.equal(JSON.parse(exported).attempts.length,3)
 dispatchAnalytics(l.db,'analytics.settings',{enabled:false});assert.equal(recordAttempt(l.db,attempt()),false);dispatchAnalytics(l.db,'analytics.clear',{});assert.equal(analyticsSettings(l.db).enabled,false);assert.equal(l.db.all('SELECT * FROM analytics_attempt').length,0);assert.equal(l.db.all('SELECT * FROM analytics_reading').length,0);assert.equal(l.db.all('SELECT * FROM item').length,1);assert.equal(l.db.all('SELECT * FROM analytics_classification').length,1);dispatchAnalytics(l.db,'analytics.settings',{enabled:true});assert.equal(recordAttempt(l.db,known),false);assert.equal(l.db.all('SELECT * FROM analytics_attempt').length,0)
 }finally{l.close()}
})
test('provider cumulative counters include cache/reasoning and reject invalid or missing numbers',()=>{
 let u=reportedUsage('gemini',{usageMetadata:{promptTokenCount:10,candidatesTokenCount:4,totalTokenCount:17,thoughtsTokenCount:3,cachedContentTokenCount:2}},unknownUsage());u=reportedUsage('gemini',{usageMetadata:{candidatesTokenCount:8,totalTokenCount:21}},u);assert.equal(u.inputTokens,10);assert.equal(u.outputTokens,8);assert.equal(u.totalTokens,21);assert.equal(u.reasoningTokens,3)
 const ds=reportedUsage('compatible',{usage:{prompt_tokens:12,completion_tokens:5,total_tokens:17,prompt_cache_hit_tokens:4,completion_tokens_details:{reasoning_tokens:2}}},unknownUsage());assert.equal(ds.cachedInputTokens,4);assert.equal(ds.reasoningTokens,2)
 const o=reportedUsage('ollama',{done:true,prompt_eval_count:8,eval_count:3,prompt_eval_cached_count:5},unknownUsage());assert.equal(o.totalTokens,11);assert.equal(o.cachedInputTokens,5)
 assert.equal(reportedUsage('compatible',{usage:{prompt_tokens:-1,completion_tokens:1.5,total_tokens:'10'}},unknownUsage()).totalTokens,null)
})
const input:TranslationInput={mode:'selection',text:'source sentence',context:'',itemId:null,sourceLanguage:'en'}
const config:ProviderConfig={kind:'compatible',baseUrl:'https://api.example.org/v1',model:'fixture',targetLanguage:'zh-CN',consent:true}
const sse=(events:unknown[])=>new Response(events.map(e=>'data: '+(typeof e==='string'?e:JSON.stringify(e))+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}})
test('actual HTTP retries each retain an attempt; shared subscribers and cache never multiply token counters',async()=>{
 const original=globalThis.fetch,records:ApiAttempt[]=[],l=library();try{
 let calls=0;globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.stream_options.include_usage,true);if(calls===1)return new Response('failure',{status:500});await new Promise(r=>setTimeout(r,10));return sse([{choices:[{delta:{content:'译文'},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}},'[DONE]'])}
 const store=async<T>(method:string,p:Record<string,unknown>={}):Promise<T>=>{if(method==='analytics.attempt'){records.push(p as unknown as ApiAttempt);return recordAttempt(l.db,p) as T}if(method==='analytics.operation')return dispatchAnalytics(l.db,method,p) as T;return dispatchM3(l.db,method,p) as T}
 const manager=new TranslationManager(store,async()=>({config,key:'SECRET-KEY'}));const [one,two]=await Promise.all([manager.translate({requestId:randomUUID(),generation:0,input},()=>{}),manager.translate({requestId:randomUUID(),generation:0,input},()=>{})]);assert.equal(one.text,two.text);assert.equal(calls,2);assert.equal(records.length,2);assert.equal(records[0].status,'failed');assert.equal(records[0].totalTokens,null);assert.equal(records[1].totalTokens,14);assert.equal(records[0].operationId,records[1].operationId);assert.notEqual(records[0].id,records[1].id);assert.equal(records[1].attempt,2)
 assert.equal((await manager.translate({requestId:randomUUID(),generation:0,input},()=>{})).cached,true);assert.equal(calls,2);assert.equal(records.length,2);assert.equal(JSON.stringify(records).includes('SECRET-KEY'),false);assert.equal(JSON.stringify(records).includes('source sentence'),false)
 }finally{globalThis.fetch=original;l.close()}
})
test('Gemini usageMetadata, local eval counts, and cancellation preserve real counters with purpose',async()=>{
 const original=globalThis.fetch,records:ApiAttempt[]=[];try{
 globalThis.fetch=async()=>sse([{candidates:[{content:{parts:[{text:'译文'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:8,candidatesTokenCount:4,thoughtsTokenCount:2,totalTokenCount:14}}]);let cfg={...config,kind:'gemini' as const,baseUrl:'https://generativelanguage.googleapis.com/v1beta'};await translateRemote(cfg,'secret',prepare(input,cfg,[]),new AbortController().signal,()=>{},{purpose:'test',record:async value=>{records.push(value)}});assert.equal(records[0].totalTokens,14);assert.equal(records[0].reasoningTokens,2);assert.equal(records[0].purpose,'test')
 const local={...config,kind:'ollama' as const,baseUrl:'http://127.0.0.1:11434'};globalThis.fetch=async()=>new Response(JSON.stringify({message:{content:'译文'},done:true,done_reason:'stop',prompt_eval_count:12,eval_count:4})+'\n');await translateRemote(local,'',prepare(input,local,[]),new AbortController().signal,()=>{},{purpose:'background',record:async value=>{records.push(value)}});assert.equal(records[1].totalTokens,16)
 const controller=new AbortController();globalThis.fetch=async()=>sse([{usage:{prompt_tokens:5,completion_tokens:2,total_tokens:7},choices:[{delta:{content:'片段'}}]}]);await assert.rejects(translateRemote(config,'',prepare(input,config,[]),controller.signal,()=>controller.abort(),{purpose:'interactive',record:async value=>{records.push(value)}}));assert.equal(records[2].status,'cancelled');assert.equal(records[2].totalTokens,7);assert.equal(records[2].estimatedOutputTokens,1)
 }finally{globalThis.fetch=original}
})

test('confirmed topics and fields remain searchable after edits, including classifications saved by an older build', async()=>{
 const {dispatchM4}=await import('../src/data-service/m4');const l=library();try{
  const {item}=fixture(l.db)
  dispatchM4(l.db,'m4.search',{query:'never-present',scope:'metadata'})
  dispatchAnalytics(l.db,'analytics.classify',{itemId:item,topics:['跨学科治理'],field:'比较制度研究'})
  assert.equal((dispatchM4(l.db,'m4.search',{query:'跨学科治理',scope:'metadata'}) as {groups:unknown[]}).groups.length,1)
  assert.equal((dispatchM4(l.db,'m4.search',{query:'比较制度研究',scope:'metadata'}) as {groups:unknown[]}).groups.length,1)
  dispatchAnalytics(l.db,'analytics.classify',{itemId:item,topics:['能源转型'],field:null})
  assert.equal((dispatchM4(l.db,'m4.search',{query:'跨学科治理',scope:'metadata'}) as {groups:unknown[]}).groups.length,0)
  assert.equal((dispatchM4(l.db,'m4.search',{query:'能源转型',scope:'metadata'}) as {groups:unknown[]}).groups.length,1)
  l.db.run("DELETE FROM meta WHERE key='search_classification_version'")
  l.db.run('UPDATE analytics_classification SET topicsJson=? WHERE itemId=?',[JSON.stringify(['旧版已确认话题']),item])
  assert.equal((dispatchM4(l.db,'m4.search',{query:'旧版已确认话题',scope:'metadata'}) as {groups:unknown[]}).groups.length,1)
 }finally{l.close()}
})
