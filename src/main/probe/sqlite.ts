import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { SqliteProbe } from '../../shared/types'

/**
 * M0 探针：回答 DESIGN.md §17.2 的第一问
 * 「目标 Electron 构建实际提供哪些 SQLite API？FTS 与所需 tokenizer 是否可用？」
 *
 * 全部结论来自运行时实测。任何一项失败都记录 error，不做兜底推断。
 */

type Row = Record<string, unknown>

interface DbLike {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    get(...params: unknown[]): Row | undefined
    all(...params: unknown[]): Row[]
  }
  close(): void
}

interface ModuleLike {
  DatabaseSync: new (path: string, options?: Record<string, unknown>) => DbLike
  backup?: (sourceDb: DbLike, path: string, options?: Record<string, unknown>) => Promise<unknown>
}

function loadModule(): { mod: ModuleLike | null; exports: string[]; error?: string } {
  try {
    // 主进程打包为 CJS（见 electron.vite.config.ts），node:sqlite 是内置模块，
    // 运行时直接 require 即可；不经过打包器静态解析，模块缺失也不会拖垮启动。
    const mod = require('node:sqlite') as ModuleLike
    return { mod, exports: Object.keys(mod).sort() }
  } catch (e) {
    return { mod: null, exports: [], error: e instanceof Error ? e.message : String(e) }
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

export async function runSqliteProbe(): Promise<SqliteProbe> {
  const started = Date.now()
  const { mod, exports, error } = loadModule()

  const probe: SqliteProbe = {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    module: { available: mod !== null, exports },
    sqliteVersion: null,
    fts5: { available: false },
    trigram: { available: false },
    porter: { available: false },
    backup: { available: false },
    zotero: { sourcePath: join(homedir(), 'Zotero', 'zotero.sqlite'), exists: false, copied: false },
    durationMs: 0
  }

  if (error) probe.module.error = error

  if (mod) {
    let db: DbLike | null = null
    try {
      db = new mod.DatabaseSync(':memory:')
      const versionRow = db.prepare('SELECT sqlite_version() AS v').get()
      probe.sqliteVersion = versionRow ? String(versionRow.v) : null

      // FTS5 编译可用性
      try {
        db.exec('CREATE VIRTUAL TABLE probe_fts USING fts5(body)')
        probe.fts5.available = true
      } catch (e) {
        probe.fts5.error = errorText(e)
      }

      // trigram 分词器 + 中文检索实测。
      // 关键：trigram 按三字符滑窗索引，查询串少于 3 字符时 MATCH 必然不命中。
      // 这里把 3 / 2 / 1 字的边界全部测出来，供检索层设计短查询降级方案。
      try {
        db.exec(`CREATE VIRTUAL TABLE probe_trigram USING fts5(body, tokenize='trigram')`)
        db.exec(`INSERT INTO probe_trigram(body) VALUES ('城市矿产开发利用的前景与影响因素')`)
        const cases: Array<{ query: string; chars: number; hit: boolean; error?: string }> = []
        // 全部取自插入文本的真实子串，保证「未命中」反映的是分词器边界而不是查询词本身不存在
        for (const query of ['城市矿产开发', '矿产开发', '城市矿', '矿产', '矿']) {
          try {
            const row = db
              .prepare(`SELECT count(*) AS n FROM probe_trigram WHERE probe_trigram MATCH ?`)
              .get(query)
            cases.push({ query, chars: [...query].length, hit: row ? Number(row.n) > 0 : false })
          } catch (e) {
            cases.push({ query, chars: [...query].length, hit: false, error: errorText(e) })
          }
        }
        probe.trigram.available = true
        probe.trigram.cases = cases
      } catch (e) {
        probe.trigram.error = errorText(e)
      }

      // 拉丁词干
      try {
        db.exec(`CREATE VIRTUAL TABLE probe_porter USING fts5(body, tokenize='porter unicode61')`)
        probe.porter.available = true
      } catch (e) {
        probe.porter.error = errorText(e)
      }

      // 一致备份能力
      probe.backup.available = typeof mod.backup === 'function'
      if (mod.backup) {
        const dest = join(tmpdir(), `jian-probe-backup-${randomUUID()}.sqlite`)
        try {
          await mod.backup(db, dest)
          const st = await fs.stat(dest)
          probe.backup.worked = st.size > 0
        } catch (e) {
          probe.backup.error = errorText(e)
        } finally {
          await fs.rm(dest, { force: true })
        }
      }
    } catch (e) {
      probe.module.error = errorText(e)
    } finally {
      try {
        db?.close()
      } catch {
        /* ignore */
      }
    }
  }

  probe.zotero = await probeZotero(mod)
  probe.durationMs = Date.now() - started
  return probe
}

/**
 * 对 ~/Zotero 的探测只发生在**副本**上：
 * 源库从不被 SQLite 打开，也不做任何写入。v3 §11.1 的硬约束。
 */
async function probeZotero(mod: ModuleLike | null): Promise<SqliteProbe['zotero']> {
  const sourcePath = join(homedir(), 'Zotero', 'zotero.sqlite')
  const result: SqliteProbe['zotero'] = { sourcePath, exists: false, copied: false }

  try {
    const before = await fs.stat(sourcePath)
    result.exists = true
    result.sourceMtimeBefore = before.mtimeMs

    const workDir = join(tmpdir(), `jian-probe-${randomUUID()}`)
    await fs.mkdir(workDir, { recursive: true })
    const copyPath = join(workDir, 'zotero.sqlite')

    // 连同恢复日志一起复制；-shm 可重建，复制与否都不作为完整性结论
    for (const suffix of ['', '-wal', '-shm']) {
      const from = sourcePath + suffix
      try {
        await fs.copyFile(from, copyPath + suffix)
      } catch {
        /* 该后缀不存在时跳过 */
      }
    }
    result.copied = true

    if (mod) {
      let db: DbLike | null = null
      try {
        db = new mod.DatabaseSync(copyPath, { readOnly: true })
        const total = db.prepare('SELECT count(*) AS n FROM items').get()
        result.items = total ? Number(total.n) : 0
        const rows = db
          .prepare(
            `SELECT it.typeName AS typeName, count(*) AS n
               FROM items i JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
              GROUP BY 1 ORDER BY n DESC`
          )
          .all()
        result.byType = Object.fromEntries(rows.map((r) => [String(r.typeName), Number(r.n)]))
      } catch (e) {
        result.error = errorText(e)
      } finally {
        try {
          db?.close()
        } catch {
          /* ignore */
        }
      }
    }

    await fs.rm(workDir, { recursive: true, force: true })

    const after = await fs.stat(sourcePath)
    result.sourceMtimeAfter = after.mtimeMs
  } catch (e) {
    result.error = errorText(e)
  }

  return result
}
