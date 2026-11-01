/** Deterministic demo evidence only. This helper is never imported by the application. */
import { randomUUID } from 'node:crypto'
import { openLibrary } from '../../src/data-service/db'
import { importPdf,updateItem } from '../../src/data-service/repo'
import { dispatchM4 } from '../../src/data-service/m4'
import { recordReading,recordAttempt,dispatchAnalytics,recordOperation } from '../../src/data-service/analytics'
async function run():Promise<void>{
 const [dir,first,second]=process.argv.slice(2),db=openLibrary(dir),now=Date.now(),since=new Date(now-35*86400000).toISOString()
 db.run("INSERT OR REPLACE INTO meta VALUES('analytics_since',?)",[since])
 for(const [i,file] of [first,second].entries()){
  const [doc]=await importPdf(db,dir,[file]);updateItem(db,doc.itemId,{title:i?'能源转型与制度选择':'研究设计与证据解释',date:'2026-10-29'})
  dispatchM4(db,'m4.indexReset',{});const task=dispatchM4(db,'m4.indexNext',{}) as {documentVersionId:string}|null
  if(task)for(let page=0;page<2;page++)dispatchM4(db,'m4.indexPage',{documentVersionId:task.documentVersionId,pageIndex:page,text:('Evidence interpretation and research. 外交与能源的研究方法。 ').repeat(20),runs:[{start:0,end:50,rect:[50,50,500,80]}]})
  if(task)dispatchM4(db,'m4.indexFinish',{id:task.documentVersionId,pageCount:2})
  dispatchAnalytics(db,'analytics.classify',{itemId:doc.itemId,topics:i?['能源转型','制度研究']:['研究方法','国际关系'],field:i?'环境政治':'政治学'})
  for(let day=1;day<29;day++){
   const start=now-day*86400000+ i*3600000,sessionId=randomUUID(),count=20+day%8
   recordReading(db,{id:randomUUID(),sessionId,documentVersionId:doc.documentVersionId,pageIndex:day%2,startedAt:new Date(start).toISOString(),finishedAt:new Date(start).toISOString(),visit:true})
   for(let n=0;n<count;n++)recordReading(db,{id:randomUUID(),sessionId,documentVersionId:doc.documentVersionId,pageIndex:day%2,startedAt:new Date(start+n*10000).toISOString(),finishedAt:new Date(start+(n+1)*10000).toISOString(),visit:false})
   const input=400+day*17,output=200+day*9
   recordAttempt(db,{id:randomUUID(),operationId:randomUUID(),attempt:1,startedAt:new Date(start).toISOString(),finishedAt:new Date(start+2000).toISOString(),provider:i?'gemini':'compatible',endpointHost:i?'generativelanguage.googleapis.com':'api.deepseek.com',model:i?'gemma-4-26b-a4b-it':'deepseek-flash',purpose:day%3===0?'background':'interactive',status:day%11===0?'failed':'completed',httpStatus:200,inputTokens:day%5===0?null:input,outputTokens:day%5===0?null:output,totalTokens:day%5===0?null:input+output,cachedInputTokens:null,reasoningTokens:null,estimatedInputTokens:input-5,estimatedOutputTokens:output-7})
  }
 }
 recordOperation(db,'import','completed',2)
 db.close()
}
void run().catch(e=>{console.error(e);process.exitCode=1})
