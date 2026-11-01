import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { call } from '../data-client'
import type { ResolvedDocument } from '../../data-service/repo'
import { registerDocument, revokeDocument } from '../protocol'
import type { IndexTask } from '../../shared/m4'

/** PDF extraction uses Chromium + the packaged PDF.js worker, with no Node DOM shims. */
export class PdfIndexer {
 constructor(private cancelTasks:()=>void=()=>undefined){}
 private win: BrowserWindow | null=null
 private active: {id:string;token:string}|null=null
 private starting=false
 private disposed=false
 private generation=0
 get running(): boolean { return this.starting || !!this.win }
 trusted(sender: Electron.WebContents): boolean { return !!this.win && !this.win.isDestroyed() && sender===this.win.webContents }
 async start(retry=false): Promise<boolean> {
  if(this.disposed)throw new Error('应用正在退出')
  if(this.running)return true
  const run=++this.generation
  this.starting=true
  try {
   await call('m4.indexReset',{retry})
   if(this.disposed || run!==this.generation)return false
   const win=new BrowserWindow({show:false,webPreferences:{preload:join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false}})
   this.win=win
   win.webContents.setWindowOpenHandler(()=>({action:'deny'}))
   win.webContents.on('will-navigate',event=>event.preventDefault())
   win.webContents.on('render-process-gone',()=>{void this.stop().catch(()=>undefined)})
   win.on('closed',()=>{if(this.win===win)this.win=null;this.release()})
   const dev=process.env['ELECTRON_RENDERER_URL']
   if(dev)await win.loadURL(`${dev}?view=indexer`)
   else await win.loadFile(join(__dirname,'../renderer/index.html'),{query:{view:'indexer'}})
   return true
  } catch(e) { if(run===this.generation)await this.stop();throw e } finally {if(run===this.generation)this.starting=false}
 }
 private release():void {if(this.active)revokeDocument(this.active.token);this.active=null}
 async next(): Promise<IndexTask|null> {
  if(this.active)throw new Error('已有索引文档正在处理')
  for(let batch=0;batch<10000;batch++) {
   if(!this.win)return null
   const pending=await call<number>('m4.syncMetadata')
   if(!pending)break
  }
  for(let attempt=0;attempt<100;attempt++) {
   const task=await call<{documentVersionId:string;fingerprint:string;title:string;completedPages:number[]}|null>('m4.indexNext')
   if(!this.win || this.disposed)return null
   if(!task){setTimeout(()=>{void this.stop().catch(()=>undefined)},0);return null}
   let resolved:ResolvedDocument|null;try{resolved=await call<ResolvedDocument|null>('documents.resolve',{documentVersionId:task.documentVersionId})}catch(e){await call('m4.indexFinish',{id:task.documentVersionId,pageCount:0,error:e instanceof Error?e.message:'附件不可用'});continue}
   if(!resolved){await call('m4.indexFinish',{id:task.documentVersionId,pageCount:0,error:'附件不可用，请重新定位文件后重试'});continue}
   if(!this.win || this.disposed)return null
   const token=registerDocument(resolved.absPath,resolved.identity);this.active={id:task.documentVersionId,token}
   return {...task,token}
  }
  throw new Error('连续附件不可用，索引已暂停')
 }
 check(id:string):void {if(!this.active||this.active.id!==id)throw new Error('索引任务已结束或版本不匹配')}
 finish():void {this.release()}
 async stop(): Promise<boolean> {
  if(this.disposed)return true
  this.generation++;this.starting=false
  this.release();const win=this.win;this.win=null
  if(win&&!win.isDestroyed())win.destroy()
  await call('m4.indexReset',{retry:false})
  return true
 }
 destroy():void {this.cancelTasks();this.disposed=true;this.generation++;this.starting=false;this.release();this.win?.destroy();this.win=null}
}
