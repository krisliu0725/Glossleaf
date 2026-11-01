export interface ReaderBookmark {id:string;pageIndex:number;title:string;createdAt:string}
export interface ReadingTools {
 pageLabels:string[];printedStart:number|null;bookmarks:ReaderBookmark[];singlePage:boolean;
 paper:'original'|'rice'|'night';brightness:number;noteFont:'kai'|'serif'|'sans';noteLayout:'auto'|'drawer'
}
export const DEFAULT_READING_TOOLS:ReadingTools={pageLabels:[],printedStart:null,bookmarks:[],singlePage:false,paper:'original',brightness:1,noteFont:'kai',noteLayout:'auto'}
export function effectivePageLabels(tools:Pick<ReadingTools,'pageLabels'|'printedStart'>,count:number):string[]{return Array.from({length:count},(_,i)=>tools.printedStart!==null?String(tools.printedStart+i):tools.pageLabels[i]||String(i+1))}
/** An exact printed label takes precedence. Signed values always mean a relative PDF-page jump. */
export function parsePageDestination(value:string,current:number,count:number,labels:readonly string[]):number|null {
 const text=value.trim();if(!text||!count)return null
 if(/^[+-]\d+$/.test(text))return Math.max(1,Math.min(count,current+Number(text)))
 const matches=labels.flatMap((label,i)=>label.toLocaleLowerCase()===text.toLocaleLowerCase()?[i+1]:[])
 if(matches.length===1)return matches[0]
 if(/^\d+$/.test(text)&&Number(text)>=1&&Number(text)<=count)return Number(text)
 return null
}
export interface MarginEntry {id:string;top:number;height:number}
/** Stable, one-pass packing; called for the visible page and its immediate neighbours only. */
export function packMarginEntries(entries:MarginEntry[],limit:number):Array<MarginEntry&{naturalTop:number}>{let bottom=8;return [...entries].sort((a,b)=>a.top-b.top||a.id.localeCompare(b.id)).map(e=>{const naturalTop=e.top,top=Math.max(bottom,Math.min(e.top,Math.max(8,limit-e.height-8)));bottom=top+e.height+10;return {...e,naturalTop,top}})}
