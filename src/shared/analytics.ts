import type { Result } from './ipc'
export type AnalyticsRange = '7' | '30' | '90' | 'all'
export type UsagePurpose = 'interactive' | 'background' | 'test'
export interface TokenUsage { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; cachedInputTokens: number | null; reasoningTokens: number | null }
/** One actual HTTP attempt; retry and shared subscribers never reuse this identity. No content/keys. */
export interface ApiAttempt extends TokenUsage {
 id: string; operationId: string; attempt: number; startedAt: string; finishedAt: string; provider: string; endpointHost: string; model: string; purpose: UsagePurpose; status: 'completed' | 'failed' | 'cancelled'; httpStatus: number | null; estimatedInputTokens: number; estimatedOutputTokens: number
}
export interface AnalyticsSettings { enabled: boolean; trackingSince: string }
export interface ReadingHeartbeat { documentVersionId: string; pageIndex: number; visible: boolean; active: boolean }
export interface ReadingSample { id: string; sessionId: string; documentVersionId: string; pageIndex: number; startedAt: string; finishedAt: string; visit: boolean }
export interface AnalyticsQuery { range: AnalyticsRange; timezone?: string }
export interface TokenSummary extends TokenUsage { attempts: number; completed: number; failed: number; cancelled: number; reportedAttempts: number; unknownAttempts: number; estimatedInputTokens: number; estimatedOutputTokens: number }
export interface DashboardSnapshot {
 generatedAt: string; range: AnalyticsRange; timezone: string; settings: AnalyticsSettings;
 reading: { activeMs: number; sessions: number; documents: number; uniquePages: number; pageVisits: number; uniqueVisitedCharacters: number; uniqueVisitedWords: number; visitedCharacters: number; visitedWords: number; pagesWithText: number };
 readingDocuments: Array<{itemId:string;title:string;documentVersionId:string;activeMs:number;uniquePages:number;uniqueVisitedCharacters:number;uniqueVisitedWords:number;topics:string[];field:string|null}>;
 tokens: TokenSummary;
 models: Array<TokenSummary & { provider: string; model: string; endpointHost: string }>;
 purposes: Array<TokenSummary & { purpose: UsagePurpose }>;
 trend: Array<{ day: string; activeMs: number; pageVisits: number; totalTokens: number; unknownAttempts: number }>;
 library: { items: number; documents: number; managedBytes: number; linkedDocuments?:number; linkedBytes?:number; indexedPages: number; indexedDocuments: number; pendingDocuments: number; failedDocuments: number; annotations: number; comments: number; notes: number; translations: number; glossaryTerms: number; cachedTranslations: number };
 activity: { annotations: number; comments: number; translations: number; imports: number; exports: number; errors: number; cacheHits: number; searches: number; jobsCompleted: number; jobsFailed: number };
 topics: Array<{ id: string; label: string; documents: number; activeMs: number; basis: 'tag' | 'confirmed' }>;
 fields: Array<{ id: string; label: string; documents: number; activeMs: number; basis: 'collection' | 'confirmed' }>;
 notices: string[]
}
export interface ItemClassification { itemId: string; topics: string[]; field: string | null }
export interface AnalyticsApi {
 classifications(itemId: string): Promise<Result<ItemClassification | null>>;
 classify(value: ItemClassification): Promise<Result<boolean>>;
 snapshot(query: AnalyticsQuery): Promise<Result<DashboardSnapshot>>;
 heartbeat(value: ReadingHeartbeat): Promise<Result<boolean>>;
 settings(value?: { enabled: boolean }): Promise<Result<AnalyticsSettings>>;
 clear(): Promise<Result<AnalyticsSettings>>;
 export(): Promise<Result<string>>;
}
