import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CHANNELS } from '../shared/ipc'

/**
 * 只暴露具名方法，不暴露 ipcRenderer。
 * 每个方法都返回 Result 包装，错误不抛到渲染层（DESIGN.md §9.3）。
 */

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

const invoke = <T>(channel: string, params?: unknown): Promise<Result<T>> =>
  ipcRenderer.invoke(channel, params) as Promise<Result<T>>

const api = {
  clipboard:{readText:()=>invoke('clipboard:readText'),writeText:(text:string)=>invoke('clipboard:writeText',{text})},
  windowState:{get:()=>invoke('window:state'),onChange:(cb:(state:{fullScreen:boolean;platform:string})=>void)=>{const listener=(_event:Electron.IpcRendererEvent,state:{fullScreen:boolean;platform:string})=>cb(state);ipcRenderer.on('window:stateChanged',listener);return()=>ipcRenderer.removeListener('window:stateChanged',listener)}},
  preferences: {
    get: () => invoke('preferences:get'),
    set: (value: unknown) => invoke('preferences:set', value),
    diagnostics: () => invoke('preferences:diagnostics'),
    saveDiagnostics: () => invoke('preferences:saveDiagnostics'),
    saveUsage: () => invoke('preferences:saveUsage'),
  },
  analytics: {
    classifications: (itemId: string) => invoke('analytics:classifications', {itemId}),
    classify: (value: unknown) => invoke('analytics:classify', value),
    snapshot: (query: unknown) => invoke('analytics:snapshot', query),
    heartbeat: (value: unknown) => invoke('analytics:heartbeat', value),
    settings: (value?: unknown) => invoke('analytics:settings', value),
    clear: () => invoke('analytics:clear'),
    export: () => invoke('analytics:export'),
  },
  m4: {
    downloadFullText:(itemId:string)=>invoke('m4:downloadFullText',{itemId}),
    downloadCancel:(itemId:string)=>invoke('m4:downloadCancel',{itemId}),
    search: (query: unknown) => invoke('m4:search', query),
    indexStats: () => invoke('m4:indexStats'),
    indexStart: (retry?: boolean) => invoke('m4:indexStart', { retry }),
    indexStop: () => invoke('m4:indexStop'),
    indexNext: () => invoke('m4:indexNext'),
    indexPage: (page: unknown) => invoke('m4:indexPage', page),
    indexFinish: (id: string, pageCount: number, error?: string) => invoke('m4:indexFinish', {id,pageCount,error}),
    metadataHints:(id:string)=>invoke('m4:metadataHints',{id}),
    metadataCandidates:(query:string)=>invoke('m4:metadataCandidates',{query}),
    doiPreview: (doi: string) => invoke('m4:doiPreview', {doi}),
    doiCancel: () => invoke('m4:doiCancel'),
    doiCommit: (draft: unknown, allowDuplicate?: boolean) => invoke('m4:doiCommit', {draft,allowDuplicate}),
    metadataSave: (id: string, draft: unknown) => invoke('m4:metadataSave', {id,draft}),
    exportPreview: (ids: string[], format: string, style?:string) => invoke('m4:exportPreview', {ids,format,style}),
    exportSave: (ids: string[], format: string, style?:string) => invoke('m4:exportSave', {ids,format,style}),
    copyCitation: (ids: string[], style?:string,part?:'bibliography'|'in-text') => invoke('m4:copyCitation', {ids,style,part}),
  },
  m3: {
    clearCache:()=>invoke('m3:clearCache'),
    readerData:(documentVersionId:string)=>invoke('m3:readerData',{documentVersionId}),
    saveReaderData:(documentVersionId:string,data:unknown)=>invoke('m3:readerDataSave',{documentVersionId,data}),
    settings: () => invoke('m3:settings'),
    configure: (config: unknown, apiKey?: string) => invoke('m3:configure', { config, apiKey }),
    models: (config: unknown, apiKey?: string) => invoke('m3:models', { config, apiKey }),
    testDraft: (config: unknown, apiKey?: string) => invoke('m3:testDraft', { config, apiKey }),
    testProvider: () => invoke('m3:test'),
    translate: (request: unknown) => invoke('m3:translate', request),
    cached: (input: unknown) => invoke('m3:cached', input),
    cancel: (requestId: string) => invoke('m3:cancel', { requestId }),
    onTranslation: (cb: (event: unknown) => void) => { const listener = (_e: unknown, data: unknown): void => cb(data); ipcRenderer.on('m3:event', listener); return () => ipcRenderer.removeListener('m3:event', listener) },
    glossary: (itemId: string | null) => invoke('m3:glossary', { itemId }),
    saveTerm: (term: unknown) => invoke('m3:termSave', term),
    deleteTerm: (id: string) => invoke('m3:termDelete', { id }),
    annotations: (documentVersionId: string) => invoke('m3:annotations', { documentVersionId }),
    paletteSettings:(value?:unknown)=>invoke('m3:paletteSettings',{value}),
    readingTools:(documentVersionId:string,patch?:unknown)=>invoke('m3:readingTools',{documentVersionId,patch}),
    reviseAnnotation:(data:unknown)=>invoke('m3:annotationRevise',data),
    exportNotes:(data:unknown)=>invoke('m3:exportNotes',data),
    saveAnnotation: (data: unknown) => invoke('m3:annotationSave', data),
    removeAnnotation: (id: string) => invoke('m3:annotationDelete', { id }),
    startJob: (documentVersionId: string, segments: unknown, itemId: string | null) => invoke('m3:startJob', { documentVersionId, segments, itemId }),
    jobs: (documentVersionId: string) => invoke('m3:jobs', { documentVersionId }),
    controlJob: (id: string, action: string) => invoke('m3:controlJob', { id, action })
  },
  probe: {
    run: (): Promise<Result<unknown>> => ipcRenderer.invoke('probe:run')
  },
  theme: {
    onChange: (cb: (dark: boolean) => void): (() => void) => {
      const listener = (_e: unknown, dark: boolean): void => cb(dark)
      ipcRenderer.on('theme:changed', listener)
      return () => ipcRenderer.removeListener('theme:changed', listener)
    }
  },
  app: {
    info: (): Promise<Result<{ version: string; userData: string }>> => invoke('app:info')
  },
  service: {
    health: (): Promise<Result<unknown>> => invoke(CHANNELS.serviceHealth)
  },
  library: {
    restore:(id:string)=>invoke('library:restore',{id}),
    stats: (): Promise<Result<unknown>> => invoke(CHANNELS.libraryStats),
    list: (params: {
      collectionId?: string | null
      query?: string | null
      limit?: number
      offset?: number
    }): Promise<Result<unknown>> => invoke(CHANNELS.libraryList, params),
    get: (id: string,includeDeleted=false): Promise<Result<unknown>> => invoke(CHANNELS.libraryItem, { id,includeDeleted }),
    update: (id: string, patch: unknown): Promise<Result<unknown>> =>
      invoke(CHANNELS.libraryUpdate, { id, patch }),
    remove: (id: string): Promise<Result<unknown>> => invoke(CHANNELS.libraryDelete, { id })
  },
  collections: {
    list: (): Promise<Result<unknown>> => invoke(CHANNELS.collectionsList),
    create: (name: string, parentId?: string | null): Promise<Result<unknown>> =>
      invoke(CHANNELS.collectionsCreate, { name, parentId: parentId ?? null }),
    rename: (id: string, name: string): Promise<Result<unknown>> =>
      invoke(CHANNELS.collectionsRename, { id, name })
  },
  tags: {
    list: (): Promise<Result<unknown>> => invoke(CHANNELS.tagsList)
  },
  documents: {
    attachLocal:(itemId:string)=>invoke('documents:attachLocal',{itemId}),
    relink:(documentVersionId:string)=>invoke('documents:relink',{documentVersionId}),
    print:(documentVersionId:string)=>invoke('documents:print',{documentVersionId}),
    reveal:(documentVersionId:string)=>invoke('documents:reveal',{documentVersionId}),
    import: (files?: string[]): Promise<Result<unknown>> =>
      invoke(CHANNELS.documentsImport, { files: files ?? [] }),
    open: (documentVersionId: string): Promise<Result<unknown>> =>
      invoke(CHANNELS.documentsOpen, { documentVersionId }),
    setPageCount: (documentVersionId: string, pageCount: number): Promise<Result<unknown>> =>
      invoke(CHANNELS.documentsSetPageCount, { documentVersionId, pageCount })
  },
  reading: {
    get: (documentVersionId: string): Promise<Result<unknown>> =>
      invoke(CHANNELS.readingGet, { documentVersionId }),
    save: (documentVersionId: string, state: unknown): Promise<Result<unknown>> =>
      invoke(CHANNELS.readingSave, { documentVersionId, state })
  },
  backup: {
    create: (): Promise<Result<unknown>> => invoke(CHANNELS.backupCreate),
    list: (): Promise<Result<unknown>> => invoke(CHANNELS.backupList),
    restore: (id: string): Promise<Result<unknown>> => invoke(CHANNELS.backupRestore, { id })
  },
  zotero: {
    detect: (): Promise<Result<unknown>> => invoke(CHANNELS.zoteroDetect),
    import: (): Promise<Result<unknown>> => invoke(CHANNELS.zoteroImport),
    runs: (): Promise<Result<unknown>> => invoke(CHANNELS.zoteroRuns)
  },
  // Electron 32+ 起 File.path 已移除，拖入文件必须走 webUtils
  files: {
    getPath: (file: File): string => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('jian', api)

export type JianApi = typeof api
