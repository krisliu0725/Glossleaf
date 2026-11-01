import english from './ui-en.json'
export type Locale = 'zh' | 'en'
const en: Record<string, string> = english
const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ')
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const chineseNames: Record<string, string> = { '文库': '书府', '摘录': '撷英', '术语表': '释名', '译文': '笺注', '翻译设置': '翻译服务', '外观与数据设置': '文房', '双语': '对读', '行间 · 实验': '夹注 · 实验', '笔记': '札记' }
function chinese(key: string): string {
 return chineseNames[key] ?? key.replace(/文库|文集/g, '书府').replace(/双语/g, '对读').replace(/行间原型/g, '夹注实验')
}
function interpolate(pattern: string, values: readonly unknown[]): string {
 const nouns: Record<string,string> = {documents:'document',versions:'version',pages:'page',files:'file',attachments:'attachment',requests:'request',paragraphs:'paragraph',models:'model',records:'record',weeks:'week',sessions:'session',items:'item',excerpts:'excerpt',characters:'character',words:'word',checks:'check',notes:'note'}
 pattern = pattern.replace(/\{(\d+)\} (documents|versions|pages|files|attachments|requests|paragraphs|models|records|weeks|sessions|items|excerpts|characters|words|checks|notes)\b/g, (match, index:string, noun:string) => Number(String(values[Number(index)]).replace(/,/g,'')) === 1 ? '{'+index+'} '+nouns[noun] : match)

 return pattern.replace(/\{(\d+)\}/g, (_, i: string) => String(values[Number(i)] ?? ''))
}
// Only application-owned strings pass through this catalog. Documents and user text never do.
const reverse = new Map(Object.entries(en).map(([zh, english]) => [english, zh]))
const patterns = Object.entries(en).filter(([key]) => /\{\d+\}/.test(key)).sort(([a],[b]) => b.replace(/\{\d+\}/g,'').length-a.replace(/\{\d+\}/g,'').length).map(([zh, translated]) => {
 const keys: number[] = []
 const source = escape(zh).replace(/\\\{(\d+)\\\}/g, (_, i: string) => {keys.push(Number(i));return '([\\s\\S]*?)'})
 const enKeys: number[] = []
 const enSource = escape(translated).replace(/\\\{(\d+)\\\}/g, (_, i: string) => {enKeys.push(Number(i));return '([\\s\\S]*?)'})
 return {zh, translated, keys, pattern: new RegExp('^' + source + '$'), enKeys, englishPattern: new RegExp('^' + enSource + '$')}
})
export function localize(value: string, locale: Locale, values: readonly unknown[] = []): string {
 if (value.trimStart().startsWith('[')) {
  try {
   const issues: unknown = JSON.parse(value)
   if (Array.isArray(issues) && issues.length && issues.every(issue => issue && typeof issue.message === 'string' && typeof issue.code === 'string'))
    return issues.map(issue => localize(issue.message, locale)).join('\n')
  } catch { /* Non-validation responses remain untouched. */ }
 }
 const key = normalize(value)
 if (Object.hasOwn(en, key)) return interpolate(locale === 'en' ? en[key] : chinese(key), values)
 if (locale === 'zh' && reverse.has(key)) return chinese(reverse.get(key)!)
 // Status values may have been created before the user switched the interface language.
 for (const entry of patterns) {
  const match = entry.pattern.exec(key) ?? (locale === 'zh' ? entry.englishPattern.exec(key) : null)
  if (match) {
   const args: unknown[] = [];
   (entry.pattern.test(key) ? entry.keys : entry.enKeys).forEach((index, i) => args[index] = match[i + 1])
   return interpolate(locale === 'en' ? entry.translated : chinese(entry.zh), args)
  }
 }
 return value
}
export const uiCatalog = en
