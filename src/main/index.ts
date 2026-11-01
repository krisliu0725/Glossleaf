import { app, BrowserWindow, ipcMain, nativeTheme, session } from 'electron'
import { join } from 'node:path'
import { handleDocumentProtocol, registerDocumentScheme, clearDocumentTokens } from './protocol'
import { runSqliteProbe } from './probe/sqlite'
import { findSamplePdf } from './probe/sample'
import { createMainWindow, getMainWindow } from './window'
import { registerIpcHandlers } from './ipc'
import { startDataService, stopDataService, call } from './data-client'
import { initializePreferences, registerPreferencesIpc } from './preferences'
import { registerAnalyticsIpc } from './analytics'
import { mkdirSync } from 'node:fs'
import { registerM4Ipc } from './m4/ipc'
import type { PdfIndexer } from './m4/indexer'
import { registerTranslationIpc } from './translation/ipc'
import type { TranslationManager } from './translation/manager'
import { isTrustedSender } from './guard'
import type { ProbeReport } from '../shared/types'

let analyticsController: {reset():void} | null = null
let pdfIndexer: PdfIndexer | null = null
let translationManager: TranslationManager | null = null

// Select app/session storage before Chromium initializes caches.
if (process.env['JIAN_USER_DATA_DIR']) {
    mkdirSync(process.env['JIAN_USER_DATA_DIR'], {recursive:true});app.setPath('userData', process.env['JIAN_USER_DATA_DIR']);app.setPath('sessionData',process.env['JIAN_USER_DATA_DIR'])
  } else if (app.isPackaged && !process.env['JIAN_LIBRARY_DIR']) {
    const previewData = join(app.getPath('appData'), 'Jian Preview')
    mkdirSync(previewData, {recursive:true});app.setPath('userData', previewData);app.setPath('sessionData',previewData)
  }

// 必须在 ready 之前注册 scheme
registerDocumentScheme()

function registerProbeIpc(): void {
  ipcMain.handle('probe:run', async (event) => {
    if (!isTrustedSender(event)) {
      return { ok: false as const, error: { code: 'UNTRUSTED_SENDER', message: '调用方校验失败', retryable: false } }
    }
    try {
      const sqlite = await runSqliteProbe()
      const pdfSample = await findSamplePdf()
      const report: ProbeReport = { sqlite, pdfSample, generatedAt: new Date().toISOString() }
      return { ok: true as const, data: report }
    } catch (e) {
      return {
        ok: false as const,
        error: {
          code: 'PROBE_FAILED',
          message: e instanceof Error ? e.message : String(e),
          retryable: true
        }
      }
    }
  })
}

app.whenReady().then(async () => {
  initializePreferences()
  handleDocumentProtocol()
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self' file: jian:; script-src 'self' file:; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: blob: jian:; font-src 'self' file: data: blob:; connect-src 'self' file: jian:; worker-src 'self' file: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"] } })
  })

  // 开发期使用隔离数据目录，避免误碰真实文库（DESIGN.md §15.7）
  const libraryDir = process.env['JIAN_LIBRARY_DIR'] ?? join(app.getPath('userData'), 'library')
  try {
    await startDataService(libraryDir, app.getVersion())
  } catch (e) {
    console.error('[main] 数据服务启动失败：', e)
  }

  registerIpcHandlers(async()=>{if(pdfIndexer?.running||translationManager?.busy)throw Error('请先暂停翻译任务并等待全文索引完成，再恢复备份。');analyticsController?.reset();clearDocumentTokens()})
  registerPreferencesIpc()
  analyticsController = registerAnalyticsIpc()
  translationManager = registerTranslationIpc(libraryDir)
  pdfIndexer = registerM4Ipc(libraryDir)
  registerProbeIpc()

  // 开发期：JIAN_IMPORT=/a.pdf,/b.pdf 时启动即导入，便于端到端验证
  const devImport = process.env['JIAN_IMPORT']
  if (devImport) {
    const files = devImport.split(',').filter(Boolean)
    try {
      const imported = await call('documents.import', { files }, 300_000)
      console.log('[main] 开发期导入完成：', JSON.stringify(imported))
    } catch (e) {
      console.error('[main] 开发期导入失败：', e)
    }
  }

  // 开发期：JIAN_BACKUP=1 / JIAN_RESTORE=<id> 用于端到端验证备份与恢复
  if (process.env['JIAN_BACKUP']) {
    try {
      const created = await call('backup.create', { includeBlobs: true }, 600_000)
      console.log('[main] 备份完成：', JSON.stringify(created))
    } catch (e) {
      console.error('[main] 备份失败：', e)
    }
  }
  if (process.env['JIAN_RESTORE']) {
    try {
      const restored = await call('backup.restore', { id: process.env['JIAN_RESTORE'] }, 600_000)
      console.log('[main] 恢复完成：', JSON.stringify(restored))
    } catch (e) {
      console.error('[main] 恢复失败：', e)
    }
  }

  // 开发期：JIAN_ZOTERO_IMPORT=1 触发一次 Zotero 迁移并打印报告
  if (process.env['JIAN_ZOTERO_IMPORT']) {
    try {
      const report = await call('zotero.import', {}, 900_000)
      console.log('[main] Zotero 导入完成：', JSON.stringify(report))
    } catch (e) {
      console.error('[main] Zotero 导入失败：', e)
    }
  }

  const mainWindow = createMainWindow()
  mainWindow.on('closed', () => { translationManager?.cancelInteractive(); void pdfIndexer?.stop().catch(() => undefined) })
  void pdfIndexer.start().catch(e => console.error('[indexer]', e instanceof Error ? e.message : '索引失败'))

  // 开发期自检：JIAN_CAPTURE=/path/to.png 时截图并退出，用于核对界面样稿
  const capturePath = process.env['JIAN_CAPTURE']
  if (capturePath) {
    setTimeout(() => {
      const win = getMainWindow()
      if (!win) {
        app.quit()
        return
      }
      void win.webContents
        .executeJavaScript(
          "({ modal: !!document.querySelector('.modal-backdrop'), flag: document.querySelector('.workspace')?.dataset.zoteroOpen ?? null, kids: document.body.children.length, search: location.search })"
        )
        .then((info) => console.log('[capture]', JSON.stringify(info)))
        .catch(() => undefined)
      void win.webContents
        .capturePage()
        .then((image) => import('node:fs').then((fs) => fs.writeFileSync(capturePath, image.toPNG())))
        .finally(() => app.quit())
    }, Number(process.env['JIAN_CAPTURE_DELAY'] ?? 5000))
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })

  nativeTheme.on('updated', () => {
    getMainWindow()?.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  analyticsController?.reset()
  pdfIndexer?.destroy()
  clearDocumentTokens()
  translationManager?.stop()
  // 给数据服务一个关闭连接的机会，再真正退出
  void stopDataService().finally(() => app.quit())
})
