import { ipcMain, powerMonitor } from 'electron'
import { z } from 'zod'
import { call } from '../data-client'
import { getMainWindow } from '../window'
import { isTrustedSender } from '../guard'
import { ReadingController } from './reading'
import type { AnalyticsSettings } from '../../shared/analytics'
export async function recordOperation(kind:'import'|'export'|'search'|'annotation'|'comment'|'cache_hit'|'error',status:'completed'|'failed'|'cancelled'='completed',count=1):Promise<void>{
 try{await call('analytics.operation',{kind,status,count})}catch{/* Local usage statistics never block the user's operation. */}
}
export function registerAnalyticsIpc():{reset():void}{
 const controller=new ReadingController(s=>call('analytics.reading',s as unknown as Record<string,unknown>))
 let attached:Electron.BrowserWindow|null=null
 const reset=()=>controller.reset()
 powerMonitor.on('suspend',reset);powerMonitor.on('lock-screen',reset)
 const handlers:Record<string,(p:Record<string,unknown>)=>Promise<unknown>>={
  snapshot:p=>call('analytics.snapshot',p),
  settings:async p=>{const result=await call<AnalyticsSettings>('analytics.settings',p.enabled===undefined?{}:{enabled:z.boolean().parse(p.enabled)});reset();return result},
  clear:async()=>{reset();return call('analytics.clear')},
  export:()=>call('analytics.export'),
  classifications:p=>call('analytics.classifications',{itemId:z.string().uuid().parse(p.itemId)}),
  classify:p=>call('analytics.classify',p),
  heartbeat:async p=>{
   const value=z.object({documentVersionId:z.string().uuid(),pageIndex:z.number().int().min(0).max(100000),visible:z.boolean(),active:z.boolean()}).parse(p)
   const win=getMainWindow()
   if(win&&win!==attached){attached=win;win.on('blur',reset);win.on('minimize',reset);win.on('closed',reset);win.webContents.on('render-process-gone',reset);win.webContents.on('did-start-navigation',reset)}
   const eligible=!!win&&!win.isDestroyed()&&win.isFocused()&&win.isVisible()&&!win.isMinimized()&&powerMonitor.getSystemIdleTime()<60
   return controller.heartbeat(value,eligible)
  }
 }
 for(const [name,fn] of Object.entries(handlers))ipcMain.handle('analytics:'+name,async(event,raw)=>{
  if(!isTrustedSender(event))return {ok:false,error:{code:'UNTRUSTED',message:'调用方校验失败',retryable:false}}
  try{return {ok:true,data:await fn((raw??{}) as Record<string,unknown>)}}
  catch(e){return {ok:false,error:{code:'ANALYTICS',message:e instanceof Error?e.message:'统计操作失败',retryable:true}}}
 })
 return {reset}
}
