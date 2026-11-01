import { DatabaseSync } from 'node:sqlite'
import type { Row } from '../../data-service/db'

/**
 * Zotero 源结构探针。DESIGN.md §11.3。
 *
 * 判定原则：**结构是契约，版本号只做记录**。
 * 不用「版本 ≥ N 都接受」代替兼容性判断，也不因为版本号陌生就拒绝一个结构完全匹配的库。
 */

export interface ZoteroDescriptor {
  compatible: boolean
  /** 源库 version 表里的 userdata 版本，仅记录 */
  schemaVersion: string | null
  /** 探测到的 Zotero 版本标识（若源库有） */
  sourceLabel: string | null
  missingTables: string[]
  missingColumns: Array<{ table: string; column: string }>
  itemCount: number
  itemTypeCount: number
  libraryIds: string[]
  reasons: string[]
  /** 字段字典用哪张表：fieldsCombined 优先，缺列时回落 fields */
  fieldTable: 'fieldsCombined' | 'fields' | null
}

interface Requirement {
  table: string
  columns: string[]
  optional?: boolean
}

const REQUIRED: Requirement[] = [
  { table: 'items', columns: ['itemID', 'itemTypeID', 'key', 'libraryID'] },
  { table: 'itemTypes', columns: ['itemTypeID', 'typeName'] },
  { table: 'itemData', columns: ['itemID', 'fieldID', 'valueID'] },
  { table: 'itemDataValues', columns: ['valueID', 'value'] },
  { table: 'creators', columns: ['creatorID', 'firstName', 'lastName', 'fieldMode'] },
  { table: 'itemCreators', columns: ['itemID', 'creatorID', 'creatorTypeID', 'orderIndex'] },
  { table: 'collections', columns: ['collectionID', 'collectionName', 'parentCollectionID', 'key', 'libraryID'] },
  { table: 'collectionItems', columns: ['collectionID', 'itemID'] },
  { table: 'tags', columns: ['tagID', 'name'] },
  { table: 'itemTags', columns: ['itemID', 'tagID'] },
  { table: 'itemAttachments', columns: ['itemID', 'parentItemID', 'linkMode', 'contentType', 'path'] },
  { table: 'itemNotes', columns: ['itemID', 'parentItemID', 'note'] },
  { table: 'itemAnnotations', columns: ['itemID', 'parentItemID', 'type', 'text', 'comment', 'color', 'position'] },
  { table: 'deletedItems', columns: ['itemID'], optional: true }
]

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Row[]
    return new Set(rows.map((r) => String(r.name)))
  } catch {
    return new Set()
  }
}

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as Row | undefined
  return Boolean(row)
}

export function probeZoteroSnapshot(snapshotPath: string): ZoteroDescriptor {
  const db = new DatabaseSync(snapshotPath, { readOnly: true })
  const missingTables: string[] = []
  const missingColumns: Array<{ table: string; column: string }> = []
  const reasons: string[] = []

  try {
    for (const req of REQUIRED) {
      if (!tableExists(db, req.table)) {
        if (!req.optional) missingTables.push(req.table)
        continue
      }
      const cols = tableColumns(db, req.table)
      for (const c of req.columns) {
        if (!cols.has(c)) missingColumns.push({ table: req.table, column: c })
      }
    }

    // 字段字典：fieldsCombined 优先（含自定义字段），缺失则回落 fields
    let fieldTable: ZoteroDescriptor['fieldTable'] = null
    if (tableExists(db, 'fieldsCombined') && tableColumns(db, 'fieldsCombined').has('fieldName')) {
      fieldTable = 'fieldsCombined'
    } else if (tableExists(db, 'fields') && tableColumns(db, 'fields').has('fieldName')) {
      fieldTable = 'fields'
      reasons.push('源库缺少 fieldsCombined，回落到 fields；自定义字段可能缺失')
    } else {
      missingTables.push('fieldsCombined / fields')
    }

    let schemaVersion: string | null = null
    if (tableExists(db, 'version')) {
      const cols = tableColumns(db, 'version')
      if (cols.has('schema') && cols.has('version')) {
        const row = db.prepare(`SELECT version FROM version WHERE schema = 'userdata'`).get() as Row | undefined
        schemaVersion = row ? String(row.version) : null
      }
    }

    let itemCount = 0
    let itemTypeCount = 0
    let libraryIds: string[] = []
    try {
      itemCount = Number((db.prepare('SELECT count(*) AS n FROM items').get() as Row).n)
      itemTypeCount = Number((db.prepare('SELECT count(*) AS n FROM itemTypes').get() as Row).n)
      const libs = db.prepare('SELECT DISTINCT libraryID FROM items').all() as Row[]
      libraryIds = libs.map((r) => String(r.libraryID))
    } catch (e) {
      reasons.push(`读取条目计数失败：${e instanceof Error ? e.message : String(e)}`)
    }

    const compatible = missingTables.length === 0 && missingColumns.length === 0 && fieldTable !== null
    if (!compatible) {
      reasons.push('源库结构与适配器声明的结构不一致，已阻止直接读取')
    }

    return {
      compatible,
      schemaVersion,
      sourceLabel: schemaVersion ? `Zotero userdata ${schemaVersion}` : null,
      missingTables,
      missingColumns,
      itemCount,
      itemTypeCount,
      libraryIds,
      reasons,
      fieldTable
    }
  } finally {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
}
