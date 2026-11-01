import { useEffect, useState } from 'react'
import { localize } from '@shared/localization'

/** One concept, one name: 书府 Library / 展笺 Reader. 小传 Memoir remains a separate insights page. */

export type Locale = 'zh' | 'en'

export interface Strings {
  app: string
  settings: string
  nav: { dashboard: string; library: string; reader: string }
  navHint: { dashboard: string; library: string; reader: string }
  dash: {
    overline: string
    panel: { overview: string; reading: string; research: string; models: string }
    title: { overview: string; reading: string; research: string; models: string }
    range: { d7: string; d30: string; d90: string; all: string }
    refresh: string
    exportAll: string
    enterLibrary: string
    appearance: string
    localOnly: string
    since: string
    sources: string
    activity: string
    inventory: string
    documents: string
    topics: string
    confirmTopics: string
    heatmap: string
    heatmapNote: string
    readingList: string
    daily: string
    less: string
    more: string
    emptyTopics: string
    profile: string
    profileNote: string
    rename: string
  }
  lib: {
    all: string
    recent: string
    collections: string
    tags: string
    import: string
    search: string
  }
  common: { close: string; cancel: string; save: string; back: string; loading: string }
}

const zh: Strings = {
  app: '笺',
  settings: '文房',
  nav: { dashboard: '小传', library: '书府', reader: '展笺' },
  navHint: { dashboard: '小传 · 个人与使用统计', library: '书府 · 文献管理', reader: '展笺 · 沉浸阅读' },
  dash: {
    overline: '小传',
    panel: { overview: '卷首', reading: '日课', research: '志趣', models: '用度' },
    title: { overview: '卷首', reading: '日课', research: '志趣', models: '用度' },
    range: { d7: '最近 7 天', d30: '最近 30 天', d90: '最近 90 天', all: '自开始记录' },
    refresh: '刷新',
    exportAll: '导出完整数据',
    enterLibrary: '进入书府',
    appearance: '外观与数据',
    localOnly: '仅存本机',
    since: '始于',
    sources: '统计说明',
    activity: '本期间使用',
    inventory: '书府现状',
    documents: '文献',
    topics: '研究方向',
    confirmTopics: '编辑分类',
    heatmap: '阅读热力图',
    heatmapNote: '每个小格是一天，颜色越深表示当天有效阅读越久。实心浅格表示范围内没有活动记录，轮廓格表示不在本次统计范围或属于未来日期。',
    readingList: '阅读过的文献',
    daily: '逐日明细',
    less: '少',
    more: '多',
    emptyTopics: '还没有研究方向',
    profile: '本地用户',
    profileNote: '数据只保存在这台电脑上，不上传。',
    rename: '改名'
  },
  lib: {
    all: '全部文献',
    recent: '最近添加',
    collections: '卷帙',
    tags: '题签',
    import: '导入文件',
    search: '考索文献、正文、撷英'
  },
  common: { close: '关闭', cancel: '取消', save: '保存', back: '返回', loading: '读取中' }
}

const en: Strings = {
  app: 'Glossleaf',
  settings: 'Settings',
  nav: { dashboard: 'Memoir', library: 'Library', reader: 'Reader' },
  navHint: { dashboard: 'Memoir · Profile and reading insights', library: 'Library · Your documents', reader: 'Reader · Read and annotate' },
  dash: {
    overline: 'Memoir',
    panel: { overview: 'Preface', reading: 'Journal', research: 'Themes', models: 'Ledger' },
    title: { overview: 'Preface', reading: 'Journal', research: 'Themes', models: 'Ledger' },
    range: { d7: 'Last 7 days', d30: 'Last 30 days', d90: 'Last 90 days', all: 'All time' },
    refresh: 'Refresh',
    exportAll: 'Export history',
    enterLibrary: 'Open Library',
    appearance: 'Settings',
    localOnly: 'Local only',
    since: 'Since',
    sources: 'About these numbers',
    activity: 'This period',
    inventory: 'In your library',
    documents: 'Documents',
    topics: 'Research',
    confirmTopics: 'Edit classification',
    heatmap: 'Reading heatmap',
    heatmapNote: 'One square per day. Darker means more active reading; pale squares mean no recorded activity in range; outlined squares are outside the query or in the future.',
    readingList: 'Documents read',
    daily: 'Daily detail',
    less: 'less',
    more: 'more',
    emptyTopics: 'No research areas yet',
    profile: 'Local user',
    profileNote: 'Everything stays on this computer.',
    rename: 'Rename'
  },
  lib: {
    all: 'All documents',
    recent: 'Recently added',
    collections: 'Collections',
    tags: 'Tags',
    import: 'Import files',
    search: 'Search documents, text, excerpts'
  },
  common: { close: 'Close', cancel: 'Cancel', save: 'Save', back: 'Back', loading: 'Loading' }
}

const DICTS: Record<Locale, Strings> = { zh, en }
const STORAGE_KEY = 'jian.locale'
const listeners = new Set<() => void>()

function readInitial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* 隐私模式下 localStorage 可能不可用 */
  }
  return 'zh'
}

let current: Locale = readInitial()

export function getLocale(): Locale {
  return current
}

export function setLocale(next: Locale): void {
  void window.jian.preferences.set({ locale: next })
  hydrateLocale(next)
}

/** Startup reads must not overwrite a newer preference from another renderer. */
export function hydrateLocale(next: Locale): void {
  document.title = next === 'en' ? 'Glossleaf — A place for what you read' : '笺 · 读有所归'
  if (next === current) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* 忽略写入失败，仅本次会话生效 */
  }
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
  document.documentElement.dataset.locale = next
  document.title = next === 'en' ? 'Glossleaf — A place for what you read' : '笺 · 读有所归'
  for (const fn of listeners) fn()
}

export function strings(locale: Locale = current): Strings {
  return DICTS[locale]
}

export function useStrings(): Strings {
  const [locale, setLocal] = useState<Locale>(current)
  useEffect(() => {
    const fn = (): void => setLocal(current)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return DICTS[locale]
}

export function useLocale(): [Locale, (next: Locale) => void] {
  const [locale, setLocal] = useState<Locale>(current)
  useEffect(() => {
    const fn = (): void => setLocal(current)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return [locale, setLocale]
}

/* ---------- 本地用户名 ---------- */

const NAME_KEY = 'jian.username'
const nameListeners = new Set<() => void>()
let currentName: string = (() => {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
})()

export function getUsername(): string {
  return currentName
}

export function setUsername(next: string): void {
  currentName = next.trim()
  try {
    if (currentName) localStorage.setItem(NAME_KEY, currentName)
    else localStorage.removeItem(NAME_KEY)
  } catch {
    /* 忽略 */
  }
  for (const fn of nameListeners) fn()
}

export function useUsername(): [string, (next: string) => void] {
  const [name, setLocal] = useState(currentName)
  useEffect(() => {
    const fn = (): void => setLocal(currentName)
    nameListeners.add(fn)
    return () => {
      nameListeners.delete(fn)
    }
  }, [])
  return [name, setUsername]
}

document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en'
document.documentElement.dataset.locale = current

/** Translate application UI only; never pass document text or user values here. */
export function ui(value: string | null | undefined, ...args: unknown[]): string {
 return localize(value ?? '', current, args)
}
export function dateLocale(): string { return current === 'zh' ? 'zh-CN' : 'en-US' }

document.title = current === 'en' ? 'Glossleaf — A place for what you read' : '笺 · 读有所归'
