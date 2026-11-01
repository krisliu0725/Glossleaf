import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SCHEMA_SQL, SCHEMA_VERSION, MIGRATIONS } from './schema'

export type Row = Record<string, unknown>

/**
 * 数据服务是唯一持有写连接的地方（DESIGN.md §9.2 / §10.4）。
 * 这里不做连接池：单进程单连接 + WAL + busy_timeout 足够，且避免多写者。
 */
export class Db {
  readonly raw: DatabaseSync
  readonly file: string

  constructor(file: string) {
    this.file = file
    mkdirSync(dirname(file), { recursive: true })
    this.raw = new DatabaseSync(file)
    this.raw.exec('PRAGMA journal_mode = WAL')
    this.raw.exec('PRAGMA foreign_keys = ON')
    this.raw.exec('PRAGMA busy_timeout = 5000')
    this.raw.exec('PRAGMA synchronous = FULL')
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  all(sql: string, params: unknown[] = []): Row[] {
    const stmt = this.raw.prepare(sql)
    return stmt.all(...(params as never[])) as Row[]
  }

  get(sql: string, params: unknown[] = []): Row | undefined {
    const stmt = this.raw.prepare(sql)
    return stmt.get(...(params as never[])) as Row | undefined
  }

  run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
    const stmt = this.raw.prepare(sql)
    const r = stmt.run(...(params as never[]))
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
  }

  transaction<T>(fn: () => T): T {
    this.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.exec('COMMIT')
      return out
    } catch (e) {
      try {
        this.exec('ROLLBACK')
      } catch {
        /* 回滚失败时不掩盖原始错误 */
      }
      throw e
    }
  }

  close(): void {
    try {
      this.raw.close()
    } catch {
      /* 已关闭 */
    }
  }
}

/**
 * 迁移：按 meta.schema_version 递增执行。
 * 迁移前由调用方负责一致备份（§15.4），这里只负责结构变更。
 */
export function migrate(db: Db): { from: number; to: number; applied: boolean } {
  // 全新库连 meta 表都不存在，先看 sqlite_master 再决定读不读版本号
  const hasMeta = db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`)
  const row = hasMeta ? db.get(`SELECT value FROM meta WHERE key = 'schema_version'`) : undefined
  let current = row ? Number(row.value) : 0
  const from = current

  if (current === 0) {
    db.exec(SCHEMA_SQL)
    current = 1
    db.run(`INSERT INTO meta(key, value) VALUES ('schema_version', ?)`, ['1'])
    db.run(`INSERT OR REPLACE INTO meta(key, value) VALUES ('created_at', ?)`, [
      new Date().toISOString()
    ])
  }

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `文库 schema 版本 ${current} 高于本应用支持的 ${SCHEMA_VERSION}，请升级应用后再打开`
    )
  }

  // 逐级升级，每一步单独成事务，失败不会留下半升级状态
  for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
    // VACUUM INTO takes a consistent snapshot including committed WAL pages.
    if (from > 0) {
      const snapshotDir = join(dirname(db.file), 'migration-snapshots')
      mkdirSync(snapshotDir, { recursive: true })
      db.raw.prepare('VACUUM INTO ?').run(join(snapshotDir, `schema-v${v - 1}-before-v${v}-${Date.now()}.sqlite`))
    }
    const sql = MIGRATIONS[v]
    if (!sql) throw new Error(`缺少 schema v${v} 的迁移脚本`)
    db.transaction(() => {
      db.exec(sql)
      db.run(`UPDATE meta SET value = ? WHERE key = 'schema_version'`, [String(v)])
    })
  }

  return { from, to: SCHEMA_VERSION, applied: current !== from }
}

export function openLibrary(libraryDir: string): Db {
  const file = join(libraryDir, 'jian.sqlite')
  const fresh = !existsSync(file)
  const db = new Db(file)
  const result = migrate(db)
  if (fresh && result.applied) {
    db.run(`INSERT OR REPLACE INTO meta(key, value) VALUES ('library_dir', ?)`, [libraryDir])
  }
  return db
}
