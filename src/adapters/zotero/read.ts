import { DatabaseSync } from 'node:sqlite'
import type { Row } from '../../data-service/db'
import type { ZoteroDescriptor } from './probe'

/**
 * 从快照读取源数据。全部在副本上进行，字段与作者角色**按名称映射**，不依赖源数字 ID（§11.3）。
 */

export interface ZoteroCreator {
  order: number
  role: string
  nameMode: 'person' | 'literal'
  givenName: string | null
  familyName: string | null
  literalName: string | null
}

export interface ZoteroAttachment {
  itemID: number
  key: string
  parentKey: string | null
  linkMode: number
  contentType: string | null
  path: string | null
  /** 源库里的 display name，来自 itemData 的 title 字段 */
  title: string | null
}

export interface ZoteroAnnotation {
  itemID: number
  key: string
  parentKey: string
  type: number
  text: string
  comment: string | null
  color: string | null
  pageLabel: string | null
  sortIndex: string
  position: string
}

export interface ZoteroNote {
  itemID: number
  key: string
  parentKey: string | null
  note: string
}

export interface ZoteroItem {
  itemID: number
  key: string
  libraryID: string
  typeName: string
  fields: Record<string, string>
  creators: ZoteroCreator[]
  collectionKeys: string[]
  tags: string[]
  deleted: boolean
  attachments: ZoteroAttachment[]
  notes: ZoteroNote[]
  annotations: ZoteroAnnotation[]
}

export interface ZoteroCollection {
  key: string
  name: string
  parentKey: string | null
  libraryID: string
}

export interface ZoteroLibraryData {
  descriptor: ZoteroDescriptor
  items: ZoteroItem[]
  collections: ZoteroCollection[]
  /** 没有父条目的附件，按 §11.5 作为独立文档条目导入 */
  orphanAttachments: ZoteroAttachment[]
  counts: {
    sourceItems: number
    bibliographic: number
    attachments: number
    notes: number
    annotations: number
    deleted: number
    collections: number
    tags: number
  }
}

const BIBLIO_EXCLUDED = new Set(['attachment', 'note', 'annotation'])

export function readZoteroSnapshot(dbPath: string, descriptor: ZoteroDescriptor): ZoteroLibraryData {
  const db = new DatabaseSync(dbPath, { readOnly: true })

  try {
    const fieldTable = descriptor.fieldTable ?? 'fieldsCombined'

    const typeRows = db.prepare('SELECT itemTypeID, typeName FROM itemTypes').all() as Row[]
    const typeById = new Map<number, string>(
      typeRows.map((r) => [Number(r.itemTypeID), String(r.typeName)])
    )

    const fieldRows = db.prepare(`SELECT fieldID, fieldName FROM ${fieldTable}`).all() as Row[]
    const fieldById = new Map<number, string>(
      fieldRows.map((r) => [Number(r.fieldID), String(r.fieldName)])
    )

    const deletedRows = db.prepare('SELECT itemID FROM deletedItems').all() as Row[]
    const deletedSet = new Set(deletedRows.map((r) => Number(r.itemID)))

    // 字段值：一次读完，避免逐条查询
    const valueRows = db
      .prepare(
        `SELECT d.itemID AS itemID, d.fieldID AS fieldID, v.value AS value
           FROM itemData d JOIN itemDataValues v ON v.valueID = d.valueID`
      )
      .all() as Row[]
    const fieldsByItem = new Map<number, Record<string, string>>()
    for (const r of valueRows) {
      const itemID = Number(r.itemID)
      const name = fieldById.get(Number(r.fieldID))
      if (!name) continue
      const bucket = fieldsByItem.get(itemID) ?? {}
      bucket[name] = String(r.value ?? '')
      fieldsByItem.set(itemID, bucket)
    }

    const creatorRows = db
      .prepare(
        `SELECT ic.itemID AS itemID, ic.orderIndex AS orderIndex, ic.creatorTypeID AS creatorTypeID,
                c.firstName AS firstName, c.lastName AS lastName, c.fieldMode AS fieldMode
           FROM itemCreators ic JOIN creators c ON c.creatorID = ic.creatorID
          ORDER BY ic.itemID, ic.orderIndex`
      )
      .all() as Row[]
    const creatorsByItem = new Map<number, ZoteroCreator[]>()
    for (const r of creatorRows) {
      const itemID = Number(r.itemID)
      const list = creatorsByItem.get(itemID) ?? []
      const mode = Number(r.fieldMode ?? 0)
      list.push({
        order: Number(r.orderIndex ?? 0),
        role: 'author',
        nameMode: mode === 1 ? 'literal' : 'person',
        givenName: r.firstName ? String(r.firstName) : null,
        familyName: r.lastName ? String(r.lastName) : null,
        // 单字段模式下全名存在 lastName
        literalName: mode === 1 && r.lastName ? String(r.lastName) : null
      })
      creatorsByItem.set(itemID, list)
    }

    const collectionRows = db
      .prepare(
        `SELECT collectionID, collectionName, parentCollectionID, key, libraryID FROM collections`
      )
      .all() as Row[]
    const collectionKeyById = new Map<number, string>()
    const collectionById = new Map<number, Row>()
    for (const r of collectionRows) {
      collectionKeyById.set(Number(r.collectionID), String(r.key))
      collectionById.set(Number(r.collectionID), r)
    }
    const collections: ZoteroCollection[] = collectionRows.map((r) => {
      const parentId = r.parentCollectionID === null || r.parentCollectionID === undefined ? null : Number(r.parentCollectionID)
      return {
        key: String(r.key),
        name: String(r.collectionName),
        parentKey: parentId !== null ? (collectionKeyById.get(parentId) ?? null) : null,
        libraryID: String(r.libraryID ?? 1)
      }
    })

    const collectionItemRows = db
      .prepare('SELECT collectionID, itemID FROM collectionItems')
      .all() as Row[]
    const collectionsByItem = new Map<number, string[]>()
    for (const r of collectionItemRows) {
      const itemID = Number(r.itemID)
      const key = collectionKeyById.get(Number(r.collectionID))
      if (!key) continue
      const list = collectionsByItem.get(itemID) ?? []
      list.push(key)
      collectionsByItem.set(itemID, list)
    }

    const tagRows = db.prepare('SELECT tagID, name FROM tags').all() as Row[]
    const tagNameById = new Map<number, string>(tagRows.map((r) => [Number(r.tagID), String(r.name)]))
    const itemTagRows = db.prepare('SELECT itemID, tagID FROM itemTags').all() as Row[]
    const tagsByItem = new Map<number, string[]>()
    for (const r of itemTagRows) {
      const itemID = Number(r.itemID)
      const name = tagNameById.get(Number(r.tagID))
      if (!name) continue
      const list = tagsByItem.get(itemID) ?? []
      list.push(name)
      tagsByItem.set(itemID, list)
    }

    const attachmentRows = db
      .prepare(
        `SELECT a.itemID AS itemID, a.parentItemID AS parentItemID, a.linkMode AS linkMode,
                a.contentType AS contentType, a.path AS path, i.key AS key
           FROM itemAttachments a JOIN items i ON i.itemID = a.itemID`
      )
      .all() as Row[]
    const attachmentsByParent = new Map<number, ZoteroAttachment[]>()
    const orphanAttachments: ZoteroAttachment[] = []
    const attachmentKeyByItem = new Map<number, string>()

    for (const r of attachmentRows) {
      const itemID = Number(r.itemID)
      const key = String(r.key)
      attachmentKeyByItem.set(itemID, key)
      const parentId =
        r.parentItemID === null || r.parentItemID === undefined ? null : Number(r.parentItemID)
      const title = fieldsByItem.get(itemID)?.title ?? null
      const att: ZoteroAttachment = {
        itemID,
        key,
        parentKey: null,
        linkMode: Number(r.linkMode ?? 0),
        contentType: r.contentType ? String(r.contentType) : null,
        path: r.path ? String(r.path) : null,
        title
      }
      if (parentId === null) {
        orphanAttachments.push(att)
      } else {
        const list = attachmentsByParent.get(parentId) ?? []
        list.push(att)
        attachmentsByParent.set(parentId, list)
      }
    }
    // 回填父 key，供文档归属使用
    const itemKeyById = new Map<number, string>()
    for (const r of db.prepare('SELECT itemID, key FROM items').all() as Row[]) {
      itemKeyById.set(Number(r.itemID), String(r.key))
    }

    const noteRows = db
      .prepare(
        `SELECT n.itemID AS itemID, n.parentItemID AS parentItemID, n.note AS note, i.key AS key
           FROM itemNotes n JOIN items i ON i.itemID = n.itemID`
      )
      .all() as Row[]
    const notesByParent = new Map<number, ZoteroNote[]>()
    const orphanNotes: ZoteroNote[] = []
    for (const r of noteRows) {
      const parentId =
        r.parentItemID === null || r.parentItemID === undefined ? null : Number(r.parentItemID)
      const note: ZoteroNote = {
        itemID: Number(r.itemID),
        key: String(r.key),
        parentKey: parentId !== null ? (itemKeyById.get(parentId) ?? null) : null,
        note: String(r.note ?? '')
      }
      if (parentId === null) orphanNotes.push(note)
      else {
        const list = notesByParent.get(parentId) ?? []
        list.push(note)
        notesByParent.set(parentId, list)
      }
    }

    const annotationRows = db
      .prepare(
        `SELECT a.itemID AS itemID, a.parentItemID AS parentItemID, a.type AS type, a.text AS text,
                a.comment AS comment, a.color AS color, a.pageLabel AS pageLabel,
                a.sortIndex AS sortIndex, a.position AS position, i.key AS key
           FROM itemAnnotations a JOIN items i ON i.itemID = a.itemID`
      )
      .all() as Row[]
    const annotationsByAttachment = new Map<number, ZoteroAnnotation[]>()
    for (const r of annotationRows) {
      const parentId = Number(r.parentItemID)
      const key = attachmentKeyByItem.get(parentId) ?? String(parentId)
      const ann: ZoteroAnnotation = {
        itemID: Number(r.itemID),
        key: String(r.key),
        parentKey: key,
        type: Number(r.type ?? 0),
        text: String(r.text ?? ''),
        comment: r.comment ? String(r.comment) : null,
        color: r.color ? String(r.color) : null,
        pageLabel: r.pageLabel ? String(r.pageLabel) : null,
        sortIndex: String(r.sortIndex ?? ''),
        position: String(r.position ?? '{}')
      }
      const list = annotationsByAttachment.get(parentId) ?? []
      list.push(ann)
      annotationsByAttachment.set(parentId, list)
    }

    const itemRows = db
      .prepare('SELECT itemID, itemTypeID, key, libraryID FROM items ORDER BY itemID')
      .all() as Row[]

    const items: ZoteroItem[] = []
    let deleted = 0
    for (const r of itemRows) {
      const itemID = Number(r.itemID)
      const typeName = typeById.get(Number(r.itemTypeID)) ?? 'document'
      if (deletedSet.has(itemID)) {
        deleted += 1
        continue
      }
      if (BIBLIO_EXCLUDED.has(typeName)) continue

      const atts = attachmentsByParent.get(itemID) ?? []
      for (const a of atts) a.parentKey = String(r.key)

      items.push({
        itemID,
        key: String(r.key),
        libraryID: String(r.libraryID ?? 1),
        typeName,
        fields: fieldsByItem.get(itemID) ?? {},
        creators: creatorsByItem.get(itemID) ?? [],
        collectionKeys: collectionsByItem.get(itemID) ?? [],
        tags: tagsByItem.get(itemID) ?? [],
        deleted: false,
        attachments: atts,
        notes: notesByParent.get(itemID) ?? [],
        annotations: atts.flatMap((a) => annotationsByAttachment.get(a.itemID) ?? [])
      })
    }

    const attachmentCount = attachmentRows.length
    const noteCount = noteRows.length
    const annotationCount = annotationRows.length

    return {
      descriptor,
      items,
      collections,
      orphanAttachments,
      counts: {
        sourceItems: itemRows.length,
        bibliographic: items.length,
        attachments: attachmentCount,
        notes: noteCount,
        annotations: annotationCount,
        deleted,
        collections: collections.length,
        tags: tagNameById.size
      }
    }
  } finally {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
}
