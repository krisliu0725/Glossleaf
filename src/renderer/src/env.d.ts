import type { ProbeReport } from '@shared/types'
import type {
  BackupSummary,
  CollectionNode,
  DocumentSummary,
  ImportedDocument,
  ItemDetail,
  ItemSummary,
  LibraryStats,
  TagCount
} from '@shared/domain'

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

export interface OpenedDocument {
  token: string
  documentVersionId: string
  documentId: string
  itemId: string | null
  displayName: string
  contentType: string
  pageCount: number | null
}

export interface ZoteroDetect {
  sourceDir: string
  dbPath: string
  exists: boolean
  byteSize: number | null
  running: boolean | null
  lastRun: {
    id: string
    status: string
    startedAt: string
    finishedAt: string | null
    counts: Record<string, number> | null
    error: string | null
  } | null
}

export interface ZoteroImportReport {
  runId: string
  status: 'published' | 'failed'
  source: { path: string; schemaVersion: string | null; fingerprint: string; descriptorReasons: string[] }
  counts: {
    bibliographic: number
    attachments: number
    notes: number
    annotations: number
    collections: number
    tags: number
    created: number
    updated: number
    unchanged: number
    keptLocal: number
    missingFiles: number
    unsupported: number
    skippedTrash: number
    conflicts: number
  }
  warnings: string[]
  conflicts: Array<{ itemKey: string; title: string; field: string }>
  durationMs: number
}

export interface LibraryApi {
  clipboard:{readText():Promise<Result<string>>;writeText(text:string):Promise<Result<boolean>>}
  windowState:{get():Promise<Result<{fullScreen:boolean;platform:string}>>;onChange(cb:(state:{fullScreen:boolean;platform:string})=>void):()=>void}
  preferences: import('@shared/preferences').PreferencesApi
  analytics: import('@shared/analytics').AnalyticsApi
  m4: import('@shared/m4').M4Api
  m3: import('@shared/m3').M3Api
  probe: { run(): Promise<Result<ProbeReport>> }
  theme: { onChange(cb: (dark: boolean) => void): () => void }
  app: { info(): Promise<Result<{ version: string; userData: string }>> }
  service: { health(): Promise<Result<unknown>> }
  library: {
    stats(): Promise<Result<LibraryStats>>
    list(params: {
      unfiled?:boolean
      trash?:boolean
      recent?: boolean
      collectionId?: string | null
      query?: string | null
      limit?: number
      offset?: number
    }): Promise<Result<{ items: ItemSummary[]; total: number }>>
    get(id: string,includeDeleted?:boolean): Promise<Result<ItemDetail | null>>
    update(id: string, patch: unknown): Promise<Result<ItemDetail | null>>
    restore(id:string):Promise<Result<boolean>>
    remove(id: string): Promise<Result<boolean>>
  }
  collections: {
    list(): Promise<Result<CollectionNode[]>>
    create(name: string, parentId?: string | null): Promise<Result<string>>
    rename(id: string, name: string): Promise<Result<boolean>>
  }
  tags: { list(): Promise<Result<TagCount[]>> }
  documents: {
    attachLocal(itemId:string):Promise<Result<{canceled:boolean}>>
    relink(documentVersionId:string):Promise<Result<{canceled:boolean}>>
    print(documentVersionId:string):Promise<Result<boolean>>
    reveal(documentVersionId:string):Promise<Result<boolean>>
    import(files?: string[]): Promise<Result<{ imported: ImportedDocument[]; canceled: boolean }>>
    open(documentVersionId: string): Promise<Result<OpenedDocument>>
    setPageCount(documentVersionId: string, pageCount: number): Promise<Result<boolean>>
  }
  reading: {
    get(documentVersionId: string): Promise<Result<{ pageIndex: number; zoom: number; mode: string; anchor: string | null; panes: string | null } | null>>
    save(documentVersionId: string, state: unknown): Promise<Result<boolean>>
  }
  backup: {
    create(): Promise<Result<BackupSummary>>
    list(): Promise<Result<BackupSummary[]>>
    restore(id: string): Promise<Result<unknown>>
  }
  zotero: {
    detect(): Promise<Result<ZoteroDetect>>
    import(): Promise<Result<ZoteroImportReport>>
    runs(): Promise<Result<unknown[]>>
  }
  files: { getPath(file: File): string }
}

export type { DocumentSummary }

declare global {
  interface Window {
    jian: LibraryApi
  }
}

export {}
