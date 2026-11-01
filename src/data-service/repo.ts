import { createHash } from 'node:crypto'
import { constants, createReadStream, promises as fs } from 'node:fs'
import { basename, extname, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Db, Row } from './db'
import type {
  CollectionNode,
  Creator,
  DocumentSummary,
  ImportedDocument,
  ItemDetail,
  ItemSummary,
  LibraryStats,
  NoteSummary,
  TagCount
} from '../shared/domain'

const nowIso = (): string => new Date().toISOString()

function newEntity(db: Db, kind: 'item' | 'collection' | 'tag' | 'document' | 'annotation' | 'note'): string {
  const id = randomUUID()
  const now = nowIso()
  db.run(
    `INSERT INTO entity(id, kind, createdAt, updatedAt, revision, deletedAt) VALUES (?,?,?,?,1,NULL)`,
    [id, kind, now, now]
  )
  return id
}

function touch(db: Db, id: string): void {
  db.run(`UPDATE entity SET updatedAt = ?, revision = revision + 1 WHERE id = ?`, [nowIso(), id])
}

function yearOf(date: string | null): string | null {
  if (!date) return null
  const m = /^(\d{4})/.exec(date)
  return m ? m[1] : null
}

function displayName(row: Row): string {
  if (row.nameMode === 'literal') return String(row.literalName ?? '')
  const family = String(row.familyName ?? '').trim()
  const given = String(row.givenName ?? '').trim()
  if (family && given) return `${family} ${given}`
  return family || given
}

// ---------------------------------------------------------------- 统计

export function stats(db: Db): LibraryStats {
  const one = (sql: string): number => Number(db.get(sql)?.n ?? 0)
  return {
    items: one(`SELECT count(*) AS n FROM item i JOIN entity e ON e.id = i.id WHERE e.deletedAt IS NULL`),
    documents: one(`SELECT count(*) AS n FROM document`),
    annotations: one(`SELECT count(*) AS n FROM annotation`),
    notes: one(`SELECT count(*) AS n FROM note`),
    collections: one(`SELECT count(*) AS n FROM collection`),
    tags: one(`SELECT count(*) AS n FROM tag`),
    totalBytes: one(`SELECT coalesce(sum(byteSize),0) AS n FROM file_blob`)
  }
}

// ---------------------------------------------------------------- 文献列表

interface ListOptions {
  recent?: boolean
  unfiled?:boolean
  trash?:boolean
  collectionId?: string | null
  query?: string | null
  limit?: number
  offset?: number
}

export function listItems(db: Db, opts: ListOptions = {}): { items: ItemSummary[]; total: number } {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500)
  const offset = Math.max(opts.offset ?? 0, 0)
  const collectionId = opts.collectionId ?? null
  const q = (opts.query ?? '').trim()
  const like = `%${q.replace(/[%_]/g, (c) => '\\' + c)}%`

  // M1 检索为元数据 LIKE；全文 FTS 在 M4 接入（见 docs/verification.md §3 的 trigram 边界结论）
  const where = `
    e.deletedAt IS ${opts.trash?'NOT NULL':'NULL'}
    ${opts.unfiled?'AND NOT EXISTS (SELECT 1 FROM collection_item ci WHERE ci.itemId=i.id)':''}
    AND (? IS NULL OR EXISTS (
      SELECT 1 FROM collection_item ci WHERE ci.itemId = i.id AND ci.collectionId = ?))
    AND (? = '' OR i.title LIKE ? ESCAPE '\\'
         OR i.fieldsJson LIKE ? ESCAPE '\\'
         OR EXISTS (SELECT 1 FROM item_creator c WHERE c.itemId = i.id
                    AND (c.familyName LIKE ? ESCAPE '\\' OR c.literalName LIKE ? ESCAPE '\\')))
  `
  const params = [collectionId, collectionId, q, like, like, like, like]

  const total = Number(
    db.get(`SELECT count(*) AS n FROM item i JOIN entity e ON e.id = i.id WHERE ${where}`, params)?.n ?? 0
  )

  const rows = db.all(
    `SELECT i.id, i.type, i.title, i.language, i.date, i.fieldsJson,e.updatedAt,
       ((SELECT count(*) FROM note n JOIN entity ne ON ne.id=n.id WHERE n.itemId=i.id AND ne.deletedAt IS NULL)+(SELECT count(*) FROM annotation a JOIN entity ae ON ae.id=a.id JOIN document_version v ON v.id=a.documentVersionId JOIN document d ON d.id=v.documentId WHERE d.itemId=i.id AND a.type='note' AND ae.deletedAt IS NULL)) AS noteCount,
       (SELECT count(*) FROM annotation a JOIN entity ae ON ae.id=a.id JOIN document_version dv ON dv.id=a.documentVersionId JOIN document dd ON dd.id=dv.documentId WHERE dd.itemId=i.id AND ae.deletedAt IS NULL AND a.translationRecordId IS NOT NULL) AS translatedCount,
       (SELECT group_concat(d, ', ') FROM (
          SELECT CASE WHEN c.nameMode = 'literal' THEN c.literalName
                      ELSE trim(coalesce(c.familyName,'') || ' ' || coalesce(c.givenName,'')) END AS d
            FROM item_creator c WHERE c.itemId = i.id ORDER BY c.orderIndex)) AS creators,
       (SELECT count(*) FROM document doc WHERE doc.itemId = i.id) AS documentCount,
       (SELECT count(*) FROM document doc WHERE doc.itemId = i.id
          AND doc.contentType = 'application/pdf') AS pdfCount,
       (SELECT count(*) FROM annotation a
          JOIN document_version v ON v.id = a.documentVersionId
          JOIN document doc ON doc.id = v.documentId
         WHERE doc.itemId = i.id AND a.type!='note' AND EXISTS(SELECT 1 FROM entity ae WHERE ae.id=a.id AND ae.deletedAt IS NULL)) AS annotationCount
     FROM item i JOIN entity e ON e.id = i.id
     WHERE ${where}
     ORDER BY ${opts.recent ? 'e.createdAt DESC,' : ''} coalesce(i.date, '') DESC, i.title ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return {
    total,
    items: rows.map((r) => ({
      id: String(r.id),
      type: String(r.type),
      title: String(r.title),
      language: (r.language as string | null) ?? null,
      date: (r.date as string | null) ?? null,
      creators: String(r.creators ?? ''),
      year: yearOf((r.date as string | null) ?? null),
      documentCount: Number(r.documentCount ?? 0),
      annotationCount: Number(r.annotationCount ?? 0),
      hasPdf: Number(r.pdfCount ?? 0) > 0,
      updatedAt: String(r.updatedAt),publicationTitle:JSON.parse(String(r.fieldsJson??'{}')).publicationTitle??'',noteCount:Number(r.noteCount??0),translatedCount:Number(r.translatedCount??0)
    }))
  }
}

// ---------------------------------------------------------------- 文献详情

export function getItem(db: Db, id: string, includeDeleted=false): ItemDetail | null {
  const row = db.get(
    `SELECT i.id, i.type, i.title, i.fieldsJson, i.language, i.date, e.updatedAt,
       (SELECT count(*) FROM document doc WHERE doc.itemId = i.id) AS documentCount,
       (SELECT count(*) FROM document doc WHERE doc.itemId = i.id
          AND doc.contentType = 'application/pdf') AS pdfCount,
       (SELECT count(*) FROM annotation a
          JOIN document_version v ON v.id = a.documentVersionId
          JOIN document doc ON doc.id = v.documentId
         WHERE doc.itemId = i.id AND a.type!='note' AND EXISTS(SELECT 1 FROM entity ae WHERE ae.id=a.id AND ae.deletedAt IS NULL)) AS annotationCount
     FROM item i JOIN entity e ON e.id = i.id
     WHERE i.id = ? AND ${includeDeleted?'1=1':'e.deletedAt IS NULL'}`,
    [id]
  )
  if (!row) return null

  const creatorRows = db.all(
    `SELECT orderIndex, role, nameMode, givenName, familyName, literalName
       FROM item_creator WHERE itemId = ? ORDER BY orderIndex`,
    [id]
  )
  const creatorsList: Creator[] = creatorRows.map((c) => ({
    order: Number(c.orderIndex),
    role: String(c.role),
    nameMode: c.nameMode === 'literal' ? 'literal' : 'person',
    givenName: (c.givenName as string | null) ?? null,
    familyName: (c.familyName as string | null) ?? null,
    literalName: (c.literalName as string | null) ?? null
  }))

  const docs = db.all(
    `SELECT d.id, d.displayName, d.contentType, d.availability, d.activeVersionId,
            v.pageCount, coalesce(b.byteSize,g.byteSize) AS byteSize, CASE WHEN v.externalGrantId IS NOT NULL THEN 'linked' ELSE 'managed' END AS storageMode
       FROM document d
       LEFT JOIN document_version v ON v.id = d.activeVersionId
       LEFT JOIN file_blob b ON b.sha256 = v.blobHash
       LEFT JOIN external_file_grant g ON g.id=v.externalGrantId
      WHERE d.itemId = ? ORDER BY d.displayName`,
    [id]
  )
  const documents: DocumentSummary[] = docs.map((d) => ({
    id: String(d.id),
    displayName: String(d.displayName),
    contentType: String(d.contentType),
    storageMode: d.storageMode==='linked'?'linked':'managed',
    availability: (d.availability as DocumentSummary['availability']) ?? 'managed',
    activeVersionId: (d.activeVersionId as string | null) ?? null,
    pageCount: d.pageCount === null || d.pageCount === undefined ? null : Number(d.pageCount),
    byteSize: d.byteSize === null || d.byteSize === undefined ? null : Number(d.byteSize)
  }))

  const noteRows = db.all(
    `SELECT n.id, n.format, n.body, n.importedOriginalHtml, e.createdAt
       FROM note n JOIN entity e ON e.id = n.id
      WHERE n.itemId = ? ORDER BY e.createdAt DESC`,
    [id]
  )
  const notes: NoteSummary[] = noteRows.map((n) => ({
    id: String(n.id),
    format: String(n.format),
    body: String(n.body),
    importedOriginalHtml: n.importedOriginalHtml ? String(n.importedOriginalHtml) : null,
    createdAt: String(n.createdAt)
  }))

  const tagRows = db.all(
    `SELECT t.name FROM item_tag it JOIN tag t ON t.id = it.tagId WHERE it.itemId = ? ORDER BY t.name`,
    [id]
  )
  const collRows = db.all(
    `SELECT c.id, c.name FROM collection_item ci JOIN collection c ON c.id = ci.collectionId
      WHERE ci.itemId = ? ORDER BY c.name`,
    [id]
  )

  const fields = JSON.parse(String(row.fieldsJson ?? '{}')) as Record<string, string>
  const date = (row.date as string | null) ?? null

  return {
    id: String(row.id),
    type: String(row.type),
    title: String(row.title),
    language: (row.language as string | null) ?? null,
    date,
    creators: creatorsList.map((c) => displayName(c as unknown as Row)).join(', '),
    year: yearOf(date),
    documentCount: Number(row.documentCount ?? 0),
    annotationCount: Number(row.annotationCount ?? 0),
    hasPdf: Number(row.pdfCount ?? 0) > 0,
    updatedAt: String(row.updatedAt),
    fields,
    creatorsList,
    tags: tagRows.map((t) => String(t.name)),
    collections: collRows.map((c) => ({ id: String(c.id), name: String(c.name) })),
    documents,
    notes
  }
}

export function updateItem(
  db: Db,
  id: string,
  patch: {
    title?: string
    type?: string
    language?: string | null
    date?: string | null
    fields?: Record<string, string>
    creators?: Creator[]
    tags?: string[]
  }
): void {
  db.transaction(() => {
    const current = db.get(`SELECT title, type, fieldsJson, language, date FROM item WHERE id = ?`, [id])
    if (!current) throw new Error('文献不存在')

    db.run(
      `UPDATE item SET title = ?, type = ?, fieldsJson = ?, language = ?, date = ? WHERE id = ?`,
      [
        patch.title ?? String(current.title),
        patch.type ?? String(current.type),
        JSON.stringify(patch.fields ?? JSON.parse(String(current.fieldsJson ?? '{}'))),
        patch.language !== undefined ? patch.language : (current.language as string | null),
        patch.date !== undefined ? patch.date : (current.date as string | null),
        id
      ]
    )

    if (patch.creators) {
      db.run(`DELETE FROM item_creator WHERE itemId = ?`, [id])
      patch.creators.forEach((c, i) => {
        db.run(
          `INSERT INTO item_creator(itemId, orderIndex, role, nameMode, givenName, familyName, literalName)
           VALUES (?,?,?,?,?,?,?)`,
          [id, i, c.role || 'author', c.nameMode, c.givenName, c.familyName, c.literalName]
        )
      })
    }

    if (patch.tags) {
      db.run(`DELETE FROM item_tag WHERE itemId = ?`, [id])
      for (const name of patch.tags) {
        const tagId = upsertTag(db, name)
        db.run(`INSERT OR IGNORE INTO item_tag(itemId, tagId, origin) VALUES (?,?,'local')`, [id, tagId])
      }
    }

    touch(db, id)
  })
}

export function softDeleteItem(db: Db, id: string): void {
  db.transaction(() => {
    db.run(`UPDATE entity SET deletedAt = ?, updatedAt = ? WHERE id = ?`, [nowIso(), nowIso(), id])
  })
}

// ---------------------------------------------------------------- 集合与标签

export function listCollections(db: Db): CollectionNode[] {
  const rows = db.all(
    `SELECT c.id, c.name, c.parentId,
            (SELECT count(*) FROM collection_item ci JOIN entity ie ON ie.id=ci.itemId WHERE ci.collectionId = c.id AND ie.deletedAt IS NULL) AS itemCount
       FROM collection c ORDER BY c.name`
  )
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    parentId: (r.parentId as string | null) ?? null,
    itemCount: Number(r.itemCount ?? 0)
  }))
}

export function createCollection(db: Db, name: string, parentId: string | null): string {
  return db.transaction(() => {
    const id = newEntity(db, 'collection')
    db.run(`INSERT INTO collection(id, name, parentId) VALUES (?,?,?)`, [id, name, parentId])
    return id
  })
}

export function renameCollection(db: Db, id: string, name: string): void {
  db.transaction(() => {
    db.run(`UPDATE collection SET name = ? WHERE id = ?`, [name, id])
    touch(db, id)
  })
}

export function addItemToCollection(db: Db, collectionId: string, itemId: string): void {
  db.run(`INSERT OR IGNORE INTO collection_item(collectionId, itemId, origin) VALUES (?,?,'local')`, [
    collectionId,
    itemId
  ])
}

export function listTags(db: Db): TagCount[] {
  return db
    .all(
      `SELECT t.name, count(ie.id) AS n
         FROM tag t LEFT JOIN item_tag it ON it.tagId = t.id LEFT JOIN entity ie ON ie.id=it.itemId AND ie.deletedAt IS NULL
        GROUP BY t.id ORDER BY n DESC, t.name`
    )
    .map((r) => ({ name: String(r.name), count: Number(r.n ?? 0) }))
}

function upsertTag(db: Db, name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('标签名不能为空')
  const existing = db.get(`SELECT id FROM tag WHERE name = ? COLLATE NOCASE`, [trimmed])
  if (existing) return String(existing.id)
  const id = newEntity(db, 'tag')
  db.run(`INSERT INTO tag(id, name) VALUES (?,?)`, [id, trimmed])
  return id
}

// ---------------------------------------------------------------- 文件导入

function blobRelPath(sha256: string, ext: string): string {
  return join('blobs', sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}${ext}`)
}

export async function sha256OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.caj': 'application/caj'
}

export async function stageBlobFile(
  libraryDir: string,
  srcPath: string,
  move = false
): Promise<{ sha256: string; relPath: string; byteSize: number }> {
  const ext = extname(srcPath).toLowerCase()
  const sha256 = await sha256OfFile(srcPath)
  const relPath = blobRelPath(sha256, ext)
  const abs = join(libraryDir, relPath)
  await fs.mkdir(join(libraryDir, 'blobs', sha256.slice(0, 2), sha256.slice(2, 4)), {
    recursive: true
  })
  // 内容寻址：已存在则直接复用，不重复写盘
  try {
    const st = await fs.stat(abs)
    if (st.isFile()&&await sha256OfFile(abs)===sha256) return { sha256, relPath, byteSize: st.size }
  } catch {
    /* 不存在，继续写 */
  }
  if(move){const root=await fs.realpath(join(libraryDir,'.tmp','downloads'));const source=await fs.realpath(srcPath);if(!source.startsWith(root+sep)||ext!=='.pdf')throw new Error('下载暂存文件无效');await fs.rename(source,abs);return {sha256,relPath,byteSize:(await fs.stat(abs)).size}}
  const tmp = `${abs}.tmp-${randomUUID()}`
  await fs.copyFile(srcPath, tmp, constants.COPYFILE_FICLONE)
  await fs.rename(tmp, abs)
  const st = await fs.stat(abs)
  return { sha256, relPath, byteSize: st.size }
}

export interface LinkedFile {absolutePath:string;sha256:string;byteSize:number;modifiedAt:number}
export async function inspectLinkedFile(path:string):Promise<LinkedFile>{
 const absolutePath=await fs.realpath(path),before=await fs.stat(absolutePath)
 if(!before.isFile())throw new Error('请选择本地文件')
 const sha256=await sha256OfFile(absolutePath),after=await fs.stat(absolutePath)
 if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)throw new Error('文件正在变化，请稍后重新导入')
 return {absolutePath,sha256,byteSize:after.size,modifiedAt:after.mtimeMs}
}
export function rememberLinkedFile(db:Db,file:LinkedFile):string{
 const found=db.get('SELECT id FROM external_file_grant WHERE absolutePath=? AND fingerprint=?',[file.absolutePath,file.sha256])
 if(found){db.run('UPDATE external_file_grant SET byteSize=?,modifiedAt=?,verifiedAt=? WHERE id=?',[file.byteSize,file.modifiedAt,nowIso(),found.id]);return String(found.id)}
 const id=randomUUID();db.run('INSERT INTO external_file_grant VALUES(?,?,?,?,?,?)',[id,file.absolutePath,file.sha256,file.byteSize,file.modifiedAt,nowIso()]);return id
}
export function bindLinkedVersion(db:Db,documentId:string,file:LinkedFile,status='ready'):string {
 const grant=rememberLinkedFile(db,file),active=db.get('SELECT v.id,v.fingerprint FROM document d LEFT JOIN document_version v ON v.id=d.activeVersionId WHERE d.id=?',[documentId])
 if(active?.id&&active.fingerprint===file.sha256){db.run('UPDATE document_version SET blobHash=NULL,externalGrantId=? WHERE id=?',[grant,active.id]);return String(active.id)}
 const versionId=newEntity(db,'document');db.run('INSERT INTO document_version(id,documentId,blobHash,externalGrantId,fingerprint,pageCount,status) VALUES(?,?,NULL,?,?,NULL,?)',[versionId,documentId,grant,file.sha256,status]);return versionId
}
/** User-selected local files are linked. Managed storage is reserved for downloaded files. */
type FileImportOptions={mode?:'linked'|'managed';itemId?:string;adopt?:boolean}
let fileImportQueue:Promise<unknown>=Promise.resolve()
export function importPdf(db:Db,libraryDir:string,files:string[],options:FileImportOptions={}):Promise<ImportedDocument[]>{
 const task=fileImportQueue.then(()=>importFiles(db,libraryDir,files,options));fileImportQueue=task.catch(()=>undefined);return task
}
async function importFiles(db:Db,libraryDir:string,files:string[],options:FileImportOptions):Promise<ImportedDocument[]>{
 const out:ImportedDocument[]=[]
 for(const path of files){
  const file=await inspectLinkedFile(path),ext=extname(file.absolutePath).toLowerCase(),contentType=MIME_BY_EXT[ext]??'application/octet-stream',title=basename(path,ext)
  if(options.itemId&&!getItem(db,options.itemId))throw new Error('文献不存在')
  const reused=db.get(`SELECT d.id AS documentId,v.id AS versionId,d.itemId,i.title,v.pageCount FROM document d JOIN document_version v ON v.id=d.activeVersionId JOIN item i ON i.id=d.itemId JOIN entity e ON e.id=i.id WHERE v.fingerprint=? AND e.deletedAt IS NULL AND (? IS NULL OR d.itemId=?) LIMIT 1`,[file.sha256,options.itemId??null,options.itemId??null])
  if(reused){
   if(options.mode!=='managed')db.transaction(()=>{const id=bindLinkedVersion(db,String(reused.documentId),file);db.run("UPDATE document SET activeVersionId=?,availability='managed' WHERE id=?",[id,reused.documentId])})
   out.push({itemId:String(reused.itemId),documentId:String(reused.documentId),documentVersionId:String(reused.versionId),title:String(reused.title),pageCount:reused.pageCount==null?null:Number(reused.pageCount),duplicate:true});continue
  }
  const previous=options.mode!=='managed'?db.get(`SELECT d.id AS documentId,d.itemId FROM document d JOIN document_version v ON v.id=d.activeVersionId JOIN external_file_grant g ON g.id=v.externalGrantId JOIN entity e ON e.id=d.itemId WHERE g.absolutePath=? AND e.deletedAt IS NULL AND (? IS NULL OR d.itemId=?) LIMIT 1`,[file.absolutePath,options.itemId??null,options.itemId??null]):null
  const blob=options.mode==='managed'?await stageBlobFile(libraryDir,file.absolutePath,!!options.adopt):null
  let ids:{itemId:string;documentId:string;versionId:string}
  try{ids=db.transaction(()=>{
   if(options.itemId&&!getItem(db,options.itemId))throw new Error('文献不存在')
   const itemId=options.itemId??(previous?.itemId?String(previous.itemId):newEntity(db,'item'))
   if(!options.itemId&&!previous)db.run("INSERT INTO item(id,type,title,fieldsJson) VALUES(?,'document',?,'{}')",[itemId,title])
   const documentId=previous?String(previous.documentId):newEntity(db,'document')
   if(!previous)db.run("INSERT INTO document(id,itemId,displayName,contentType,availability) VALUES(?,?,?,?,'managed')",[documentId,itemId,basename(path),contentType])
   let versionId:string
   if(blob){db.run('INSERT OR IGNORE INTO file_blob VALUES(?,?,?,?)',[blob.sha256,blob.relPath,blob.byteSize,nowIso()]);versionId=newEntity(db,'document');db.run("INSERT INTO document_version(id,documentId,blobHash,fingerprint,status) VALUES(?,?,?,?,'ready')",[versionId,documentId,blob.sha256,blob.sha256])}
   else versionId=bindLinkedVersion(db,documentId,file)
   db.run("UPDATE document SET activeVersionId=?,availability='managed' WHERE id=?",[versionId,documentId]);return {itemId,documentId,versionId}
  })}catch(e){if(blob&&!db.get('SELECT sha256 FROM file_blob WHERE sha256=?',[blob.sha256]))await fs.rm(join(libraryDir,blob.relPath),{force:true});throw e}
  out.push({itemId:ids.itemId,documentId:ids.documentId,documentVersionId:ids.versionId,title,pageCount:null,duplicate:false})
 }
 return out
}
export async function relinkDocument(db:Db,versionId:string,path:string):Promise<boolean>{
 const version=db.get('SELECT * FROM document_version WHERE id=?',[versionId]);if(!version)throw new Error('附件版本不存在')
 const file=await inspectLinkedFile(path);if(file.sha256!==version.fingerprint)throw new Error('所选文件内容与原附件不同，未更改关联；请导入为新版本')
 db.transaction(()=>{const grant=rememberLinkedFile(db,file);db.run('UPDATE document_version SET blobHash=NULL,externalGrantId=? WHERE id=?',[grant,versionId]);db.run("UPDATE document SET availability='managed' WHERE id=?",[version.documentId]);db.run("UPDATE document_index SET status='pending',error=NULL WHERE documentVersionId=? AND status='failed'",[versionId])});return true
}

export interface ResolvedDocument {
  documentVersionId: string
  documentId: string
  itemId: string | null
  absPath: string
  identity?:{byteSize:number;modifiedAt:number}
  displayName: string
  contentType: string
  pageCount: number | null
}

export async function resolveDocument(db: Db, libraryDir: string, documentVersionId: string): Promise<ResolvedDocument | null> {
  const row = db.get(
    `SELECT v.id, v.pageCount, d.id AS documentId, d.itemId, d.displayName, d.contentType,
            b.relativePath, b.sha256, g.id AS grantId,g.absolutePath,g.fingerprint AS linkedFingerprint
       FROM document_version v
       JOIN document d ON d.id = v.documentId
       LEFT JOIN file_blob b ON b.sha256 = v.blobHash
       LEFT JOIN external_file_grant g ON g.id=v.externalGrantId
      WHERE v.id = ?`,
    [documentVersionId]
  )
  if (!row) return null
  if (!row.relativePath&&!row.absolutePath) return null
  let absPath:string,identity:ResolvedDocument['identity']
  if(row.absolutePath){
   try{const file=await inspectLinkedFile(String(row.absolutePath));if(file.absolutePath!==row.absolutePath||file.sha256!==row.linkedFingerprint)throw new Error('changed');absPath=file.absolutePath;identity={byteSize:file.byteSize,modifiedAt:file.modifiedAt}}
   catch{throw new Error('本地原文件已移动、不可读或内容已改变；请重新定位相同文件，或重新导入新版本')}
  }else absPath=join(libraryDir,String(row.relativePath))
  return {
    documentVersionId: String(row.id),
    documentId: String(row.documentId),
    itemId: (row.itemId as string | null) ?? null,
    absPath,identity,
    displayName: String(row.displayName),
    contentType: String(row.contentType),
    pageCount: row.pageCount === null || row.pageCount === undefined ? null : Number(row.pageCount)
  }
}

export function setPageCount(db: Db, documentVersionId: string, pageCount: number): void {
  db.run(`UPDATE document_version SET pageCount = ? WHERE id = ? AND (pageCount IS NULL OR pageCount <> ?)`, [
    pageCount,
    documentVersionId,
    pageCount
  ])
}

// ---------------------------------------------------------------- 阅读状态

export function getReadingState(db: Db, documentVersionId: string): Row | null {
  return (
    db.get(
      `SELECT pageIndex, anchor, zoom, mode, panes FROM reading_state WHERE documentVersionId = ?`,
      [documentVersionId]
    ) ?? null
  )
}

export function saveReadingState(
  db: Db,
  documentVersionId: string,
  state: { pageIndex: number; anchor?: string | null; zoom?: number; mode?: string; panes?: string | null }
): void {
  db.run(
    `INSERT INTO reading_state(documentVersionId, pageIndex, anchor, zoom, mode, panes)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(documentVersionId) DO UPDATE SET
       pageIndex = excluded.pageIndex,
       anchor = excluded.anchor,
       zoom = excluded.zoom,
       mode = excluded.mode,
       panes = excluded.panes`,
    [
      documentVersionId,
      state.pageIndex,
      state.anchor ?? null,
      state.zoom ?? 1,
      state.mode ?? 'stable',
      state.panes ?? null
    ]
  )
}

export function restoreItem(db:Db,id:string):boolean{
 const row=db.get("SELECT id FROM entity WHERE id=? AND kind='item' AND deletedAt IS NOT NULL",[id]);
 if(!row)return false;
 db.run("UPDATE entity SET deletedAt=NULL,updatedAt=?,revision=revision+1 WHERE id=?",[nowIso(),id]);return true;
}
