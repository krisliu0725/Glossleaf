import type {AnnotationTool} from './ReaderTools'
/** Ephemeral per-document view state. No PDF bytes, credentials or user text are stored here. */
export interface ReaderSession {
 pageCount?:number;page:number;scale:number;fitWidth:number;autoFit:boolean;rotation:number;
 mode:'source'|'bilingual'|'inline';sidebar:boolean;panel:'translation'|'annotations'|'notes';
 filter:'all'|'excerpts'|'notes';tool:AnnotationTool;scrollTop:number;scrollLeft:number;targetScroll:number;
}
export interface ReaderController {documentVersionId:string;leave:()=>Promise<ReaderSession|null|undefined>}
