/** 领域对象。字段命名与 DESIGN.md §10.2 对应，未列出的字段一律放 fieldsJson，不静默丢弃。 */

export type EntityKind = 'item' | 'collection' | 'tag' | 'document' | 'annotation' | 'note'

export interface Entity {
  id: string
  kind: EntityKind
  createdAt: string
  updatedAt: string
  revision: number
  deletedAt: string | null
}

export type NameMode = 'person' | 'literal'

export interface Creator {
  order: number
  role: string
  nameMode: NameMode
  givenName: string | null
  familyName: string | null
  literalName: string | null
}

export interface ItemSummary {
  id: string
  type: string
  title: string
  language: string | null
  date: string | null
  creators: string
  year: string | null
  documentCount: number
  annotationCount: number
  hasPdf: boolean
  updatedAt: string
  publicationTitle?:string
  noteCount?:number
  translatedCount?:number
}

export interface ItemDetail extends ItemSummary {
  fields: Record<string, string>
  creatorsList: Creator[]
  tags: string[]
  collections: Array<{ id: string; name: string }>
  documents: DocumentSummary[]
  notes: NoteSummary[]
}

export interface DocumentSummary {
  id: string
  displayName: string
  contentType: string
  storageMode?:'linked'|'managed'
  availability: 'managed' | 'missing' | 'pending' | 'url'
  activeVersionId: string | null
  pageCount: number | null
  byteSize: number | null
}

export interface NoteSummary {
  importedOriginalHtml?: string | null
  id: string
  format: string
  body: string
  createdAt: string
}

export interface CollectionNode {
  id: string
  name: string
  parentId: string | null
  itemCount: number
}

export interface TagCount {
  name: string
  count: number
}

export interface LibraryStats {
  items: number
  documents: number
  annotations: number
  notes: number
  collections: number
  tags: number
  totalBytes: number
}

export interface BackupSummary {
  id: string
  createdAt: string
  schemaVersion: number
  byteSize: number
  blobCount: number
  counts: Record<string, number>
  /** 校验是否通过；未通过不得用于恢复 */
  verified: boolean
  path: string
}

export interface ImportedDocument {
  itemId: string
  documentId: string
  documentVersionId: string
  title: string
  pageCount: number | null
  duplicate: boolean
}
