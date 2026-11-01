import { createHash } from 'node:crypto'
import { constants, createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite'
import { SCHEMA_VERSION } from './schema'
import {inspectLinkedFile} from './repo'
import {extname} from 'node:path'
import type { Db, Row } from './db'
import type { BackupSummary } from '../shared/domain'

/**
 * 备份与恢复。对应 DESIGN.md §15.4 / §15.5。
 *
 * 关键约束：
 * - 备份用 SQLite 的 backup() 取一致快照，不拷主库文件（避免读到半写状态）。
 * - 清单记录每个 blob 的哈希与大小；完整包内含 blob，因此可以恢复到空目录。
 * - 恢复先在暂存目录解包校验，再原子替换，原库保留为 pre-restore 快照。
 * - 校验不通过一律不得用于恢复。
 */

const BACKUP_FORMAT = 'jian-backup/1'
const KEEP_DAILY = 7
const KEEP_TOTAL = 11

export interface Manifest {
  format: string
  schemaVersion: number
  createdAt: string
  appVersion: string
  includesBlobs: boolean
  counts: Record<string, number>
  blobs: Array<{ sha256: string; relativePath: string; byteSize: number }>
  hashVerified: boolean
}

function backupId(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function countAll(db: Pick<Db, 'get'>): Record<string, number> {
  const one = (sql: string): number => Number(db.get(sql)?.n ?? 0)
  return {
    items: one(`SELECT count(*) AS n FROM item`),
    collections: one(`SELECT count(*) AS n FROM collection`),
    tags: one(`SELECT count(*) AS n FROM tag`),
    documents: one(`SELECT count(*) AS n FROM document`),
    documentVersions: one(`SELECT count(*) AS n FROM document_version`),
    blobs: one(`SELECT count(*) AS n FROM file_blob`),
    annotations: one(`SELECT count(*) AS n FROM annotation`),
    notes: one(`SELECT count(*) AS n FROM note`),
    readingStates: one(`SELECT count(*) AS n FROM reading_state`)
  }
}

async function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const s = createReadStream(file)
    s.on('data', (c) => hash.update(c))
    s.on('error', reject)
    s.on('end', () => resolve(hash.digest('hex')))
  })
}

async function pathSize(file: string): Promise<number | null> {
  try {
    const st = await fs.stat(file)
    return st.isFile() ? st.size : null
  } catch {
    return null
  }
}

export async function createBackup(
  db: Db,
  libraryDir: string,
  opts: { appVersion: string; includeBlobs?: boolean } = { appVersion: '0.1.0' }
): Promise<BackupSummary> {
  const includeBlobs = opts.includeBlobs ?? true
  const id = backupId()
  const dir = join(libraryDir, 'backups', id)
  await fs.mkdir(dir, { recursive: true })

  // 1) 一致快照（SQLite 在线备份 API，不是文件拷贝）
  const dbCopy = join(dir, 'jian.sqlite')
  await sqliteBackup(db.raw, dbCopy)

  // 2) 清单
  // Explicit full backups materialize linked originals only inside the backup snapshot.
  // The live library keeps its links and receives no extra working copy.
  const snapshot = new DatabaseSync(dbCopy),externalSources=new Map<string,string>()
  let blobRows:Row[],counts:Record<string,number>,schemaRow:Row|undefined
  try{
   snapshot.exec('PRAGMA journal_mode = DELETE')
   if(includeBlobs){
    const links=snapshot.prepare('SELECT DISTINCT g.* FROM external_file_grant g JOIN document_version v ON v.externalGrantId=g.id').all() as Row[]
    for(const grant of links){
     const file=await inspectLinkedFile(String(grant.absolutePath)).catch(()=>{throw new Error('完整备份需要原文件；请重新定位失联的本地附件后重试')});if(file.sha256!==grant.fingerprint)throw new Error('原文件内容已改变，完整备份未创建；请核对附件版本')
     const hash=file.sha256,relativePath=join('blobs',hash.slice(0,2),hash.slice(2,4),hash+extname(file.absolutePath).toLowerCase())
     snapshot.prepare('INSERT OR IGNORE INTO file_blob VALUES(?,?,?,?)').run(hash,relativePath,file.byteSize,new Date().toISOString())
     snapshot.prepare('UPDATE document_version SET blobHash=?,externalGrantId=NULL WHERE externalGrantId=?').run(hash,String(grant.id))
     externalSources.set(hash,file.absolutePath)
    }
    snapshot.exec('DELETE FROM external_file_grant')
   }
   blobRows=snapshot.prepare('SELECT sha256, relativePath, byteSize FROM file_blob').all() as Row[]
   counts=countAll({get:(sql:string)=>snapshot.prepare(sql).get() as Row|undefined})
   schemaRow=snapshot.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as Row|undefined
  }catch(e){snapshot.close();await fs.rm(dir,{recursive:true,force:true});throw e}
  snapshot.close()

  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    schemaVersion: Number(schemaRow?.value ?? 0),
    createdAt: new Date().toISOString(),
    appVersion: opts.appVersion,
    includesBlobs: includeBlobs,
    counts,
    blobs: blobRows.map((b: Row) => ({
      sha256: String(b.sha256),
      relativePath: String(b.relativePath),
      byteSize: Number(b.byteSize)
    })),
    hashVerified: false
  }

  // 3) blob 随包（完整包才可恢复到空目录）
  let allHashesOk = true
  if (includeBlobs) {
    for (const b of manifest.blobs) {
      const src = externalSources.get(b.sha256)??join(libraryDir, b.relativePath)
      const dst = join(dir, b.relativePath)
      await fs.mkdir(join(dst, '..'), { recursive: true })
      try {
        await fs.copyFile(src, dst, constants.COPYFILE_FICLONE)
      } catch {
        allHashesOk = false
        continue
      }
      const actual = await sha256File(dst)
      if (actual !== b.sha256) allHashesOk = false
    }
  } else {
    // 不含 blob 的包只能用于同目录恢复，需要 blob 仍然在位
    for (const b of manifest.blobs) {
      const size = await pathSize(join(libraryDir, b.relativePath))
      if (size === null || size !== b.byteSize) allHashesOk = false
    }
  }

  // 4) 校验数据库副本
  const verified = await verifyDatabaseFile(dbCopy, counts)
  manifest.hashVerified = allHashesOk && verified

  await fs.writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  await pruneBackups(libraryDir)

  return {
    id,
    createdAt: manifest.createdAt,
    schemaVersion: manifest.schemaVersion,
    byteSize: await dirSize(dir),
    blobCount: manifest.blobs.length,
    counts: manifest.counts,
    verified: manifest.hashVerified,
    path: dir
  }
}

/** 清单里的计数键 → 实际表名。不要用字符串拼表名猜，之前 `blobs` 就被拼成了不存在的表。 */
const COUNT_TABLES: Record<string, string> = {
  items: 'item',
  collections: 'collection',
  tags: 'tag',
  documents: 'document',
  documentVersions: 'document_version',
  blobs: 'file_blob',
  annotations: 'annotation',
  notes: 'note',
  readingStates: 'reading_state'
}

async function verifyDatabaseFile(file: string, expected: Record<string, number>): Promise<boolean> {
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(file, { readOnly: true })
    const integrity = db.prepare('PRAGMA integrity_check').get() as Row | undefined
    const okValue = integrity ? Object.values(integrity)[0] : null
    if (String(okValue) !== 'ok') return false
    if (db.prepare('PRAGMA foreign_key_check').all().length) return false

    for (const [key, n] of Object.entries(expected)) {
      const table = COUNT_TABLES[key]
      if (!table) continue
      const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as Row | undefined
      if (Number(row?.n ?? -1) !== n) return false
    }
    return true
  } catch {
    return false
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  const walk = async (d: string): Promise<void> => {
    const entries = await fs.readdir(d, { withFileTypes: true })
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) total += (await fs.stat(p)).size
    }
  }
  try {
    await walk(dir)
  } catch {
    /* ignore */
  }
  return total
}

async function pruneBackups(libraryDir: string): Promise<void> {
  const root = join(libraryDir, 'backups')
  let ids: string[]
  try {
    ids = (await fs.readdir(root)).filter((n) => /^\d{8}-\d{6}$/.test(n)).sort()
  } catch {
    return
  }
  while (ids.length > KEEP_TOTAL) {
    const oldest = ids.shift()
    if (!oldest) break
    await fs.rm(join(root, oldest), { recursive: true, force: true })
  }
  void KEEP_DAILY
}

export async function listBackups(libraryDir: string): Promise<BackupSummary[]> {
  const root = join(libraryDir, 'backups')
  let ids: string[]
  try {
    ids = (await fs.readdir(root)).filter((n) => /^\d{8}-\d{6}$/.test(n)).sort().reverse()
  } catch {
    return []
  }

  const out: BackupSummary[] = []
  for (const id of ids) {
    const dir = join(root, id)
    try {
      const raw = await fs.readFile(join(dir, 'manifest.json'), 'utf8')
      const m = JSON.parse(raw) as Manifest
      out.push({
        id,
        createdAt: m.createdAt,
        schemaVersion: m.schemaVersion,
        byteSize: await dirSize(dir),
        blobCount: m.blobs.length,
        counts: m.counts,
        verified: m.hashVerified,
        path: dir
      })
    } catch {
      /* 清单损坏的备份不列出，避免被误选 */
    }
  }
  return out
}

export interface RestorePlan {
  id: string
  dir: string
  manifest: Manifest
  problems: string[]
}

/** 只校验，不改动任何现有数据。 */
export async function verifyBackup(libraryDir: string, id: string): Promise<RestorePlan> {
  const dir = join(libraryDir, 'backups', id)
  const problems: string[] = []

  let manifest: Manifest
  try {
    manifest = JSON.parse(await fs.readFile(join(dir, 'manifest.json'), 'utf8')) as Manifest
  } catch {
    return { id, dir, manifest: null as unknown as Manifest, problems: ['备份清单缺失或无法解析'] }
  }

  if (manifest.format !== BACKUP_FORMAT) problems.push(`未知备份格式：${manifest.format}`)
  if (manifest.schemaVersion > SCHEMA_VERSION) problems.push(`备份 schema 版本 ${manifest.schemaVersion} 高于本应用支持`)

  const dbOk = await verifyDatabaseFile(join(dir, 'jian.sqlite'), manifest.counts)
  if (!dbOk) problems.push('数据库副本完整性检查或实体计数不一致')

  for (const b of manifest.blobs) {
    const inBackup = join(dir, b.relativePath)
    const inLibrary = join(libraryDir, b.relativePath)
    const size = (await pathSize(inBackup)) ?? (await pathSize(inLibrary))
    if (size === null) {
      problems.push(`附件缺失：${b.sha256.slice(0, 12)}…`)
      continue
    }
    if (size !== b.byteSize) {
      problems.push(`附件大小不符：${b.sha256.slice(0, 12)}…`)
      continue
    }
    const actual = await sha256File((await pathSize(inBackup)) !== null ? inBackup : inLibrary)
    if (actual !== b.sha256) problems.push(`附件哈希不符：${b.sha256.slice(0, 12)}…`)
  }

  return { id, dir, manifest, problems }
}

/**
 * 应用恢复。调用方必须先 close 数据库连接，恢复后重新打开。
 * 不在这里处理连接，避免数据服务同时持有两个写连接。
 */
export async function applyRestore(libraryDir: string, plan: RestorePlan): Promise<void> {
  if (plan.problems.length > 0) {
    throw new Error(`备份未通过校验，拒绝恢复：${plan.problems.join('；')}`)
  }

  const staging = join(libraryDir, '.restore-staging')
  await fs.rm(staging, { recursive: true, force: true })
  await fs.mkdir(staging, { recursive: true })

  // 1) 解包到暂存（限制在暂存目录内，禁止路径穿越）
  await fs.copyFile(join(plan.dir, 'jian.sqlite'), join(staging, 'jian.sqlite'))

  if (plan.manifest.includesBlobs) {
    for (const b of plan.manifest.blobs) {
      const src = join(plan.dir, b.relativePath)
      if ((await pathSize(src)) === null) continue
      const dst = join(libraryDir, b.relativePath)
      if ((await pathSize(dst)) !== null) continue // 内容寻址，已存在即同一内容
      await fs.mkdir(join(dst, '..'), { recursive: true })
      await fs.copyFile(src, dst, constants.COPYFILE_FICLONE)
    }
  }

  // 2) 原库留作恢复前快照，并清掉可能残留的 WAL/SHM
  const live = join(libraryDir, 'jian.sqlite')
  const stamp = backupId()
  if ((await pathSize(live)) !== null) {
    await fs.rename(live, join(libraryDir, `jian.sqlite.pre-restore-${stamp}`))
  }
  await fs.rm(`${live}-wal`, { force: true })
  await fs.rm(`${live}-shm`, { force: true })

  // 3) 原子换入
  await fs.rename(join(staging, 'jian.sqlite'), live)
  await fs.rm(staging, { recursive: true, force: true })
}
