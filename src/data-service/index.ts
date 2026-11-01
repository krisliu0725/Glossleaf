import {normalizeAnnotationComments} from './annotations'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { openLibrary, type Db } from './db'
import { SCHEMA_VERSION } from './schema'
import * as repo from './repo'
import { dispatchM4 } from './m4'
import { dispatchAnalytics, analyticsSettings, recordOperation } from './analytics'
import { dispatchM3 } from './m3'
import * as backup from './backup'
import { importZotero } from '../adapters/zotero/importer'
import { isZoteroRunning } from '../adapters/zotero/snapshot'
import type { ServiceRequest, ServiceResponse } from '../shared/ipc'

/**
 * 独立数据服务进程（Electron utilityProcess）。
 * 全应用唯一的 SQLite 写连接在这里，主进程与渲染进程都不直接碰数据库。
 * 见 DESIGN.md §9.2。
 */

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort

let db: Db | null = null
let libraryDir = ''
let appVersion = '0.1.0'
let activeRequests=0,restoring=false

function requireDb(): Db {
  if (!db) throw new Error('数据服务尚未初始化')
  return db
}

function requireDir(): string {
  if (!libraryDir) throw new Error('数据服务尚未初始化')
  return libraryDir
}

type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>

const handlers: Record<string, Handler> = {
  init: (p) => {
    libraryDir = String(p.libraryDir)
    appVersion = String(p.appVersion ?? '0.1.0')
    db?.close()
    db = openLibrary(libraryDir)
    normalizeAnnotationComments(db)
    analyticsSettings(db)
    db.run("UPDATE job SET status='paused' WHERE kind='translation' AND status IN ('running','queued')")
    return { libraryDir, file: db.file }
  },

  health: () => {
    let sqliteVersion: string | null = null
    try {
      sqliteVersion = String(requireDb().get('SELECT sqlite_version() AS v')?.v ?? '')
    } catch {
      /* 未初始化时保持 null */
    }
    return {
      ready: db !== null,
      libraryDir,
      sqliteVersion,
      node: process.versions.node,
      electron: process.versions.electron ?? null
    }
  },

  'stats': () => repo.stats(requireDb()),
  'app.diagnostics': () => ({schemaVersion: SCHEMA_VERSION}),

  // 退出前显式关闭，让 SQLite 完成 WAL checkpoint，避免下次打开依赖恢复
  shutdown: () => {
    db?.close()
    db = null
    return true
  },

  'items.list': (p) =>
    repo.listItems(requireDb(), {
      collectionId: (p.collectionId as string | null) ?? null,
      recent: !!p.recent,unfiled:!!p.unfiled,trash:!!p.trash,
      query: (p.query as string | null) ?? null,
      limit: p.limit as number | undefined,
      offset: p.offset as number | undefined
    }),

  'items.get': (p) => repo.getItem(requireDb(), String(p.id),!!p.includeDeleted),

  'items.update': (p) => {
    repo.updateItem(requireDb(), String(p.id), p.patch as Parameters<typeof repo.updateItem>[2])
    return true
  },

  'items.restore':p=>repo.restoreItem(requireDb(),String(p.id)),
  'items.delete': (p) => {
    repo.softDeleteItem(requireDb(), String(p.id))
    return true
  },

  'collections.list': () => repo.listCollections(requireDb()),

  'collections.create': (p) =>
    repo.createCollection(requireDb(), String(p.name), (p.parentId as string | null) ?? null),

  'collections.rename': (p) => {
    repo.renameCollection(requireDb(), String(p.id), String(p.name))
    return true
  },

  'collections.addItem': (p) => {
    repo.addItemToCollection(requireDb(), String(p.collectionId), String(p.itemId))
    return true
  },

  'tags.list': () => repo.listTags(requireDb()),

  // ---------- Zotero 迁移 ----------
  'zotero.detect': async () => {
    const sourceDir = process.env['JIAN_ZOTERO_DIR'] ?? join(homedir(), 'Zotero')
    const dbPath = join(sourceDir, 'zotero.sqlite')
    let exists = false
    let size: number | null = null
    try {
      const st = await fs.stat(dbPath)
      exists = st.isFile()
      size = st.size
    } catch {
      /* 不存在 */
    }
    const running = exists ? await isZoteroRunning() : false
    const last = requireDb().get(
      `SELECT id, status, startedAt, finishedAt, countsJson, error FROM import_run
        WHERE sourceInstanceId IS NOT NULL ORDER BY startedAt DESC LIMIT 1`
    )
    return {
      sourceDir,
      dbPath,
      exists,
      byteSize: size,
      running,
      lastRun: last
        ? {
            id: String(last.id),
            status: String(last.status),
            startedAt: String(last.startedAt),
            finishedAt: (last.finishedAt as string | null) ?? null,
            counts: last.countsJson ? JSON.parse(String(last.countsJson)) : null,
            error: (last.error as string | null) ?? null
          }
        : null
    }
  },

  'zotero.import': async () => {
    const sourceDir = process.env['JIAN_ZOTERO_DIR'] ?? join(homedir(), 'Zotero')
    const workRoot = join(requireDir(), '.tmp')
    await fs.mkdir(workRoot, { recursive: true })
    return importZotero(requireDb(), requireDir(), sourceDir, workRoot)
  },

  'zotero.runs': () =>
    requireDb()
      .all(
        `SELECT id, status, startedAt, finishedAt, countsJson, conflictsJson, error
           FROM import_run ORDER BY startedAt DESC LIMIT 20`
      )
      .map((r) => ({
        id: String(r.id),
        status: String(r.status),
        startedAt: String(r.startedAt),
        finishedAt: (r.finishedAt as string | null) ?? null,
        counts: r.countsJson ? JSON.parse(String(r.countsJson)) : null,
        conflicts: r.conflictsJson ? JSON.parse(String(r.conflictsJson)) : null,
        error: (r.error as string | null) ?? null
      })),

  'documents.attachLocal':(p)=>repo.importPdf(requireDb(),requireDir(),[String(p.file)],{itemId:String(p.itemId)}),
  'documents.attachDownloaded':async p=>{
   const itemId=String(p.itemId),added=await repo.importPdf(requireDb(),requireDir(),[String(p.file)],{mode:'managed',itemId,adopt:true}),item=repo.getItem(requireDb(),itemId)
   if(added[0]&&item)requireDb().run('UPDATE document SET displayName=? WHERE id=?',[item.title.replace(/[\\/\x00-\x1f]/g,' ').slice(0,160)+'.pdf',added[0].documentId])
   if(item&&typeof p.source==='string')requireDb().run('UPDATE item SET fieldsJson=? WHERE id=?',[JSON.stringify({...item.fields,fullTextSource:p.source,fullTextDownloadedAt:new Date().toISOString()}),itemId])
   return added
  },
  'documents.relink':(p)=>repo.relinkDocument(requireDb(),String(p.documentVersionId),String(p.file)),
  'documents.import': (p) => repo.importPdf(requireDb(), requireDir(), p.files as string[]),

  'documents.resolve': (p) =>
    repo.resolveDocument(requireDb(), requireDir(), String(p.documentVersionId)),

  'documents.setPageCount': (p) => {
    repo.setPageCount(requireDb(), String(p.documentVersionId), Number(p.pageCount))
    return true
  },

  'reading.get': (p) => repo.getReadingState(requireDb(), String(p.documentVersionId)),

  'reading.save': (p) => {
    repo.saveReadingState(
      requireDb(),
      String(p.documentVersionId),
      p.state as Parameters<typeof repo.saveReadingState>[2]
    )
    return true
  },

  'backup.create': (p) =>
    backup.createBackup(requireDb(), requireDir(), {
      appVersion,
      includeBlobs: p.includeBlobs !== false
    }),

  'backup.list': () => backup.listBackups(requireDir()),

  'backup.verify': (p) => {
    return backup.verifyBackup(requireDir(), String(p.id)).then((plan) => ({
      id: plan.id,
      problems: plan.problems,
      counts: plan.manifest?.counts ?? {}
    }))
  },

  'backup.restore': async (p) => {
    const id = String(p.id)
    const plan = await backup.verifyBackup(requireDir(), id)
    if (plan.problems.length > 0) {
      throw new Error(`备份未通过校验：${plan.problems.join('；')}`)
    }
    const current = requireDb()
    current.close()
    db = null
    try{await backup.applyRestore(requireDir(), plan)}finally{db = openLibrary(requireDir())}
    return { id, counts: repo.stats(db) }
  }
}

async function handle(request: ServiceRequest): Promise<ServiceResponse> {
  const fn = request.method.startsWith('analytics.') ? (p: Record<string, unknown>) => dispatchAnalytics(requireDb(), request.method, p) : request.method.startsWith('m4.') ? (p: Record<string, unknown>) => dispatchM4(requireDb(), request.method, p) : request.method.startsWith('m3.') ? (p: Record<string, unknown>) => dispatchM3(requireDb(), request.method, p) : handlers[request.method]
  if (!fn) {
    return {
      id: request.id,
      ok: false,
      error: { code: 'NO_SUCH_METHOD', message: `未知方法：${request.method}` }
    }
  }
  let counted=false,exclusive=false
  try {
    if(restoring)throw new Error('正在恢复备份，请稍后再试')
    if(request.method==='backup.restore'){if(activeRequests)throw new Error('请先等待当前文件操作完成，再恢复备份');restoring=true;exclusive=true}
    else {activeRequests++;counted=true}
    const params = (request.params ?? {}) as Record<string, unknown>
    const previousJobStatus=request.method==='m3.jobSave' ? requireDb().get('SELECT status FROM job WHERE id=?',[params.id])?.status : undefined
    const data = await fn(params)
    try {
      const operations: Record<string,string> = {'m4.search':'search','m3.annotationSave':'annotation','documents.import':'import','zotero.import':'import'}
      if(request.method==='m3.jobSave' && previousJobStatus!==params.status && ['completed','failed'].includes(String(params.status)))recordOperation(requireDb(),params.status==='completed'?'job_completed':'job_failed')
      const operation=operations[request.method]
      if(operation && !(request.method==='m3.annotationSave'&&params.type==='note') && (request.method!=='documents.import'||Array.isArray(data)&&data.length>0))recordOperation(requireDb(),operation)
      if(request.method==='m3.annotationSave' && typeof params.comment==='string' && params.comment.trim())recordOperation(requireDb(),'comment')
    } catch { /* analytics never blocks the requested operation */ }
    return { id: request.id, ok: true, data }
  } catch (e) {
    try { if(db && !request.method.startsWith('analytics.'))recordOperation(db,'error','completed') } catch { /* optional local statistics */ }
    return {
      id: request.id,
      ok: false,
      error: {
        code: 'SERVICE_ERROR',
        message: e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      }
    }
  } finally {if(counted)activeRequests--;if(exclusive)restoring=false}
}

if (!parentPort) {
  // 被误当成普通 Node 脚本执行时，给出明确提示而不是静默挂起
  console.error('[data-service] 未检测到 parentPort，本文件必须由 utilityProcess 启动')
  process.exit(1)
}

parentPort.on('message', (event) => {
  const request = event.data as ServiceRequest
  if (!request || typeof request.id !== 'string' || typeof request.method !== 'string') return
  void handle(request).then((response) => parentPort.postMessage(response))
})

// 初始化目录由主进程通过 init 下发；这里先报告进程已就绪
parentPort.postMessage({ id: 'boot', ok: true, data: { booted: true, pid: process.pid } })
