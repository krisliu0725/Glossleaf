import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { probeZoteroSnapshot, type ZoteroDescriptor } from './probe'
import type { Row } from '../../data-service/db'

const execFileAsync = promisify(execFile)

/**
 * 源库快照。DESIGN.md §11.1 / §11.2。
 *
 * 硬约束：
 * - 不用 SQLite 打开原始库，只做 stat / 哈希 / 文件复制
 * - 不写原库、不清理原 WAL、不改目录
 * - Zotero 必须退出；复制前后各取一次源状态，变化则整组重做
 * - `-shm` 可重建，不拿它当完整性结论
 */

export class ZoteroSourceError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ZoteroSourceError'
  }
}

interface FileState {
  exists: boolean
  size: number
  mtimeMs: number
  sha256: string | null
}

export interface SourceState {
  main: FileState
  wal: FileState
  shm: FileState
  capturedAt: string
}

export interface SnapshotResult {
  /** 临时目录，调用方负责在导入结束后清理 */
  dir: string
  dbPath: string
  descriptor: ZoteroDescriptor
  fingerprint: string
  sourceState: SourceState
}

async function sha256File(file: string): Promise<string | null> {
  try {
    return await new Promise<string>((resolve, reject) => {
      const hash = createHash('sha256')
      const s = createReadStream(file)
      s.on('data', (c) => hash.update(c))
      s.on('error', reject)
      s.on('end', () => resolve(hash.digest('hex')))
    })
  } catch {
    return null
  }
}

async function fileState(file: string): Promise<FileState> {
  try {
    const st = await fs.stat(file)
    return {
      exists: st.isFile(),
      size: st.size,
      mtimeMs: Math.round(st.mtimeMs),
      // 主库才做哈希，WAL/SHM 只比大小与时间
      sha256: null
    }
  } catch {
    return { exists: false, size: 0, mtimeMs: 0, sha256: null }
  }
}

export async function captureSourceState(sourceDir: string): Promise<SourceState> {
  const main = join(sourceDir, 'zotero.sqlite')
  const mainState = await fileState(main)
  if (mainState.exists) mainState.sha256 = await sha256File(main)
  return {
    main: mainState,
    wal: await fileState(`${main}-wal`),
    shm: await fileState(`${main}-shm`),
    capturedAt: new Date().toISOString()
  }
}

function stateChanged(a: SourceState, b: SourceState): string | null {
  if (a.main.exists !== b.main.exists) return '主库存在状态变化'
  if (a.main.size !== b.main.size) return '主库大小变化'
  if (a.main.mtimeMs !== b.main.mtimeMs) return '主库修改时间变化'
  if (a.main.sha256 && b.main.sha256 && a.main.sha256 !== b.main.sha256) return '主库内容哈希变化'
  if (a.wal.exists !== b.wal.exists || a.wal.size !== b.wal.size) return 'WAL 变化'
  if (a.shm.exists !== b.shm.exists || a.shm.size !== b.shm.size) return 'SHM 变化'
  return null
}

/** 状态检测只是辅助，不是一致性证明；拿不到结论时按「不确定」处理。 */
export async function isZoteroRunning(): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-x', 'Zotero'])
    return stdout.trim().length > 0
  } catch (e) {
    // pgrep 无匹配时退出码为 1，这是「确定没在跑」；其他失败按「不确定」处理
    const code = (e as { code?: unknown }).code
    if (code === 1 || code === '1') return false
    return null
  }
}

export async function createSnapshot(sourceDir: string, workRoot: string): Promise<SnapshotResult> {
  const running = await isZoteroRunning()
  if (running === true) {
    throw new ZoteroSourceError(
      'ZOTERO_RUNNING',
      'Zotero 正在运行。请完全退出 Zotero（⌘Q）后重试，导入不会修改你的 Zotero 文库。'
    )
  }
  if (running === null) {
    throw new ZoteroSourceError(
      'STATE_UNKNOWN',
      '无法确认 Zotero 是否已退出。请关闭 Zotero 后重试，或选择一个静止状态下取得的文库副本。'
    )
  }

  const mainPath = join(sourceDir, 'zotero.sqlite')
  const before = await captureSourceState(sourceDir)
  if (!before.main.exists) {
    throw new ZoteroSourceError('NOT_FOUND', `未找到 ${mainPath}`)
  }

  const dir = join(workRoot, `zotero-snapshot-${Date.now()}`)
  await fs.mkdir(dir, { recursive: true })
  const copyPath = join(dir, 'zotero.sqlite')

  // 数据库与存在的恢复日志一起复制；-shm 可重建，存在就一并带上
  for (const suffix of ['', '-wal', '-shm']) {
    const from = mainPath + suffix
    try {
      await fs.copyFile(from, copyPath + suffix)
    } catch {
      /* 该后缀不存在 */
    }
  }

  const after = await captureSourceState(sourceDir)
  const changed = stateChanged(before, after)
  if (changed) {
    await fs.rm(dir, { recursive: true, force: true })
    throw new ZoteroSourceError(
      'SOURCE_CHANGED',
      `复制期间源库发生变化（${changed}）。请关闭 Zotero 后重试。`
    )
  }

  // 在副本上完成恢复并校验；失败即停止，不尝试修复原库
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(copyPath)
    db.exec('PRAGMA journal_mode = DELETE')
    const integrity = db.prepare('PRAGMA integrity_check').get() as Row | undefined
    const ok = integrity ? String(Object.values(integrity)[0]) : ''
    if (ok !== 'ok') {
      throw new ZoteroSourceError('CORRUPT', `快照完整性检查失败：${ok || '无返回'}`)
    }
    const fk = db.prepare('PRAGMA foreign_key_check').all() as Row[]
    if (fk.length > 0) {
      // 外键问题不一定致命，但要如实报告
      console.warn(`[zotero] 快照存在 ${fk.length} 条外键告警`)
    }
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }

  const descriptor = probeZoteroSnapshot(copyPath)
  const fingerprint = before.main.sha256 ?? ''

  return { dir, dbPath: copyPath, descriptor, fingerprint, sourceState: before }
}

export async function disposeSnapshot(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}
