import type { PdfAnchor, Segment } from './m3'

export interface ReaderPreferences {
 defaultMode: 'source'|'bilingual'
 defaultZoom: number
 glossSize: number
 paperTint: boolean
 statusDots: boolean
 track: 'current'|'all'
 autoTranslate: boolean
 inlineEnabled: boolean
 showIgnored: boolean
 split: number
}
export const DEFAULT_READER: ReaderPreferences = {defaultMode:'source',defaultZoom:1,glossSize:17,paperTint:false,statusDots:false,track:'current',autoTranslate:false,inlineEnabled:false,showIgnored:false,split:55}
export interface BlockOverride {id:string;action:'replace'|'ignore'|'merge';segment?:Segment}
export interface ReaderData { overrides:BlockOverride[]; edits:Record<string,{source:string;text:string}> }
export const EMPTY_READER_DATA: ReaderData = {overrides:[],edits:{}}
export function segmentAnchors(s:Segment,documentVersionId:string):PdfAnchor[] {
 return s.parts?.map(p=>({documentVersionId,pageIndex:p.pageIndex,rects:p.rects,exact:p.text})) ?? [{documentVersionId,pageIndex:s.pageIndex,rects:s.rects,exact:s.text}]
}
