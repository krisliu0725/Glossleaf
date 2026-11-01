import {normalizeAnnotationComments} from '../../data-service/annotations'
import { promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Db } from '../../data-service/db'
import { inspectLinkedFile,bindLinkedVersion,type LinkedFile } from '../../data-service/repo'
import { createSnapshot, disposeSnapshot, type SnapshotResult } from './snapshot'
import { readZoteroSnapshot, type ZoteroAttachment, type ZoteroCollection } from './read'
import { normalizeItem, stableJson, htmlToText, type NormalizedItem } from './normalize'
import { mergeItem, type Conflict } from './diff'

/**
 * Zotero 导入编排。DESIGN.md §11.6 / §11.7。
 *
 * 流程：检查 → 元数据快照 → 解析 → 校验原文件 → 提交关联 → 发布。
 * 附件仅流式校验并登记路径，不复制 PDF；数据库写入集中在一个事务里，
 * 因此预备数据在提交前不会出现在正常文库中。
 */

export interface ImportReport {
  runId: string
  status: 'published' | 'failed'
  source: {
    path: string
    schemaVersion: string | null
    fingerprint: string
    descriptorReasons: string[]
  }
  counts: {
    bibliographic: number
    attachments: number
    notes: number
    annotations: number
    collections: number
    tags: number
    created: number
    updated: number
    unchanged: number
    /** 来源未变、本地改过，因而保留本地值的条目数（§11.7 第二行） */
    keptLocal: number
    missingFiles: number
    unsupported: number
    skippedTrash: number
    conflicts: number
  }
  warnings: string[]
  conflicts: Array<Conflict & { itemKey: string; title: string }>
  durationMs: number
}

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

function getOrigin(
  db: Db,
  sourceInstanceId: string,
  sourceLibraryId: string,
  entityKind: string,
  externalKey: string
): { id: string; entityId: string } | null {
  const row = db.get(
    `SELECT id, entityId FROM origin_map
      WHERE sourceInstanceId = ? AND sourceLibraryId = ? AND entityKind = ? AND externalKey = ?`,
    [sourceInstanceId, sourceLibraryId, entityKind, externalKey]
  )
  return row ? { id: String(row.id), entityId: String(row.entityId) } : null
}

function putOrigin(
  db: Db,
  sourceInstanceId: string,
  sourceLibraryId: string,
  entityKind: string,
  externalKey: string,
  entityId: string
): string {
  const existing = getOrigin(db, sourceInstanceId, sourceLibraryId, entityKind, externalKey)
  if (existing) {
    if (existing.entityId !== entityId) {
      db.run(`UPDATE origin_map SET entityId = ? WHERE id = ?`, [entityId, existing.id])
    }
    return existing.id
  }
  const id = randomUUID()
  db.run(
    `INSERT INTO origin_map(id, sourceInstanceId, sourceLibraryId, entityKind, externalKey, entityId)
     VALUES (?,?,?,?,?,?)`,
    [id, sourceInstanceId, sourceLibraryId, entityKind, externalKey, entityId]
  )
  return id
}

/** 读取本地当前值，用于三方比较 */
function readLocalNormalized(db: Db, itemId: string): NormalizedItem | null {
  const row = db.get(
    `SELECT type, title, language, date, fieldsJson FROM item WHERE id = ?`,
    [itemId]
  )
  if (!row) return null
  const creatorRows = db.all(
    `SELECT orderIndex, role, nameMode, givenName, familyName, literalName
       FROM item_creator WHERE itemId = ? ORDER BY orderIndex`,
    [itemId]
  )
  const tagRows = db.all(
    `SELECT t.name FROM item_tag it JOIN tag t ON t.id = it.tagId WHERE it.itemId = ?`,
    [itemId]
  )
  const collRows = db.all(
    `SELECT c.id FROM collection_item ci JOIN collection c ON c.id = ci.collectionId WHERE ci.itemId = ?`,
    [itemId]
  )
  return {
    type: String(row.type),
    title: String(row.title),
    language: (row.language as string | null) ?? null,
    date: (row.date as string | null) ?? null,
    fields: JSON.parse(String(row.fieldsJson ?? '{}')) as Record<string, string>,
    creators: creatorRows.map((c, i) => ({
      order: i,
      role: String(c.role),
      nameMode: c.nameMode === 'literal' ? 'literal' : 'person',
      givenName: (c.givenName as string | null) ?? null,
      familyName: (c.familyName as string | null) ?? null,
      literalName: (c.literalName as string | null) ?? null
    })),
    tags: tagRows.map((t) => String(t.name)),
    collectionKeys: collRows.map((c) => String(c.id)),
    documents: [],
    notes: [],
    annotations: []
  }
}

/** 同步版本：逐个候选做 stat，返回第一个存在的真实路径 */
async function statFirst(candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    try {
      const real = await fs.realpath(c)
      const st = await fs.stat(real)
      if (st.isFile()) return real
    } catch {
      /* 下一个 */
    }
  }
  return null
}

function attachmentCandidates(sourceDir: string, att: ZoteroAttachment): string[] {
  const raw = att.path ?? ''
  if (att.linkMode === 0 || att.linkMode === 1) {
    const name = raw.replace(/^storage:/, '')
    const dir = join(sourceDir, 'storage', att.key)
    const forms = new Set<string>([
      name,
      name.replace(/\s+$/, ''),
      name.replace(/^["']|["']$/g, ''),
      name.normalize('NFC')
    ])
    try {
      forms.add(decodeURIComponent(name))
    } catch {
      /* 忽略非法编码 */
    }
    return [...forms].filter(Boolean).map((f) => join(dir, f))
  }
  if (att.linkMode === 2 && isAbsolute(raw)) return [raw]
  return []
}

interface StagedAttachment {
  att: ZoteroAttachment
  parentKey: string | null
  file: LinkedFile | null
  availability: 'managed' | 'missing' | 'pending' | 'url'
  status: 'ready' | 'unsupported'
  reason: string | null
}

export async function importZotero(
  db: Db,
  _libraryDir: string,
  sourceDir: string,
  workRoot: string
): Promise<ImportReport> {
  const started = Date.now()
  const runId = randomUUID()
  const warnings: string[] = []
  const allConflicts: Array<Conflict & { itemKey: string; title: string }> = []

  let snapshot: SnapshotResult | null = null

  db.run(
    `INSERT INTO import_run(id, adapterVersion, status, startedAt) VALUES (?,?, 'running', ?)`,
    [runId, 'zotero-adapter/1', nowIso()]
  )

  try {
    snapshot = await createSnapshot(sourceDir, workRoot)

    if (!snapshot.descriptor.compatible) {
      throw new Error(
        `源库结构与适配器声明不一致，已阻止直接读取：${
          snapshot.descriptor.missingTables.join('、') ||
          snapshot.descriptor.missingColumns.map((c) => `${c.table}.${c.column}`).join('、') ||
          '字段字典不可用'
        }`
      )
    }

    const data = readZoteroSnapshot(snapshot.dbPath, snapshot.descriptor)
    const sourceLibraryId = snapshot.descriptor.libraryIds[0] ?? '1'

    // 来源实例：同目录复用，不因路径变化就当成新库
    const existingInstance = db.get(
      `SELECT id FROM source_instance WHERE kind = 'zotero' AND boundPath = ?`,
      [sourceDir]
    )
    const sourceInstanceId = existingInstance
      ? String(existingInstance.id)
      : (() => {
          const id = randomUUID()
          db.run(
            `INSERT INTO source_instance(id, kind, label, boundPath, descriptorJson, createdAt)
             VALUES (?,?,?,?,?,?)`,
            [
              id,
              'zotero',
              'Zotero 文库',
              sourceDir,
              JSON.stringify(snapshot!.descriptor),
              nowIso()
            ]
          )
          return id
        })()

    const snapshotId = randomUUID()
    db.run(
      `INSERT INTO source_snapshot(id, sourceInstanceId, runId, schemaVersion, descriptorHash, capturedAt)
       VALUES (?,?,?,?,?,?)`,
      [
        snapshotId,
        sourceInstanceId,
        runId,
        snapshot.descriptor.schemaVersion,
        snapshot.fingerprint,
        nowIso()
      ]
    )

    // ---------- 校验原文件（事务之外，不复制附件）----------
    const staged = new Map<string, StagedAttachment>()
    let missingFiles = 0
    let unsupported = 0

    const allAttachments: Array<{ att: ZoteroAttachment; parentKey: string | null }> = []
    for (const item of data.items) {
      for (const a of item.attachments) allAttachments.push({ att: a, parentKey: item.key })
    }
    for (const a of data.orphanAttachments) allAttachments.push({ att: a, parentKey: null })

    for (const { att, parentKey } of allAttachments) {
      const isCaj = (att.contentType ?? '').includes('caj') || /\.caj$/i.test(att.path ?? '')
      if (att.linkMode === 3) {
        staged.set(att.key, {
          att,
          parentKey,
          file: null,
          availability: 'url',
          status: 'ready',
          reason: '网页链接附件'
        })
        continue
      }

      const candidates = attachmentCandidates(sourceDir, att)
      const real = candidates.length > 0 ? await statFirst(candidates) : null
      if (!real) {
        missingFiles += 1
        staged.set(att.key, {
          att,
          parentKey,
          file: null,
          availability: 'pending',
          status: 'ready',
          reason: att.linkMode === 2 ? '外链文件未找到，标记为待定位' : '受管理文件未找到，标记为待定位'
        })
        continue
      }

      const file = await inspectLinkedFile(real)
      if (isCaj) {
        unsupported += 1
        staged.set(att.key, {
          att,
          parentKey,
          file,
          availability: 'managed',
          status: 'unsupported',
          reason: 'CAJ 格式暂不支持阅读'
        })
        continue
      }
      staged.set(att.key, {
        att,
        parentKey,
        file,
        availability: 'managed',
        status: 'ready',
        reason: null
      })
    }

    // ---------- 单事务提交 ----------
    let created = 0
    let updated = 0
    let unchanged = 0
    let keptLocal = 0

    db.transaction(() => {
      // 集合：先按父子顺序建，再写成员
      const ordered = orderCollections(data.collections)
      const collectionIdByKey = new Map<string, string>()
      for (const c of ordered) {
        const origin = getOrigin(db, sourceInstanceId, sourceLibraryId, 'collection', c.key)
        let id = origin?.entityId ?? null
        if (!id) {
          id = newEntity(db, 'collection')
          db.run(`INSERT INTO collection(id, name, parentId) VALUES (?,?,NULL)`, [id, c.name])
        } else {
          db.run(`UPDATE collection SET name = ? WHERE id = ?`, [c.name, id])
          db.run(`UPDATE entity SET updatedAt = ?, revision = revision + 1 WHERE id = ?`, [nowIso(), id])
        }
        collectionIdByKey.set(c.key, id)
        putOrigin(db, sourceInstanceId, sourceLibraryId, 'collection', c.key, id)
      }
      // 父子关系单独一遍，避免顺序依赖
      for (const c of data.collections) {
        const id = collectionIdByKey.get(c.key)
        if (!id) continue
        const parentId = c.parentKey ? (collectionIdByKey.get(c.parentKey) ?? null) : null
        db.run(`UPDATE collection SET parentId = ? WHERE id = ?`, [parentId, id])
      }

      // 标签字典
      const tagIdByName = new Map<string, string>()
      const ensureTag = (name: string): string => {
        const cached = tagIdByName.get(name.toLowerCase())
        if (cached) return cached
        const row = db.get(`SELECT id FROM tag WHERE name = ? COLLATE NOCASE`, [name])
        let id: string
        if (row) id = String(row.id)
        else {
          id = newEntity(db, 'tag')
          db.run(`INSERT INTO tag(id, name) VALUES (?,?)`, [id, name])
        }
        tagIdByName.set(name.toLowerCase(), id)
        return id
      }

      // 文献
      for (const src of data.items) {
        const source = normalizeItem(src)
        const origin = getOrigin(db, sourceInstanceId, sourceLibraryId, 'item', src.key)
        let itemId = origin?.entityId ?? null

        let merged = source
        let itemConflicts: Conflict[] = []

        if (itemId) {
          const local = readLocalNormalized(db, itemId)
          const revRow = db.get(
            `SELECT normalizedJson FROM origin_revision WHERE originMapId = ? ORDER BY rowid DESC LIMIT 1`,
            [origin!.id]
          )
          const base = revRow ? (JSON.parse(String(revRow.normalizedJson)) as NormalizedItem) : null
          const outcome = mergeItem(base, local, source)
          merged = outcome.merged
          itemConflicts = outcome.conflicts
          if (outcome.kept.length > 0) keptLocal += 1

          if (stableJson(merged) === stableJson(local ?? source) && itemConflicts.length === 0) {
            unchanged += 1
          } else {
            updated += 1
          }
        } else {
          itemId = newEntity(db, 'item')
          created += 1
        }

        // 写主表
        db.run(
          `INSERT INTO item(id, type, title, fieldsJson, language, date, datePrecision)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             type = excluded.type, title = excluded.title, fieldsJson = excluded.fieldsJson,
             language = excluded.language, date = excluded.date`,
          [
            itemId,
            merged.type,
            merged.title,
            JSON.stringify(merged.fields),
            merged.language,
            merged.date,
            null
          ]
        )

        if (origin) {
          db.run(`UPDATE entity SET updatedAt = ?, revision = revision + 1 WHERE id = ?`, [nowIso(), itemId])
        }

        // 作者
        db.run(`DELETE FROM item_creator WHERE itemId = ?`, [itemId])
        merged.creators.forEach((c, i) => {
          db.run(
            `INSERT INTO item_creator(itemId, orderIndex, role, nameMode, givenName, familyName, literalName)
             VALUES (?,?,?,?,?,?,?)`,
            [itemId, i, c.role || 'author', c.nameMode, c.givenName, c.familyName, c.literalName]
          )
        })

        // 附件 → document + version
        for (const doc of src.attachments) {
          const st = staged.get(doc.key)
          if (!st) continue
          const docOrigin = getOrigin(db, sourceInstanceId, sourceLibraryId, 'document', doc.key)
          let documentId = docOrigin?.entityId ?? null

          if (!documentId) {
            documentId = newEntity(db, 'document')
          }

          // 先落 document 行：document_version.documentId 有外键指向它
          db.run(
            `INSERT INTO document(id, itemId, displayName, contentType, activeVersionId, availability)
             VALUES (?,?,?,?,NULL,?)
             ON CONFLICT(id) DO UPDATE SET
               itemId = excluded.itemId,
               displayName = excluded.displayName,
               contentType = excluded.contentType,
               availability = excluded.availability`,
            [
              documentId,
              itemId,
              st.att.title ?? doc.title ?? doc.path ?? doc.key,
              doc.contentType,
              st.availability
            ]
          )

          const prevRow = db.get(`SELECT activeVersionId FROM document WHERE id = ?`, [documentId])
          let versionId: string | null = (prevRow?.activeVersionId as string | null) ?? null

          if(st.file)versionId=bindLinkedVersion(db,documentId,st.file,st.status)

          if (versionId) {
            db.run(`UPDATE document SET activeVersionId = ? WHERE id = ?`, [versionId, documentId])
          }

          putOrigin(db, sourceInstanceId, sourceLibraryId, 'document', doc.key, documentId)

          if (st.reason) warnings.push(`${st.att.title ?? doc.key}：${st.reason}`)
        }

        // 笔记
        for (const n of src.notes) {
          const noteOrigin = getOrigin(db, sourceInstanceId, sourceLibraryId, 'note', n.key)
          const noteId = noteOrigin?.entityId ?? newEntity(db, 'note')
          db.run(
            `INSERT INTO note(id, itemId, format, body, importedOriginalHtml)
             VALUES (?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET itemId = excluded.itemId, body = excluded.body`,
            [noteId, itemId, 'html', htmlToText(n.note), n.note]
          )
          putOrigin(db, sourceInstanceId, sourceLibraryId, 'note', n.key, noteId)
        }

        // 标注
        for (const ann of source.annotations) {
          const attOrigin = getOrigin(db, sourceInstanceId, sourceLibraryId, 'document', ann.parentSourceKey)
          if (!attOrigin) continue
          const versionRow = db.get(`SELECT activeVersionId FROM document WHERE id = ?`, [
            attOrigin.entityId
          ])
          const versionId = (versionRow?.activeVersionId as string | null) ?? null
          if (!versionId) continue

          const annOrigin = getOrigin(db, sourceInstanceId, sourceLibraryId, 'annotation', ann.sourceKey)
          const previousAnnotation=annOrigin?db.get('SELECT documentVersionId FROM annotation WHERE id=?',[annOrigin.entityId]):null
          const annId = annOrigin&&previousAnnotation?.documentVersionId===versionId ? annOrigin.entityId : newEntity(db, 'annotation')
          const anchors = [
            {
              documentVersionId: versionId,
              pageIndex: ann.pageIndex,
              pageLabel: ann.pageLabel ?? undefined,
              rects: ann.rects,
              exact: ann.quote
            }
          ]
          db.run(
            `INSERT INTO annotation(id, documentVersionId, type, quote, comment, color, anchorsJson, translationRecordId)
             VALUES (?,?,?,?,?,?,?,NULL)
             ON CONFLICT(id) DO UPDATE SET
               type = excluded.type, quote = excluded.quote, comment = excluded.comment,
               color = excluded.color, anchorsJson = excluded.anchorsJson`,
            [annId, versionId, ann.type==='note'&&!ann.comment?.trim()?'source':ann.type, ann.quote, db.get("SELECT id FROM annotation WHERE highlightId=? AND type='note'",[annId])?'':ann.comment, ann.color, JSON.stringify(anchors)]
          )
          db.run("UPDATE annotation SET paletteId='zotero',sourcePayload=? WHERE id=?",[ann.originalJson??null,annId])
          putOrigin(db, sourceInstanceId, sourceLibraryId, 'annotation', ann.sourceKey, annId)
        }

        // 集合成员：只增不减由来源贡献的那部分
        const currentCollections = db
          .all(`SELECT collectionId, originSourceId FROM collection_item WHERE itemId = ?`, [itemId])
          .map((r) => ({ id: String(r.collectionId), sourceId: (r.originSourceId as string | null) ?? null }))
        const targetIds = source.collectionKeys
          .map((k) => collectionIdByKey.get(k))
          .filter((v): v is string => Boolean(v))

        // 本地显式移除过的关系不再补回
        const overridden = new Set(
          db
            .all(`SELECT targetId FROM relation_override WHERE entityId = ? AND relationKind = 'collection'`, [
              itemId
            ])
            .map((r) => String(r.targetId))
        )

        for (const cid of targetIds) {
          if (overridden.has(cid)) continue
          db.run(
            `INSERT INTO collection_item(collectionId, itemId, origin, originSourceId)
             VALUES (?,?,'source',?)
             ON CONFLICT(collectionId, itemId) DO UPDATE SET origin = 'source', originSourceId = excluded.originSourceId`,
            [cid, itemId, sourceInstanceId]
          )
        }
        for (const cur of currentCollections) {
          if (!targetIds.includes(cur.id) && cur.sourceId === sourceInstanceId) {
            db.run(`DELETE FROM collection_item WHERE collectionId = ? AND itemId = ?`, [cur.id, itemId])
          }
        }

        // 标签成员
        const currentTags = db
          .all(
            `SELECT it.tagId AS tagId, it.originSourceId AS src, t.name AS name
               FROM item_tag it JOIN tag t ON t.id = it.tagId WHERE it.itemId = ?`,
            [itemId]
          )
          .map((r) => ({ tagId: String(r.tagId), name: String(r.name), src: (r.src as string | null) ?? null }))
        const overrideTags = new Set(
          db
            .all(`SELECT targetId FROM relation_override WHERE entityId = ? AND relationKind = 'tag'`, [itemId])
            .map((r) => String(r.targetId))
        )
        const sourceTagIds = new Set<string>()
        for (const name of source.tags) {
          const tid = ensureTag(name)
          sourceTagIds.add(tid)
          if (overrideTags.has(tid)) continue
          db.run(
            `INSERT INTO item_tag(itemId, tagId, origin, originSourceId)
             VALUES (?,?,'source',?)
             ON CONFLICT(itemId, tagId) DO UPDATE SET originSourceId = excluded.originSourceId`,
            [itemId, tid, sourceInstanceId]
          )
        }
        for (const cur of currentTags) {
          if (!sourceTagIds.has(cur.tagId) && cur.src === sourceInstanceId) {
            db.run(`DELETE FROM item_tag WHERE itemId = ? AND tagId = ?`, [itemId, cur.tagId])
          }
        }

        // 基线
        const mapId = putOrigin(db, sourceInstanceId, sourceLibraryId, 'item', src.key, itemId)
        db.run(`DELETE FROM origin_revision WHERE originMapId = ?`, [mapId])
        db.run(
          `INSERT INTO origin_revision(id, originMapId, snapshotId, rawJson, normalizedJson, sourceRevision)
           VALUES (?,?,?,?,?,?)`,
          [
            randomUUID(),
            mapId,
            snapshotId,
            JSON.stringify(src.fields),
            stableJson(source),
            String(src.itemID)
          ]
        )

        // 冲突记录
        for (const c of itemConflicts) {
          db.run(
            `INSERT INTO import_conflict(id, runId, entityId, field, localJson, sourceJson, baseJson, createdAt)
             VALUES (?,?,?,?,?,?,?,?)`,
            [
              randomUUID(),
              runId,
              itemId,
              c.field,
              JSON.stringify(c.local),
              JSON.stringify(c.source),
              JSON.stringify(c.base),
              nowIso()
            ]
          )
          allConflicts.push({ ...c, itemKey: src.key, title: merged.title })
        }
      }

      normalizeAnnotationComments(db,true)

      // 孤立附件：作为独立文档条目导入
      for (const a of data.orphanAttachments) {
        const st = staged.get(a.key)
        if (!st) continue
        const origin = getOrigin(db, sourceInstanceId, sourceLibraryId, 'item', a.key)
        let itemId = origin?.entityId ?? null
        if (!itemId) {
          itemId = newEntity(db, 'item')
          db.run(
            `INSERT INTO item(id, type, title, fieldsJson, language, date, datePrecision)
             VALUES (?, 'document', ?, '{}', NULL, NULL, NULL)`,
            [itemId, a.title ?? a.key]
          )
          created += 1
        }
        let documentId = getOrigin(db, sourceInstanceId, sourceLibraryId, 'document', a.key)?.entityId
        if (!documentId) documentId = newEntity(db, 'document')

        db.run(
          `INSERT INTO document(id, itemId, displayName, contentType, activeVersionId, availability)
           VALUES (?,?,?,?,NULL,?)
           ON CONFLICT(id) DO UPDATE SET itemId = excluded.itemId, availability = excluded.availability`,
          [
            documentId,
            itemId,
            a.title ?? a.path ?? a.key,
            a.contentType ?? 'application/octet-stream',
            st.availability
          ]
        )

        if(st.file){const versionId=bindLinkedVersion(db,documentId,st.file,st.status);db.run('UPDATE document SET activeVersionId=? WHERE id=?',[versionId,documentId])}

        putOrigin(db, sourceInstanceId, sourceLibraryId, 'item', a.key, itemId)
        putOrigin(db, sourceInstanceId, sourceLibraryId, 'document', a.key, documentId)
      }

      // 运行结果
      db.run(
        `UPDATE import_run SET status = 'published', finishedAt = ?, sourceInstanceId = ?, snapshotId = ?
          WHERE id = ?`,
        [nowIso(), sourceInstanceId, snapshotId, runId]
      )
    })

    const report: ImportReport = {
      runId,
      status: 'published',
      source: {
        path: sourceDir,
        schemaVersion: snapshot.descriptor.schemaVersion,
        fingerprint: snapshot.fingerprint,
        descriptorReasons: snapshot.descriptor.reasons
      },
      counts: {
        bibliographic: data.items.length,
        attachments: data.counts.attachments,
        notes: data.counts.notes,
        annotations: data.counts.annotations,
        collections: data.counts.collections,
        tags: data.counts.tags,
        created,
        updated,
        unchanged,
        keptLocal,
        missingFiles,
        unsupported,
        skippedTrash: data.counts.deleted,
        conflicts: allConflicts.length
      },
      warnings,
      conflicts: allConflicts,
      durationMs: Date.now() - started
    }

    db.run(`UPDATE import_run SET countsJson = ?, warningsJson = ?, conflictsJson = ? WHERE id = ?`, [
      JSON.stringify(report.counts),
      JSON.stringify(warnings),
      JSON.stringify(allConflicts.map((c) => ({ itemKey: c.itemKey, field: c.field }))),
      runId
    ])

    return report
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    db.run(`UPDATE import_run SET status = 'failed', finishedAt = ?, error = ? WHERE id = ?`, [
      nowIso(),
      message,
      runId
    ])
    throw e
  } finally {
    if (snapshot) await disposeSnapshot(snapshot.dir)
  }
}

/** 按父子关系排序，保证父集合先于子集合建立 */
function orderCollections(collections: ZoteroCollection[]): ZoteroCollection[] {
  const byKey = new Map(collections.map((c) => [c.key, c]))
  const out: ZoteroCollection[] = []
  const seen = new Set<string>()

  const visit = (c: ZoteroCollection, depth: number): void => {
    if (seen.has(c.key) || depth > 32) return
    seen.add(c.key)
    if (c.parentKey) {
      const parent = byKey.get(c.parentKey)
      if (parent) visit(parent, depth + 1)
    }
    out.push(c)
  }

  for (const c of collections) visit(c, 0)
  return out
}
