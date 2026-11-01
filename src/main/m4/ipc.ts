import {downloadFullText,cleanupDownloadStaging,fullTextActivity} from './fulltext'
import type {ItemDetail} from '../../shared/domain'
import { nativeUi, nativeLocale } from '../preferences'
import { recordOperation } from '../analytics'
import { ipcMain, dialog, clipboard, ClipboardItem } from 'electron'
import { writeFile, rename, rm } from 'node:fs/promises'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { call } from '../data-client'
import { isTrustedSender } from '../guard'
import { getMainWindow } from '../window'
import { metadataSchema } from '../../shared/metadata'
import {resolveDoi,findMetadata} from './metadata'
import { buildExport } from './exports'
import { PdfIndexer } from './indexer'
import type { ExportRow } from '../../data-service/m4'
import type { ExportFormat, SearchQuery, CitationStyle } from '../../shared/m4'
const uuid=z.string().uuid(),idsSchema=z.array(uuid).min(1).max(500)
const formatSchema=z.enum(['csl-json','bibtex','markdown','excerpts-json','citation','ris','bibliography-html'])
const styleSchema=z.enum(['gbt','apa','mla','chicago','ieee']).default('gbt')
export function registerM4Ipc(libraryDir:string):PdfIndexer {
 const downloads=new Map<string,AbortController>(),stagingReady=cleanupDownloadStaging(libraryDir).catch(()=>undefined)
 let doiController:AbortController|null=null,lastLookup=0
 const indexer=new PdfIndexer(()=>{doiController?.abort();for(const controller of downloads.values())controller.abort()})
 const preview=async(ids:string[],format:ExportFormat,style:CitationStyle='gbt')=>buildExport(await call<ExportRow[]>('m4.exportData',{ids}),format,nativeLocale(),style)
 const handlers:Record<string,(p:Record<string,unknown>)=>Promise<unknown>>={
  search:async p=>call('m4.search',z.object({query:z.string().max(300),scope:z.enum(['all','metadata','body','excerpts']),collectionId:uuid.nullable().optional(),documentVersionId:uuid.optional(),cursor:z.number().int().min(0).max(10000000).optional()}).parse(p) as SearchQuery & Record<string,unknown>),
  indexStats:async()=>({...await call<Record<string,unknown>>('m4.indexStats'),running:indexer.running}),
  indexStart:async p=>indexer.start(z.boolean().optional().parse(p.retry)),
  indexStop:async()=>indexer.stop(),
  indexNext:async()=>indexer.next(),
  indexPage:async p=>{const v=z.object({documentVersionId:uuid,pageIndex:z.number().int().min(0).max(9999),text:z.string().max(150000),runs:z.array(z.object({start:z.number().int().min(0),end:z.number().int().min(0),rect:z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()])})).max(30000)}).parse(p);indexer.check(v.documentVersionId);return call('m4.indexPage',v)},
  indexFinish:async p=>{const v=z.object({id:uuid,pageCount:z.number().int().min(0).max(10000),error:z.string().max(2000).optional()}).parse(p);indexer.check(v.id);try{return await call('m4.indexFinish',v)}finally{indexer.finish()}},
  downloadFullText:async p=>{
   await stagingReady
   if(fullTextActivity.restoring)throw new Error('正在恢复备份，请稍后再试')
   const id=uuid.parse(p.itemId);if(downloads.has(id))throw new Error('此文献正在下载全文')
   const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);downloads.set(id,controller);fullTextActivity.downloads++
   try{const item=await call<ItemDetail|null>('items.get',{id});if(!item)throw new Error('文献不存在');return await downloadFullText(item,libraryDir,signal,(file,source)=>call('documents.attachDownloaded',{file,source,itemId:id}))}
   catch(e){if(signal.aborted)return {status:'unavailable',message:controller.signal.aborted?'下载已取消，文献记录已保留':'下载超时，文献记录已保留'};throw e}
   finally{downloads.delete(id);fullTextActivity.downloads--}
  },
  downloadCancel:async p=>{downloads.get(uuid.parse(p.itemId))?.abort();return true},
  metadataHints:async p=>call('m4.metadataHints',{id:uuid.parse(p.id)}),
  metadataCandidates:async p=>{
   const query=z.string().trim().min(1).max(500).parse(p.query);doiController?.abort();const controller=new AbortController();doiController=controller
   const delay=Math.max(0,600-(Date.now()-lastLookup));if(delay)await new Promise(r=>setTimeout(r,delay));if(controller.signal.aborted)throw new Error('查询已取消')
   lastLookup=Date.now();const found=await findMetadata(query,controller.signal);return Promise.all(found.map(async candidate=>({...candidate,duplicates:await call('m4.duplicates',{doi:candidate.doi})})))
  },
  doiPreview:async p=>{
   const raw=z.string().max(1000).parse(p.doi);doiController?.abort();const controller=new AbortController();doiController=controller
   const delay=Math.max(0,600-(Date.now()-lastLookup));if(delay)await new Promise(r=>setTimeout(r,delay));if(controller.signal.aborted)throw new Error('查询已取消')
   lastLookup=Date.now();const result=await resolveDoi(raw,controller.signal);return {...result,duplicates:await call('m4.duplicates',{doi:result.doi})}
  },
  doiCancel:async()=>{doiController?.abort();return true},
  doiCommit:async p=>call('m4.metadataSave',{draft:metadataSchema.parse(p.draft),allowDuplicate:z.boolean().optional().parse(p.allowDuplicate)}),
  metadataSave:async p=>{await call('m4.metadataSave',{id:uuid.parse(p.id),draft:metadataSchema.parse(p.draft),allowDuplicate:false});return true},
  exportPreview:async p=>preview(idsSchema.parse(p.ids),formatSchema.parse(p.format),styleSchema.parse(p.style)),
  exportSave:async p=>{
   const data=await preview(idsSchema.parse(p.ids),formatSchema.parse(p.format),styleSchema.parse(p.style)),win=getMainWindow();if(!win)throw new Error('窗口已关闭')
   const result=await dialog.showSaveDialog(win,{title:nativeUi('导出'),defaultPath:data.filename,filters:[{name:nativeUi('导出文件'),extensions:[data.extension]}]})
   if(result.canceled||!result.filePath)return {canceled:true}
   const temp=result.filePath+'.jian-'+randomUUID()+'.tmp'
   try{await writeFile(temp,data.content,{encoding:'utf8',flag:'wx'});await rename(temp,result.filePath)}finally{await rm(temp,{force:true})}
   void recordOperation('export')
   return {canceled:false,path:result.filePath}
  },
  copyCitation:async p=>{const data=await preview(idsSchema.parse(p.ids),'citation',styleSchema.parse(p.style));if(z.enum(['bibliography','in-text']).default('bibliography').parse(p.part)==='in-text')await clipboard.writeText(data.inText??'');else await clipboard.write([new ClipboardItem({'text/plain':data.content,'text/html':data.html??''})]);void recordOperation('export');return true}
 }
 for(const [name,fn]of Object.entries(handlers))ipcMain.handle('m4:'+name,async(event,raw)=>{
  const worker=['indexNext','indexPage','indexFinish'].includes(name)
  const trusted=worker?indexer.trusted(event.sender)&&event.senderFrame===event.sender.mainFrame:isTrustedSender(event)
  if(!trusted)return {ok:false,error:{code:'UNTRUSTED',message:'调用方校验失败',retryable:false}}
  try{return {ok:true,data:await fn(raw??{})}}catch(e){return {ok:false,error:{code:'M4',message:e instanceof Error?e.message:'操作失败',retryable:true}}}
 })
 return indexer
}
