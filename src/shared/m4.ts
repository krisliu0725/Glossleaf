import type { Creator } from './domain'
import type { PdfAnchor, Rect } from './m3'
import type { Result } from './ipc'
export type SearchScope = 'all' | 'metadata' | 'body' | 'excerpts'
export interface SearchQuery { query: string; scope: SearchScope; collectionId?: string | null; documentVersionId?: string; cursor?: number }
export interface SearchHit { annotationType?:string; id: string; kind: 'metadata' | 'body' | 'excerpts'; itemId: string; title: string; documentVersionId: string | null; pageIndex: number | null; annotationId: string | null; snippet: string; marks: Array<[number, number]>; anchor: PdfAnchor | null }
export interface SearchGroup { itemId: string; title: string; hits: SearchHit[] }
export interface SearchResponse { groups: SearchGroup[]; nextCursor: number | null; scanned: number; limitedScan: boolean; pendingMetadata: number }
export interface IndexStats { total: number; completed: number; failed: number; pages: number; running: boolean; errors: Array<{ title: string; error: string }> }
export interface IndexTask { documentVersionId: string; fingerprint: string; title: string; token: string; completedPages: number[] }
export interface TextRun { start: number; end: number; rect: Rect }
export interface IndexPage { documentVersionId: string; pageIndex: number; text: string; runs: TextRun[] }
export interface ReaderLocation { panel?:'notes'|'excerpts';pageIndex: number; rects?: Rect[]; annotationId?: string; query?: string }
export interface MetadataDraft { title: string; type: string; date: string | null; language: string | null; fields: Record<string, string>; creators: Creator[] }
export interface MetadataCandidate {duplicates?:Array<{id:string;title:string}>;doi:string;draft:MetadataDraft;source:string;match:"identifier"|"title";similarity:number}
export interface MetadataHints {dois:string[];indexedPages:number}
export interface DoiPreview { doi: string; draft: MetadataDraft; duplicates: Array<{ id: string; title: string }>; source: string }
export const CITATION_STYLES=[{id:'gbt',label:'GB/T 7714—2015'},{id:'apa',label:'APA · 7th edition'},{id:'mla',label:'MLA · 9th edition'},{id:'chicago',label:'Chicago · Author–Date'},{id:'ieee',label:'IEEE'}] as const
export type CitationStyle=typeof CITATION_STYLES[number]['id']
export type ExportFormat = 'csl-json' | 'bibtex' | 'markdown' | 'excerpts-json' | 'citation' | 'ris' | 'bibliography-html'
export interface ExportPreview { content: string; filename: string; extension: string; html?:string; inText?:string; warnings: string[]; provenance: Record<string,string> }
export interface M4Api {
 downloadFullText(itemId:string):Promise<Result<{status:'downloaded'|'existing'|'unavailable';message:string;source?:string;bytes?:number}>>
 downloadCancel(itemId:string):Promise<Result<boolean>>
 search(query: SearchQuery): Promise<Result<SearchResponse>>
 indexStats(): Promise<Result<IndexStats>>
 indexStart(retry?: boolean): Promise<Result<boolean>>
 indexStop(): Promise<Result<boolean>>
 indexNext(): Promise<Result<IndexTask | null>>
 indexPage(page: IndexPage): Promise<Result<boolean>>
 indexFinish(id: string, pageCount: number, error?: string): Promise<Result<boolean>>
 metadataHints(id:string):Promise<Result<MetadataHints>>
 metadataCandidates(query:string):Promise<Result<MetadataCandidate[]>>
 doiPreview(doi: string): Promise<Result<DoiPreview>>
 doiCancel(): Promise<Result<boolean>>
 doiCommit(draft: MetadataDraft, allowDuplicate?: boolean): Promise<Result<string>>
 metadataSave(id: string, draft: MetadataDraft): Promise<Result<boolean>>
 exportPreview(ids: string[], format: ExportFormat, style?:CitationStyle): Promise<Result<ExportPreview>>
 exportSave(ids: string[], format: ExportFormat, style?:CitationStyle): Promise<Result<{ canceled: boolean; path?: string }>>
 copyCitation(ids: string[], style?:CitationStyle, part?:'bibliography'|'in-text'): Promise<Result<boolean>>
}
