/** M0 探针报告。字段全部来自运行时实测，不含任何推断值。 */

export interface SqliteCapability {
  available: boolean
  error?: string
}

export interface TrigramCase {
  query: string
  /** 查询字符数（CJK 按字计） */
  chars: number
  hit: boolean
  error?: string
}

export interface SqliteProbe {
  electron: string
  node: string
  chrome: string
  /** node:sqlite 模块是否可加载 */
  module: SqliteCapability & { exports?: string[] }
  /** SELECT sqlite_version() 的返回 */
  sqliteVersion: string | null
  /** FTS5 编译可用性 */
  fts5: SqliteCapability
  /**
   * FTS5 trigram 分词器实测。
   * 注意：trigram 按三字符滑窗索引，查询串少于 3 字符时 MATCH 无法命中，
   * 这是分词器固有约束，需要在上层用短查询降级方案兜住。
   */
  trigram: SqliteCapability & { cases?: TrigramCase[] }
  /** porter unicode61（拉丁词干） */
  porter: SqliteCapability
  /** node:sqlite 的 backup() 是否可用，以及实际备份是否成功 */
  backup: SqliteCapability & { worked?: boolean }
  /** 对 ~/Zotero 只读副本的探测结果 */
  zotero: {
    sourcePath: string
    exists: boolean
    copied: boolean
    sourceMtimeBefore?: number
    sourceMtimeAfter?: number
    items?: number
    byType?: Record<string, number>
    error?: string
  }
  durationMs: number
}

export interface PdfSample {
  token: string
  displayName: string
  byteSize: number
}

export interface ProbeReport {
  sqlite: SqliteProbe
  pdfSample: PdfSample | null
  generatedAt: string
}
