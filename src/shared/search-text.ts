/** Search normalization v1: keep a UTF-16 offset map back to the unchanged source. */
export function normalizeText(raw: string): { text: string; offsets: Array<[number, number]> } {
 let text = '', index = 0; const offsets: Array<[number, number]> = []
 for (const cp of raw) {
  const start = index; index += cp.length
  const normalized = cp.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  for (let n = 0; n < normalized.length; n++) offsets.push([start, index])
  text += normalized
 }
 return { text, offsets }
}
export function queryTokens(raw: string): string[] {
 return [...new Set((normalizeText(raw).text.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12).map(token => /^[a-z]+$/.test(token) && token.length > 5 ? token.replace(/ies$/, 'y').replace(/y$/, '').replace(/(?:ing|ed|es|s)$/, '') : token))].filter(Boolean)
}
export function matches(text: string, tokens: string[]): Array<[number,number]> | null {
 const ranges: Array<[number,number]> = []
 for (const token of tokens) {
  let at = -1, from = 0
  while ((at = text.indexOf(token, from)) >= 0) {
   if (!/^[a-z]+$/.test(token) || at === 0 || !/[a-z]/.test(text[at - 1])) break
   from = at + 1
  }
  if (at < 0) return null
  ranges.push([at, at + token.length])
 }
 return ranges
}
export function snippet(raw: string, normalized: ReturnType<typeof normalizeText>, ranges: Array<[number,number]>): { snippet: string; marks: Array<[number,number]>; rawRanges: Array<[number,number]> } {
 const rawRanges = ranges.map(([start,end]) => [normalized.offsets[start]?.[0] ?? 0, normalized.offsets[end-1]?.[1] ?? 0] as [number,number])
 const first = Math.min(...rawRanges.map(r => r[0])), start = Math.max(0, first-55), end = Math.min(raw.length, first+180)
 const prefix = start ? '…' : '', suffix = end < raw.length ? '…' : ''
 return { snippet: prefix + raw.slice(start,end) + suffix, marks: rawRanges.filter(([a,b]) => b > start && a < end).map(([a,b]) => [Math.max(a,start)-start+prefix.length, Math.min(b,end)-start+prefix.length]), rawRanges }
}
export function ftsQuery(tokens: string[]): string | null {
 const long = tokens.filter(t => Array.from(t).length >= 3)
 return long.length ? long.map(t => '"'+t.replace(/"/g,'""')+'"').join(' AND ') : null
}
