/** IPC 与数据服务的统一结果包装。错误不抛到渲染层。 */

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail(code: string, message: string, retryable = false): Result<never> {
  return { ok: false, error: { code, message, retryable } }
}

/** 数据服务进程的消息协议 */
export interface ServiceRequest {
  id: string
  method: string
  params: unknown
}

export interface ServiceResponse {
  id: string
  ok: boolean
  data?: unknown
  error?: { code: string; message: string }
}

export const CHANNELS = {
  libraryStats: 'library:stats',
  libraryList: 'library:list',
  libraryItem: 'library:item',
  libraryUpdate: 'library:update',
  libraryDelete: 'library:delete',
  collectionsList: 'collections:list',
  collectionsCreate: 'collections:create',
  collectionsRename: 'collections:rename',
  tagsList: 'tags:list',
  documentsImport: 'documents:import',
  documentsOpen: 'documents:open',
  documentsSetPageCount: 'documents:setPageCount',
  readingGet: 'reading:get',
  readingSave: 'reading:save',
  backupCreate: 'backup:create',
  backupList: 'backup:list',
  backupRestore: 'backup:restore',
  zoteroDetect: 'zotero:detect',
  zoteroImport: 'zotero:import',
  zoteroRuns: 'zotero:runs',
  serviceHealth: 'service:health'
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
