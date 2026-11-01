import type { NormalizedItem } from './normalize'
import { stableJson } from './normalize'

/**
 * 三方差异合并。DESIGN.md §11.7。
 *
 * B = 上次导入基线，L = 本地当前值，S = 来源本次值。
 * 默认永不覆盖本地修改；同一字段两端都改时保留本地并记冲突。
 */

export interface Conflict {
  field: string
  base: unknown
  local: unknown
  source: unknown
}

export interface MergeOutcome {
  merged: NormalizedItem
  conflicts: Conflict[]
  /** 从来源采纳的字段 */
  applied: string[]
  /** 因本地已修改而保留的字段 */
  kept: string[]
}

type Pick = { value: unknown; from: 'base' | 'local' | 'source' | 'equal'; conflict: boolean }

function pick(base: unknown, local: unknown, source: unknown): Pick {
  const b = stableJson(base)
  const l = stableJson(local)
  const s = stableJson(source)

  if (l === b && s !== b) return { value: source, from: 'source', conflict: false }
  if (s === b && l !== b) return { value: local, from: 'local', conflict: false }
  if (l === s) return { value: local, from: 'equal', conflict: false }
  // 两端都改且不同：保留本地
  return { value: local, from: 'local', conflict: true }
}

export function mergeItem(
  base: NormalizedItem | null,
  local: NormalizedItem | null,
  source: NormalizedItem
): MergeOutcome {
  // 新条目：直接采用来源
  if (!base || !local) {
    return { merged: source, conflicts: [], applied: ['*'], kept: [] }
  }

  const conflicts: Conflict[] = []
  const applied: string[] = []
  const kept: string[] = []

  const scalar = (key: 'type' | 'title' | 'language' | 'date'): unknown => {
    const r = pick(base[key], local[key], source[key])
    if (r.conflict) {
      conflicts.push({ field: key, base: base[key], local: local[key], source: source[key] })
      kept.push(key)
    } else if (r.from === 'source') applied.push(key)
    else if (r.from === 'local') kept.push(key)
    return r.value
  }

  const merged: NormalizedItem = {
    type: String(scalar('type')),
    title: String(scalar('title')),
    language: (scalar('language') as string | null) ?? null,
    date: (scalar('date') as string | null) ?? null,
    fields: {},
    creators: local.creators,
    tags: local.tags,
    collectionKeys: local.collectionKeys,
    documents: local.documents,
    notes: local.notes,
    annotations: local.annotations
  }

  // 字段级合并
  const fieldKeys = new Set([
    ...Object.keys(base.fields),
    ...Object.keys(local.fields),
    ...Object.keys(source.fields)
  ])
  for (const k of fieldKeys) {
    const r = pick(base.fields[k], local.fields[k], source.fields[k])
    if (r.value !== undefined) merged.fields[k] = String(r.value)
    if (r.conflict) {
      conflicts.push({
        field: `fields.${k}`,
        base: base.fields[k],
        local: local.fields[k],
        source: source.fields[k]
      })
      kept.push(`fields.${k}`)
    } else if (r.from === 'source') applied.push(`fields.${k}`)
    else if (r.from === 'local') kept.push(`fields.${k}`)
  }

  // 作者作为整体比较：顺序与机构名都不可拆
  const cr = pick(base.creators, local.creators, source.creators)
  if (cr.conflict) {
    conflicts.push({ field: 'creators', base: base.creators, local: local.creators, source: source.creators })
    kept.push('creators')
  } else if (cr.from === 'source') {
    merged.creators = source.creators
    applied.push('creators')
  } else if (cr.from === 'local') {
    kept.push('creators')
  }

  return { merged, conflicts, applied, kept }
}

/**
 * 集合成员关系合并：只增不减由来源贡献的那部分。
 * 返回要新增的、要移除的（仅来源贡献），本地新增永不删除。
 */
export function mergeMembership(
  baseKeys: string[],
  localKeys: string[],
  sourceKeys: string[],
  localOriginKeys: Set<string>
): { add: string[]; remove: string[] } {
  const base = new Set(baseKeys)
  const local = new Set(localKeys)
  const source = new Set(sourceKeys)

  const add: string[] = []
  const remove: string[] = []

  for (const k of source) {
    if (!local.has(k)) add.push(k)
  }
  for (const k of base) {
    // 来源这次没有了，且本地这条关系是来源贡献的、且本地没显式覆盖 → 撤销
    if (!source.has(k) && local.has(k) && localOriginKeys.has(k)) remove.push(k)
  }
  return { add, remove }
}
