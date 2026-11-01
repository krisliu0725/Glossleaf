import {fullTextActivity} from './m4/fulltext'
import {z} from 'zod'
import { nativeUi } from './preferences'
import { recordOperation } from './analytics'
import { dialog, ipcMain, app,shell,clipboard } from 'electron'
import { CHANNELS } from '../shared/ipc'
import type { Result } from '../shared/ipc'
import { call } from './data-client'
import { registerDocument } from './protocol'
import { getMainWindow } from './window'
import { isTrustedSender } from './guard'
import type { ResolvedDocument } from '../data-service/repo'

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function fail(code: string, message: string, retryable = false): Result<never> {
  return { ok: false, error: { code, message, retryable } }
}

type Handler = (params: Record<string, unknown>) => Promise<Result<unknown>>

const handlers: Record<string, Handler> = {
  'clipboard:readText':async()=>{const text=await clipboard.readText();if(text.length>50000)return fail('CLIPBOARD_TOO_LONG','剪贴板文字超过 50000 字，请缩短后粘贴');return ok(text)},
  'clipboard:writeText':async p=>{await clipboard.writeText(z.string().max(2000000).parse(p.text));return ok(true)},
  'window:state':async()=>ok({fullScreen:getMainWindow()?.isFullScreen()??false,platform:process.platform}),
  'library:restore':async p=>ok(await call('items.restore',{id:String(p.id)})),
  'documents:attachLocal':async p=>{
   const itemId=z.string().uuid().parse(p.itemId),win=getMainWindow();if(!win)return fail('CLOSED','窗口已关闭')
   const selected=await dialog.showOpenDialog(win,{title:nativeUi('关联本地文件'),properties:['openFile'],filters:[{name:nativeUi('文档'),extensions:['pdf','epub']}]})
   if(selected.canceled||!selected.filePaths.length)return ok({canceled:true})
   await call('documents.attachLocal',{itemId,file:selected.filePaths[0]},300000);return ok({canceled:false})
  },
  'documents:relink':async p=>{
   const documentVersionId=z.string().uuid().parse(p.documentVersionId),win=getMainWindow();if(!win)return fail('CLOSED','窗口已关闭')
   const selected=await dialog.showOpenDialog(win,{title:nativeUi('重新定位原文件'),properties:['openFile'],filters:[{name:nativeUi('文档'),extensions:['pdf','epub','caj']}]})
   if(selected.canceled||!selected.filePaths.length)return ok({canceled:true})
   await call('documents.relink',{documentVersionId,file:selected.filePaths[0]},300000);return ok({canceled:false})
  },
  'documents:print':async p=>{const r=await call<ResolvedDocument|null>('documents.resolve',{documentVersionId:z.string().uuid().parse(p.documentVersionId)});if(!r||r.contentType!=='application/pdf')return fail('UNSUPPORTED_FORMAT','仅支持打印 PDF 原件');const error=await shell.openPath(r.absPath);if(error)return fail('PRINT_OPEN_FAILED',error);return ok(true)},
  'documents:reveal':async p=>{const r=await call<ResolvedDocument|null>('documents.resolve',{documentVersionId:String(p.documentVersionId)});if(!r)return fail('NOT_FOUND','附件不可用或尚未取得文件');shell.showItemInFolder(r.absPath);return ok(true)},
  [CHANNELS.serviceHealth]: async () => ok(await call('health')),

  [CHANNELS.libraryStats]: async () => ok(await call('stats')),

  [CHANNELS.libraryList]: async (p) =>
    ok(
      await call('items.list', {
        collectionId: (p.collectionId as string | null) ?? null,
        recent: !!p.recent,unfiled:!!p.unfiled,trash:!!p.trash,
        query: (p.query as string | null) ?? null,
        limit: p.limit as number | undefined,
        offset: p.offset as number | undefined
      })
    ),

  [CHANNELS.libraryItem]: async (p) => ok(await call('items.get', { id: String(p.id),includeDeleted:!!p.includeDeleted })),

  [CHANNELS.libraryUpdate]: async (p) => {
    await call('items.update', { id: String(p.id), patch: p.patch ?? {} })
    return ok(await call('items.get', { id: String(p.id),includeDeleted:!!p.includeDeleted }))
  },

  [CHANNELS.libraryDelete]: async (p) => {
    await call('items.delete', { id: String(p.id) })
    return ok(true)
  },

  [CHANNELS.collectionsList]: async () => ok(await call('collections.list')),

  [CHANNELS.collectionsCreate]: async (p) =>
    ok(await call('collections.create', { name: String(p.name), parentId: p.parentId ?? null })),

  [CHANNELS.collectionsRename]: async (p) => {
    await call('collections.rename', { id: String(p.id), name: String(p.name) })
    return ok(true)
  },

  [CHANNELS.tagsList]: async () => ok(await call('tags.list')),

  [CHANNELS.documentsImport]: async (p) => {
    let files = (p.files as string[] | undefined) ?? []
    let canceled = false

    if (files.length === 0) {
      const win = getMainWindow()
      const result = win
        ? await dialog.showOpenDialog(win, {
            title: nativeUi('导入文献文件'),
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: nativeUi('文档'), extensions: ['pdf', 'epub'] }]
          })
        : { canceled: true, filePaths: [] as string[] }
      canceled = result.canceled
      files = result.filePaths
    }

    if (files.length === 0) return ok({ imported: [], canceled })
    const imported = await call('documents.import', { files }, 300_000)
    return ok({ imported, canceled: false })
  },

  [CHANNELS.documentsOpen]: async (p) => {
    const documentVersionId = String(p.documentVersionId)
    const resolved = await call<ResolvedDocument | null>('documents.resolve', { documentVersionId })
    if (!resolved) return fail('NOT_FOUND', '附件不可用或尚未取得文件')
    if(resolved.contentType!=='application/pdf')return fail('UNSUPPORTED_FORMAT','此格式可作为附件保存，暂不支持在应用内阅读。')

    const token = registerDocument(resolved.absPath,resolved.identity)
    return ok({
      token,
      documentVersionId,
      documentId: resolved.documentId,
      itemId: resolved.itemId,
      displayName: resolved.displayName,
      contentType: resolved.contentType,
      pageCount: resolved.pageCount
    })
  },

  [CHANNELS.backupCreate]: async () =>
    ok(await call('backup.create', { includeBlobs: true }, 600_000)),

  [CHANNELS.backupList]: async () => ok(await call('backup.list')),

  [CHANNELS.backupRestore]: async (p) =>
    ok(await call('backup.restore', { id: String(p.id) }, 600_000)),

  [CHANNELS.documentsSetPageCount]: async (p) => {
    await call('documents.setPageCount', {
      documentVersionId: String(p.documentVersionId),
      pageCount: Number(p.pageCount)
    })
    return ok(true)
  },

  [CHANNELS.readingGet]: async (p) =>
    ok(await call('reading.get', { documentVersionId: String(p.documentVersionId) })),

  [CHANNELS.readingSave]: async (p) => {
    await call('reading.save', {
      documentVersionId: String(p.documentVersionId),
      state: p.state ?? {}
    })
    return ok(true)
  },

  [CHANNELS.zoteroDetect]: async () => ok(await call('zotero.detect', {}, 30_000)),

  [CHANNELS.zoteroImport]: async () => ok(await call('zotero.import', {}, 900_000)),

  [CHANNELS.zoteroRuns]: async () => ok(await call('zotero.runs'))
}

export function registerIpcHandlers(beforeRestore?:()=>Promise<void>): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, params: unknown) => {
      if (!isTrustedSender(event)) {
        return fail('UNTRUSTED_SENDER', '调用方校验失败')
      }
      try {
        if(channel===CHANNELS.backupRestore){
          if(fullTextActivity.restoring||fullTextActivity.downloads)throw new Error('请先等待全文下载完成或取消下载，再恢复备份')
          fullTextActivity.restoring=true
          try{await beforeRestore?.();return await handler((params ?? {}) as Record<string,unknown>)}finally{fullTextActivity.restoring=false}
        }
        return await handler((params ?? {}) as Record<string, unknown>)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        void recordOperation('error', 'failed')
        return fail('DATA_SERVICE', message, true)
      }
    })
  }

  ipcMain.handle('app:info', () => ok({ version: app.getVersion(), userData: app.getPath('userData') }))
}
