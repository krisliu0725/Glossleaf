import type { Creator } from '../../shared/domain'
import type { ZoteroItem } from './read'

/**
 * 源条目 → 内部规范化结构。DESIGN.md §11.3。
 *
 * 两条原则：
 * - 未知文献类型不伪装成期刊论文，统一落到 `other` 并保留原始类型名。
 * - 未知字段原样保留，不静默丢弃。
 */

export interface NormalizedDocument {
  sourceKey: string
  parentSourceKey: string | null
  displayName: string
  contentType: string
  linkMode: number
  path: string | null
  title: string | null
}

export interface NormalizedNote {
  sourceKey: string
  bodyHtml: string
  plainText: string
}

export interface NormalizedAnnotation {
  sourceKey: string
  parentSourceKey: string
  type: string
  quote: string
  comment: string | null
  color: string | null
  pageLabel: string | null
  sortIndex: string
  pageIndex: number
  rects: number[][]
  originalJson?:string
}

export interface NormalizedItem {
  type: string
  title: string
  language: string | null
  date: string | null
  fields: Record<string, string>
  creators: Creator[]
  tags: string[]
  collectionKeys: string[]
  documents: NormalizedDocument[]
  notes: NormalizedNote[]
  annotations: NormalizedAnnotation[]
}

/** 我们明确支持编辑的类型。其余落到 other，只读展示。 */
const KNOWN_TYPES = new Set([
  'journalArticle',
  'book',
  'bookSection',
  'conferencePaper',
  'thesis',
  'report',
  'webpage',
  'preprint',
  'manuscript',
  'newspaperArticle',
  'magazineArticle',
  'document',
  'dataset',
  'patent',
  'letter',
  'interview',
  'film',
  'artwork',
  'audioRecording',
  'videoRecording',
  'presentation',
  'map',
  'blogPost',
  'forumPost',
  'encyclopediaArticle',
  'dictionaryEntry',
  'case',
  'statute',
  'bill',
  'hearing',
  'email',
  'instantMessage',
  'podcast',
  'radioBroadcast',
  'tvBroadcast',
  'computerProgram'
])

const ANNOTATION_TYPES: Record<number, string> = {
  1: 'highlight',
  2: 'note',
  3: 'image',
  4: 'ink',
  5: 'underline',
  6: 'text'
}

/** 去掉 HTML 标签，保留可读文本；用于检索与纯文本展示，原始 HTML 另存 */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parsePosition(raw: string): { pageIndex: number; rects: number[][] } {
  try {
    const obj = JSON.parse(raw) as { pageIndex?: number; rects?: number[][] }
    const pageIndex = Number.isFinite(obj.pageIndex) ? Number(obj.pageIndex) : 0
    const rects = Array.isArray(obj.rects)
      ? obj.rects.filter((r) => Array.isArray(r) && r.length === 4).map((r) => r.map(Number))
      : []
    return { pageIndex, rects }
  } catch {
    return { pageIndex: 0, rects: [] }
  }
}

export function normalizeItem(item: ZoteroItem): NormalizedItem {
  const known = KNOWN_TYPES.has(item.typeName)
  const fields: Record<string, string> = {}

  for (const [name, value] of Object.entries(item.fields)) {
    if (name === 'title' || name === 'date' || name === 'language') continue
    fields[name] = value
  }
  if (!known) {
    fields.__sourceType = item.typeName
    fields.__unknownType = '1'
  }

  const documents: NormalizedDocument[] = item.attachments.map((a) => ({
    sourceKey: a.key,
    parentSourceKey: item.key,
    displayName: a.title ?? a.path?.replace(/^storage:/, '') ?? a.key,
    contentType: a.contentType ?? 'application/octet-stream',
    linkMode: a.linkMode,
    path: a.path,
    title: a.title
  }))

  const notes: NormalizedNote[] = item.notes.map((n) => ({
    sourceKey: n.key,
    bodyHtml: n.note,
    plainText: htmlToText(n.note)
  }))

  const annotations: NormalizedAnnotation[] = item.annotations.map((a) => {
    const pos = parsePosition(a.position)
    return {
      originalJson:JSON.stringify(a),
      sourceKey: a.key,
      parentSourceKey: a.parentKey,
      type: ANNOTATION_TYPES[a.type] ?? 'source',
      quote: a.text,
      comment: a.comment,
      color: a.color,
      pageLabel: a.pageLabel,
      sortIndex: a.sortIndex,
      pageIndex: pos.pageIndex,
      rects: pos.rects
    }
  })

  return {
    type: known ? item.typeName : 'other',
    title: item.fields.title ?? '',
    language: item.fields.language ?? null,
    date: item.fields.date ?? null,
    fields,
    creators: item.creators.map((c, i) => ({
      order: i,
      role: c.role,
      nameMode: c.nameMode,
      givenName: c.givenName,
      familyName: c.familyName,
      literalName: c.literalName
    })),
    tags: [...new Set(item.tags)],
    collectionKeys: [...new Set(item.collectionKeys)],
    documents,
    notes,
    annotations
  }
}

/** 用于三方比较的稳定序列化：键排序，避免对象键序导致误判「已修改」 */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>
      return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sort(obj[k])]))
    }
    return v
  }
  return JSON.stringify(sort(value))
}
