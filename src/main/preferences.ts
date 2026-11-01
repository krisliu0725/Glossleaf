import {COLOR_SCHEME_IDS,colorScheme as resolveColorScheme,type ColorSchemeId} from '../shared/appearance'
import logoPalettes from '../shared/logo-palettes.json'
import type {LogoPaletteId} from '../shared/preferences'
import { DEFAULT_READER,type ReaderPreferences } from '../shared/reader'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { isTrustedSender } from './guard'
import { getMainWindow } from './window'
import { call } from './data-client'
import { recordOperation } from './analytics'
import { localize } from '../shared/localization'
import type { AppPreferences, Diagnostics } from '../shared/preferences'
const themeSchema=z.enum(['system','light','dark'])
let colorScheme:ColorSchemeId='paper'
const colorSchemeSchema=z.enum(COLOR_SCHEME_IDS)
let logoPalette:LogoPaletteId='ink-vermilion'
const logoSchema=z.enum(['ink-vermilion','teal-vermilion','ink-ochre','tea-vermilion','teal-ochre','vermilion-ink'])
let reader:ReaderPreferences={...DEFAULT_READER}
const readerSchema=z.object({defaultMode:z.enum(['source','bilingual']),defaultZoom:z.number().min(.5).max(4),glossSize:z.number().int().min(15).max(19),paperTint:z.boolean(),statusDots:z.boolean(),track:z.enum(['current','all']),autoTranslate:z.boolean(),inlineEnabled:z.boolean(),showIgnored:z.boolean(),split:z.number().min(40).max(70)})
let theme:'system'|'light'|'dark'='system'
let locale: 'zh' | 'en' | null = null
export function nativeLocale(): 'zh' | 'en' {return locale ?? 'zh'}
export function nativeUi(value: string): string { return localize(value, locale ?? 'zh') }
function preferences():AppPreferences{return {logoPalette,colorScheme,theme,dark:nativeTheme.shouldUseDarkColors,locale,reader}}
export function initializePreferences():void {
 const file=join(app.getPath('userData'),'preferences.json')
 try {if(existsSync(file)){const saved=JSON.parse(readFileSync(file,'utf8'));colorScheme=resolveColorScheme(saved.colorScheme).id;logoPalette=logoPalettes.some(p=>p.id===saved.logoPalette)?saved.logoPalette:'ink-vermilion';theme=themeSchema.parse(saved.theme??'system');reader=readerSchema.parse({...DEFAULT_READER,...saved.reader});locale=z.enum(['zh','en']).nullable().parse(saved.locale??null)}}catch{theme='system'}
 nativeTheme.themeSource=theme
}
async function diagnostics():Promise<Diagnostics>{
 const health=await call<{ready:boolean;sqliteVersion?:string}>('health').catch(()=>null)
 const index=await call<Diagnostics['index']>('m4.indexStats').catch(()=>null)
 const metadata=await call<{schemaVersion:number}>('app.diagnostics').catch(()=>null)
 const memory=await process.getProcessMemoryInfo().catch(()=>null)
 return {generatedAt:new Date().toISOString(),appVersion:app.getVersion(),platform:process.platform,architecture:process.arch,electron:process.versions.electron,node:process.versions.node,schemaVersion:metadata?.schemaVersion??null,serviceReady:health?.ready??false,rendererCount:BrowserWindow.getAllWindows().length,memory:memory?{workingSetKb:memory.residentSet??0,privateKb:memory.private}:null,index:index?{total:index.total,completed:index.completed,failed:index.failed,pages:index.pages}:null,scope:nativeUi('应用状态摘要；不包含文件路径、文献正文、API Key、端点或使用明细')}
}
async function save(content:string,filename:string):Promise<{canceled:boolean;path?:string}>{
 const win=getMainWindow();if(!win)throw new Error('窗口已关闭')
 const result=await dialog.showSaveDialog(win,{title:nativeUi('保存数据'),defaultPath:filename,filters:[{name:'JSON',extensions:['json']}]})
 if(result.canceled||!result.filePath)return {canceled:true}
 const temp=result.filePath+'.jian-'+randomUUID()+'.tmp'
 try {await writeFile(temp,content,{encoding:'utf8',flag:'wx',mode:0o600});await rename(temp,result.filePath)}finally{await rm(temp,{force:true})}
 return {canceled:false,path:result.filePath}
}
export function registerPreferencesIpc():void{
 const handlers:Record<string,(value:Record<string,unknown>)=>Promise<unknown>>={
  get:async()=>preferences(),
  set:async value=>{const next=z.object({colorScheme:colorSchemeSchema.optional(),logoPalette:logoSchema.optional(),theme:themeSchema.optional(),locale:z.enum(['zh','en']).optional(),reader:readerSchema.partial().optional()}).strict().refine(v=>v.colorScheme!==undefined||v.logoPalette!==undefined||v.theme!==undefined||v.locale!==undefined||v.reader!==undefined).parse(value);const nextReader={...reader,...next.reader};const nextTheme=next.theme??theme;const nextLocale=next.locale??locale;const root=app.getPath('userData');mkdirSync(root,{recursive:true});const file=join(root,'preferences.json');writeFileSync(file+'.tmp',JSON.stringify({colorScheme:next.colorScheme??colorScheme,theme:nextTheme,locale:nextLocale,reader:nextReader,logoPalette:next.logoPalette??logoPalette}),{mode:0o600});renameSync(file+'.tmp',file);colorScheme=next.colorScheme??colorScheme;logoPalette=next.logoPalette??logoPalette;theme=nextTheme;locale=nextLocale;reader=nextReader;nativeTheme.themeSource=theme;getMainWindow()?.webContents.send('theme:changed',nativeTheme.shouldUseDarkColors);return preferences()},
  diagnostics:()=>diagnostics(),
  saveDiagnostics:async()=>save(JSON.stringify(await diagnostics(),null,2),'jian-diagnostics.json'),
  saveUsage:async()=>{const result=await save(String(await call('analytics.export')),'jian-usage.json');if(!result.canceled)recordOperation('export');return result}
 }
 for(const[name,fn]of Object.entries(handlers))ipcMain.handle('preferences:'+name,async(event,value)=>{
  if(!isTrustedSender(event))return {ok:false,error:{code:'UNTRUSTED',message:'调用方校验失败',retryable:false}}
  try{return {ok:true,data:await fn(value??{})}}catch(e){return {ok:false,error:{code:'PREFERENCES',message:e instanceof Error?e.message:'操作失败',retryable:true}}}
 })
}
