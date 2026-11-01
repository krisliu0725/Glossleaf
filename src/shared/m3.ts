export type Rect = [
    number,
    number,
    number,
    number
];
export interface PdfAnchor {
    documentVersionId: string;
    pageIndex: number;
    rects: Rect[];
    exact: string;
    kind?: "text"|"point";
    point?: [number,number];
    pageLabel?:string;
    prefix?:string; suffix?:string; orderKey?:number;
}
export interface Segment {
    id: string;
    pageIndex: number;
    text: string;
    rects: Rect[];
    kind: 'body' | 'heading' | 'reference' | 'margin' | 'title' | 'abstract' | 'keywords' | 'caption' | 'footnote';
    parts?:Array<{pageIndex:number;rects:Rect[];text:string}>;
    bounds?:Rect; pageWidth?:number;pageHeight?:number;column?:number;startsContinuation?:boolean;endsContinuation?:boolean;
    confidence: number;
}
export interface ProviderConfig {
    kind: 'compatible' | 'gemini' | 'ollama' | 'anthropic';
    prompt?:string;
    temperature?: number;
    timeoutMs?: number;
    baseUrl: string;
    model: string;
    targetLanguage: string;
    consent: boolean;
}
export interface ModelOption { id: string; label: string }
export interface ProviderSettings extends ProviderConfig {
    hasKey: boolean;
}
export interface GlossaryEntry {
    id: string;
    scope: 'library' | 'item';
    scopeId: string | null;
    source: string;
    target: string;
    matchMode: string;
    revision: number;
}
export interface TranslationInput {
    mode: 'selection' | 'paragraph';
    text: string;
    context: string;
    itemId: string | null;
    sourceLanguage: string;
}
export interface TranslationResult {
    text: string;
    status: 'completed' | 'needs_review';
    cached: boolean;
    inputHash: string;
    providerFingerprint: string;
    inputSnapshot: string;
    warning?: string;
}
export interface TranslationEvent {
    requestId: string;
    generation: number;
    sequence: number;
    type: 'chunk' | 'completed' | 'failed' | 'cancelled';
    text?: string;
    result?: TranslationResult;
    error?: string;
}
export interface Annotation {
    id: string;
    documentVersionId: string;
    type: string;
    quote: string;
    comment: string;
    color: string;
    markStyle?:'highlight'|'underline';
    stackOrder?:number; sourcePayload?:string|null; paletteId?:string; slot?:number|null; highlightId?:string|null; revision?:number;
    anchors: PdfAnchor[];
    translation: string | null;
    status: string | null;
    createdAt: string;
}
export interface TranslateRequest {
    requestId: string;
    generation: number;
    force?: boolean;
    input: TranslationInput;
}
export interface DocumentJob {
    id: string;
    documentVersionId: string;
    status: string;
    total: number;
    completed: number;
    failed: number;
    error: string | null;
}
export interface M3Api {
    paletteSettings(value?:Partial<import("./annotations").PaletteSettings>):Promise<import("./ipc").Result<import("./annotations").PaletteSettings>>;
    reviseAnnotation(data:import("./annotations").AnnotationDraft & {deleted?:boolean}):Promise<import("./ipc").Result<string>>;
    exportNotes(data:{documentVersionId:string;ids:string[];title:string;metadata:string;copy:boolean;includeQuotes?:boolean}):Promise<import("./ipc").Result<boolean>>;
    clearCache():Promise<import('./ipc').Result<boolean>>;
    readingTools(documentVersionId:string,patch?:Partial<import('./reading-tools').ReadingTools>):Promise<import('./ipc').Result<import('./reading-tools').ReadingTools>>;
    readerData(documentVersionId:string):Promise<import('./ipc').Result<import('./reader').ReaderData>>;
    saveReaderData(documentVersionId:string,data:import('./reader').ReaderData):Promise<import('./ipc').Result<boolean>>;
    settings(): Promise<import('./ipc').Result<ProviderSettings>>;
    configure(config: ProviderConfig, apiKey?: string): Promise<import('./ipc').Result<ProviderSettings>>;
    models(config: ProviderConfig, apiKey?: string): Promise<import('./ipc').Result<ModelOption[]>>;
    testDraft(config: ProviderConfig, apiKey?: string): Promise<import('./ipc').Result<string>>;
    testProvider(): Promise<import('./ipc').Result<string>>;
    translate(request: TranslateRequest): Promise<import('./ipc').Result<TranslationResult>>;
    cached(input: TranslationInput): Promise<import('./ipc').Result<TranslationResult | null>>;
    cancel(requestId: string): Promise<import('./ipc').Result<boolean>>;
    onTranslation(cb: (event: TranslationEvent) => void): () => void;
    glossary(itemId: string | null): Promise<import('./ipc').Result<GlossaryEntry[]>>;
    saveTerm(term: {
        id?: string;
        source: string;
        target: string;
        itemId?: string | null;
    }): Promise<import('./ipc').Result<string>>;
    deleteTerm(id: string): Promise<import('./ipc').Result<boolean>>;
    annotations(documentVersionId: string): Promise<import('./ipc').Result<Annotation[]>>;
    saveAnnotation(data: {
        documentVersionId: string;
        color?:string;paletteId?:string;slot?:number|null;highlightId?:string|null;
        anchors: PdfAnchor[];
        quote: string;
        comment: string;
        translation?: TranslationResult;
        type: 'highlight' | 'excerpt' | 'note';
    }): Promise<import('./ipc').Result<string>>;
    removeAnnotation(id: string): Promise<import('./ipc').Result<boolean>>;
    startJob(documentVersionId: string, segments: Segment[], itemId: string | null): Promise<import('./ipc').Result<string>>;
    jobs(documentVersionId: string): Promise<import('./ipc').Result<DocumentJob[]>>;
    controlJob(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<import('./ipc').Result<boolean>>;
}
export function paragraphInput(segment: Segment, segments: Segment[], itemId: string | null): TranslationInput {
    const index = segments.findIndex(s => s.id === segment.id);
    return { mode: 'paragraph', text: segment.text, context: [...new Set([segments.slice(0,index).filter(s=>s.kind==='heading'||s.kind==='title').at(-1)?.text,...segments.slice(Math.max(0,index-1),index+2).filter(s=>s.id!==segment.id&&s.kind!=='margin').map(s=>s.text)].filter(Boolean))].join('\n').slice(0,12000), itemId, sourceLanguage: 'auto' };
}
