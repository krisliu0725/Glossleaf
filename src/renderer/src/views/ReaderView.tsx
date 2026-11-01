import {ColorChoices,ColorLabel,NotesPanel,NotePopover,useAnnotationHistory,usePalette} from '../reader/AnnotationTools'
import {palette,annotationDraft,containsAnchors,type AnnotationDraft} from '@shared/annotations'
import {scrollWithin,cancelScroll} from '../reader/motion'
import Mark from '../design/Mark'
import type {ReaderController,ReaderSession} from '../reader/session'
import {type AnnotationTool} from '../reader/ReaderTools'
import ReaderViewOptions from '../reader/ReaderViewOptions'
import ReaderNavigator,{usePdfChapters} from '../reader/ReaderNavigator'
import {anchorClientRect} from '../reader/MarginRail'
import Brand from '../design/Brand'
import HomeSwitch from '../design/HomeSwitch'
import SelectionTools from '../reader/SelectionTools'
import {useReadingTools} from '../reader/useReadingTools'
import {effectivePageLabels} from '@shared/reading-tools'
import PageLocator from '../reader/PageLocator'
import ExportDialog from '../m4/ExportDialog'
import {CITATION_STYLES,type CitationStyle} from '@shared/m4'
import Menu from '../design/Menu'
import GlossBlock from '../reader/GlossBlock'
import {useReaderPreferences} from '../reader/preferences'
import {documentBlocks,detectLanguage,ignored} from '../reader/layout/document'
import {normalizeBlockText} from '../reader/layout/analyze'
import {EMPTY_READER_DATA,segmentAnchors,type ReaderData} from '@shared/reader'
import type {GlossaryEntry} from '@shared/m3'

import { ui,getLocale } from '../i18n'
import DocumentFind from '../m4/DocumentFind';
import type { ReaderLocation, SearchHit } from '@shared/m4';
import type { PDFPageProxy } from 'pdfjs-dist';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { paragraphInput } from '@shared/m3';
import type { Annotation, DocumentJob, PdfAnchor, ProviderSettings, Segment, TranslationResult } from '@shared/m3';
import { usePdfDocument } from '../reader/usePdfDocument';
import PdfPage from '../reader/PdfPage';
import InlinePdfPage from '../reader/InlinePdfPage';
import { captureSourceAnchor, collectSourceSelection, type PageElement } from '../reader/inline/selection';
import useReadingActivity from '../analytics/useReadingActivity';

import GlossaryDialog from '../reader/GlossaryDialog';
import Dialog from '../reader/Dialog';
import type { OpenedDocument } from '../env';
interface Props {
    ref?:React.Ref<ReaderController>;
    initialSession?:ReaderSession;
    documentTabs?:React.ReactNode;
    documentVersionId: string;
    title: string;
    location?: ReaderLocation;
    onBack: () => void;
    onDashboard: () => void;
    onSettings:(section?:'general'|'reading'|'translation'|'library'|'advanced',itemId?:string|null)=>void;
}
type BlockState = {
    state: 'queued' | 'loading' | 'completed' | 'failed' | 'needs_review';
    text: string;
    result?: TranslationResult;
    error?: string;
};
interface Selection {
    clipboardText?:string;
    fromTranslation?:boolean;
    comment?: string;
    quote: string;
    anchors: PdfAnchor[];
    context: string;
    result?: TranslationResult;
    state?: string;
    text?: string;
    error?: string;
}
const EMPTY_ANNOTATIONS:Annotation[]=[],EMPTY_SEGMENTS:Segment[]=[];
export default function ReaderView({ documentVersionId, title, location, onBack, onDashboard, onSettings,ref:controllerRef,initialSession,documentTabs }: Props): React.ReactElement {
    const prefs=useReaderPreferences();
    const colorSettings=usePalette();
    const {tools:readingTools,ready:toolsReady,error:toolsError,update:updateTools}=useReadingTools(documentVersionId);
    const [dockOpen,setDockOpen]=useState(false),[focused,setFocused]=useState(false),[zoomBusy,setZoomBusy]=useState(false);
    const [notesMode,setNotesMode]=useState<'overview'|'hidden'>('hidden'),[navOpen,setNavOpen]=useState(false),[navTab,setNavTab]=useState<'outline'|'thumbnails'|'bookmarks'>('outline');
    const [infoOpen,setInfoOpen]=useState(false),[shortcutsOpen,setShortcutsOpen]=useState(false),[nativeLabelsReady,setNativeLabelsReady]=useState(false),[metadataPages,setMetadataPages]=useState<string|null>(null);
    const [narrow,setNarrow]=useState(innerWidth<1100),[selectionResult,setSelectionResult]=useState<{quote:string;text:string;state:string;error?:string}|null>(null);
    const scrollQuiet=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),zoomQuiet=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),metadataPageAttempted=useRef(false),noteCursor=useRef(''),restoreMotion=useRef(0);
    type ReadingSpot={page:string;point:[number,number];offset:[number,number]};
    const noteBefore=useRef<ReadingSpot|null>(null),noteOriginRevision=useRef(0),navReturn=useRef<{notes:typeof notesMode;sidebar:boolean}|null>(null);
    useEffect(()=>{const media=matchMedia('(max-width:1099px)'),resize=()=>setNarrow(media.matches),observer=new ResizeObserver(resize);media.addEventListener('change',resize);window.addEventListener('resize',resize);window.addEventListener('focus',resize);observer.observe(document.documentElement);resize();return()=>{observer.disconnect();media.removeEventListener('change',resize);window.removeEventListener('resize',resize);window.removeEventListener('focus',resize);clearTimeout(scrollQuiet.current);clearTimeout(zoomQuiet.current)}},[]);

    const [tool,setTool]=useState<AnnotationTool>(initialSession?.tool??'select'),[exportOpen,setExportOpen]=useState(false);
    const [rotation,setRotation]=useState(initialSession?.rotation??0),[placing,setPlacing]=useState(false),[noteFilter,setNoteFilter]=useState<'all'|'excerpts'|'notes'>(initialSession?.filter??'all');
    const [noteEditor,setNoteEditor]=useState<{draft:AnnotationDraft;element:HTMLElement|null;key:string;position?:{left:number;top:number};record:{current:Annotation|null}}|null>(null);
    const [highlightEditor,setHighlightEditor]=useState<{rows:Annotation[];index:number;x:number;y:number}|null>(null);
    const [flash,setFlash]=useState('');
    const [authorNames,setAuthorNames]=useState<string[]>([]),[referenceLine,setReferenceLine]=useState('');
    const [readerData,setReaderData]=useState<ReaderData>(EMPTY_READER_DATA),[readerReady,setReaderReady]=useState(false),[terms,setTerms]=useState<GlossaryEntry[]>([]);
    const [sidebar,setSidebar]=useState(initialSession?.sidebar??(prefs.defaultMode==='bilingual')),[split]=useState(prefs.split),[contextMenu,setContextMenu]=useState<{x:number;y:number;id:string|null;kind:'source'|'translation';selection?:Selection;point?:{x:number;y:number;element:HTMLElement}}|null>(null),[editing,setEditing]=useState<{segment:Segment;text:string}|null>(null),[saveBusy,setSaveBusy]=useState(false);
    const autoPages=useRef(new Set<number>());
    const [findOpen, setFindOpen] = useState(false), [searchLocation, setSearchLocation] = useState<ReaderLocation | undefined>(location);
    const jumpedSearch = useRef(false);
    const [scrollCheckpoint, setScrollCheckpoint] = useState(0);
    const sourceScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [opened, setOpened] = useState<OpenedDocument | null>(null), [error, setError] = useState(''), [scale, setScale] = useState(initialSession?.scale??prefs.defaultZoom), [currentPage, setCurrentPage] = useState(location?location.pageIndex+1:initialSession?.page??1), [mode, setMode] = useState<'source' | 'bilingual' | 'inline'>(initialSession?.mode??prefs.defaultMode);
    useReadingActivity(documentVersionId, currentPage);
    const [inlineStatus, setInlineStatus] = useState<Record<number, string | null>>({});
    const reportInline = useCallback((page: number, reason: string | null) => setInlineStatus(s => s[page] === reason ? s : {...s, [page]: reason}), []);

    const selectionToolbar=useRef<HTMLDivElement>(null),selectionBox=useRef<DOMRect|null>(null),[selectionExpanded,setSelectionExpanded]=useState(false),[selectionMessage,setSelectionMessage]=useState('');
    const [selectionPosition,setSelectionPosition]=useState({left:120,top:110});
    const [selection, setSelection] = useState<Selection | null>(null), [provider, setProvider] = useState<ProviderSettings | null>(null), [glossary, setGlossary] = useState<{
        source: string;
        target: string;
    } | null>(null), [jobs, setJobs] = useState<DocumentJob[]>([]), [confirmJob, setConfirmJob] = useState(false), [feedback, setFeedback] = useState('');
    const source = useRef<HTMLElement>(null), target = useRef<HTMLElement>(null), requests = useRef(new Map<string, string>()), generation = useRef(0), restored = useRef(false), programmatic = useRef(0), selectionRef = useRef<Selection | null>(null), pageRun = useRef(0), cacheLookups = useRef(new Set<string>()), completedJobs = useRef(new Set<string>()), mounted = useRef(true);
    const [pages, setPages] = useState<Record<number, Segment[]>>({}), [active, setActive] = useState<string | null>(null), [blocks, setBlocks] = useState<Record<string, BlockState>>({}), [annotations, setAnnotations] = useState<Annotation[]>([]), [panel, setPanel] = useState<'translation' | 'annotations' | 'notes'>(initialSession?.panel??'translation');
    const [sourceWidth,setSourceWidth]=useState(1280),[pageWidth,setPageWidth]=useState(612),[fitWidth,setFitWidth]=useState(initialSession?.fitWidth??800);
    const renderScale=scale*Math.max(.2,fitWidth/pageWidth),renderScaleRef=useRef(renderScale);renderScaleRef.current=renderScale;
    const fitReady=useRef(!!initialSession),autoFit=useRef(initialSession?.autoFit??true);
    const availableWidth=()=>Math.min(840,Math.max(180,(source.current?.clientWidth??912)-88));
    useEffect(()=>{let frame=0,timer:ReturnType<typeof setTimeout>|undefined;const measure=()=>{const el=source.current;if(!el)return;setSourceWidth(el.clientWidth);if(!fitReady.current){fitReady.current=true;setFitWidth(availableWidth())}};const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure)});if(source.current)observer.observe(source.current);measure();const resize=()=>{clearTimeout(timer);timer=setTimeout(()=>{measure();if(autoFit.current){rememberReadingPosition();setFitWidth(availableWidth())}},150)};window.addEventListener('resize',resize);return()=>{observer.disconnect();cancelAnimationFrame(frame);clearTimeout(timer);window.removeEventListener('resize',resize)}},[documentVersionId]);
    selectionRef.current = selection;
    const url = opened ? `jian://doc/${opened.token}` : null, { doc, error: pdfError, loading } = usePdfDocument(url);
    const chapters=usePdfChapters(doc),pageLabels=useMemo(()=>effectivePageLabels(readingTools,doc?.numPages??0),[readingTools.pageLabels,readingTools.printedStart,doc]);
    const annotationsByPage=useMemo(()=>{const map=new Map<number,Annotation[]>();for(const a of annotations)for(const i of new Set(a.anchors.map(x=>x.pageIndex))){const group=map.get(i)??[];group.push(a);map.set(i,group)}return map},[annotations]);
    useEffect(()=>{if(!doc||!toolsReady)return;let live=true;void doc.getPageLabels().then(async labels=>{if(!live)return;const actual=labels?.some((label,i)=>label!==String(i+1))?labels:[];if(actual?.length)await updateTools({pageLabels:actual});if(live)setNativeLabelsReady(true)}).catch(()=>{if(live)setNativeLabelsReady(true)});return()=>{live=false}},[doc,toolsReady,updateTools]);
    useEffect(()=>{if(!toolsReady||!nativeLabelsReady||metadataPages===null||metadataPageAttempted.current)return;metadataPageAttempted.current=true;const first=/^(\d+)\s*[-–—]/.exec(metadataPages.trim());if(readingTools.printedStart===null&&!readingTools.pageLabels.length&&first)void updateTools({printedStart:Number(first[1])})},[toolsReady,nativeLabelsReady,metadataPages,readingTools,updateTools]);

    useEffect(()=>{if(!doc)return;let dead=false;void doc.getPage(1).then(p=>{if(!dead)setPageWidth(p.getViewport({scale:1,rotation:p.rotate+rotation}).width)});return()=>{dead=true}},[doc,rotation]);
    const segments=useMemo(()=>documentBlocks(pages,readerData,{authors:authorNames}),[pages,readerData,authorNames]);
    const detectedLanguage=useMemo(()=>doc&&Object.keys(pages).length===doc.numPages?detectLanguage(segments):null,[doc,pages,segments]);
    const sameLanguage=!!detectedLanguage&&detectedLanguage===provider?.targetLanguage.toLowerCase().split(/[-_]/)[0];
    const visibleSegments=useMemo(()=>segments.filter(s=>prefs.showIgnored||!ignored(s)),[segments,prefs.showIgnored]);
    const displayByPage=useMemo(()=>{const map=new Map<number,Segment[]>();for(const s of visibleSegments)for(const i of new Set(s.parts?.map(p=>p.pageIndex)??[s.pageIndex])){const rows=map.get(i)??[];rows.push(s);map.set(i,rows)}return map},[visibleSegments]);
    const currentSegments=segments.filter(s=>(s.pageIndex===currentPage-1||s.parts?.some(p=>p.pageIndex===currentPage-1))&&!ignored(s));
    const translating=currentSegments.some(s=>blocks[s.id]?.state==='loading');
    const complete=currentSegments.length>0&&currentSegments.every(s=>blocks[s.id]?.result||readerData.edits[(provider?.targetLanguage??'')+':'+s.id]?.source===s.text);
    const failed=currentSegments.filter(s=>blocks[s.id]?.state==='failed');
    const numbers = useMemo(() => doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [], [doc]);
    const pdfLabels=useMemo(()=>numbers.map(String),[numbers]);
    const refreshProvider = useCallback(() => { void window.jian.m3.settings().then(r => { if (r.ok)
        setProvider(r.data); }); }, []);
    const refreshAnnotations = useCallback(async () => { const r = await window.jian.m3.annotations(documentVersionId); if (r.ok)
        setAnnotations(r.data);
    else
        setError(r.error.message); }, [documentVersionId]);
    const pendingNoteFocus=useRef<string|null>(null);
    const noteReturn=useRef<{scroll:number;panel:string}|null>(null);
    useLayoutEffect(()=>{if(!noteEditor&&noteReturn.current){if(target.current&&panel===noteReturn.current.panel)target.current.scrollTop=noteReturn.current.scroll;noteReturn.current=null}},[!!noteEditor,panel]);
    useLayoutEffect(()=>{const id=pendingNoteFocus.current;if(noteEditor||!id)return;const marker=source.current?.querySelector<HTMLElement>('[data-annotation-marker="'+id+'"],[data-cluster-members~="'+id+'"]');if(marker){marker.focus({preventScroll:true});pendingNoteFocus.current=null}},[noteEditor,annotations]);
    const annotationHistory=useAnnotationHistory(documentVersionId,refreshAnnotations,setError);
    const catchAnnotation=(work:Promise<unknown>)=>void work.catch(e=>setError(e instanceof Error?e.message:String(e)));
    const noteTransition=useRef(false);
    async function commitNoteAction(action:()=>void):Promise<void>{if(noteTransition.current)return;noteTransition.current=true;try{if(noteLeave.current&&!await noteLeave.current())return;action()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{noteTransition.current=false}}
    function editNote(a:Annotation,element:HTMLElement|null=null):void{if(tool==='erase'){catchAnnotation(removeAnnotation(a));return}if(noteEditor?.record.current?.id===a.id)return;void commitNoteAction(()=>{beginNoteLayout();rememberReadingPosition();setSelection(null);setHighlightEditor(null);setNoteEditor({draft:annotationDraft(a),element,key:a.id,record:{current:a}})})}
    function startNote(anchors=selection?.anchors,quote=selection?.quote??'',element:HTMLElement|null=null,position=selectionPosition,comment=''):void{
        if(!anchors?.length){noteCurrentPage();return}const captured=anchors;
        void commitNoteAction(()=>{const parent=annotations.find(a=>a.type!=='note'&&containsAnchors(a.anchors,captured)),draft:AnnotationDraft={documentVersionId,type:'note',anchors:(parent?.anchors??captured).map(a=>({...a,pageLabel:pageLabels[a.pageIndex]??String(a.pageIndex+1)})),quote,comment,color:parent?.color??'#DEA85B',paletteId:parent?.paletteId??'porcelain',slot:parent?.slot??2,highlightId:parent?.id??null};beginNoteLayout();rememberReadingPosition();setNoteEditor({draft,element,position,key:crypto.randomUUID(),record:{current:null}});setSelection(null);window.getSelection()?.removeAllRanges();setHighlightEditor(null);setPlacing(false)})
    }
    async function copySelection():Promise<void>{if(!selection)return;const text=selection.fromTranslation?selection.text??selection.quote:selection.clipboardText??selection.quote,r=await window.jian.clipboard.writeText(text);setSelectionMessage(r.ok?ui('已复制'):ui(r.error.message))}
    async function copyQuotedPassage():Promise<void>{
        if(!selection||!opened?.itemId)return;
        const picked=selection,stored=localStorage.getItem('jian.citation-style'),style=(CITATION_STYLES.some(s=>s.id===stored)?stored:'gbt') as CitationStyle;
        const r=await window.jian.m4.exportPreview([opened.itemId],'citation',style);if(!r.ok){setSelectionMessage(ui(r.error.message));return}
        const pages=[...new Set(picked.anchors.map(a=>pageLabels[a.pageIndex]??String(a.pageIndex+1)))].join(', '),quote=picked.fromTranslation?picked.text??picked.quote:picked.clipboardText??picked.quote;
        const result=await window.jian.clipboard.writeText(quote+'\n\n'+(r.data.inText??'')+' · p. '+pages+'\n'+r.data.content);setSelectionMessage(result.ok?ui('引文已复制'):ui(result.error.message));
    }
    async function exportReaderNotes(includeQuotes=true):Promise<void>{const r=await window.jian.m3.exportNotes({documentVersionId,ids:annotations.filter(a=>['note','highlight','excerpt'].includes(a.type)).map(a=>a.id),title,metadata:referenceLine,copy:false,includeQuotes});if(!r.ok)setError(r.error.message);else if(r.data)setFeedback(ui('札记已导出'))}
    async function pasteMarginNote():Promise<void>{const picked=selection;if(!picked)return;const r=await window.jian.clipboard.readText();if(!r.ok){setSelectionMessage(ui(r.error.message));return}if(!r.data.trim()){setSelectionMessage(ui('剪贴板中没有可粘贴的文字'));return}startNote(picked.anchors,picked.quote,null,selectionPosition,r.data)}
    const [selectionDocked,setSelectionDocked]=useState(false);
    useLayoutEffect(()=>{const toolbar=selectionToolbar.current;if(!selection||!toolbar)return;const place=()=>{const r=toolbar.getBoundingClientRect(),native=window.getSelection(),box=native?.rangeCount&&!native.isCollapsed?native.getRangeAt(0).getBoundingClientRect():selectionBox.current;if(!box)return;const left=Math.max(10,Math.min(innerWidth-r.width-10,box.left));if(box.top-r.height-8>=108){setSelectionDocked(false);setSelectionPosition({left,top:box.top-r.height-8})}else if(box.bottom+r.height+8<=innerHeight-10){setSelectionDocked(false);setSelectionPosition({left,top:box.bottom+8})}else{setSelectionDocked(true);setSelectionPosition({left:0,top:0})}};place();const observer=new ResizeObserver(place);observer.observe(toolbar);window.addEventListener('resize',place);return()=>{observer.disconnect();window.removeEventListener('resize',place)}},[selection,selectionMessage,selectionExpanded]);
    useEffect(()=>{if(!selection)return;const dismiss=(e:PointerEvent)=>{if(!(e.target as HTMLElement).closest('.selection-toolbar,.floating-menu,.reader-mark-tools'))setSelection(null)},clear=()=>{if(window.getSelection()?.isCollapsed&&!selection.fromTranslation)setSelection(null)};document.addEventListener('pointerdown',dismiss);document.addEventListener('selectionchange',clear);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('selectionchange',clear)}},[selection]);
    useEffect(()=>{if(!selection||!selectionExpanded)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setSelectionExpanded(false);return}if(e.key==='ArrowDown'||e.key==='ArrowUp'){const choices=[...selectionToolbar.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]].filter(e=>e.getClientRects().length);if(!choices.length)return;e.preventDefault();e.stopPropagation();const i=choices.indexOf(document.activeElement as HTMLButtonElement);choices[(i+(e.key==='ArrowDown'?1:choices.length-1)+choices.length)%choices.length]?.focus({preventScroll:true})}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[selection,selectionExpanded]);
    function beginNoteLayout():void{restoreMotion.current++;noteBefore.current=captureSpot();noteOriginRevision.current=restoreMotion.current;setNotesMode('overview');setSidebar(true);setPanel('notes');setNavOpen(false);setFindOpen(false);}
    function closeNoteEditor():void{void refreshAnnotations();pendingNoteFocus.current=noteEditor?.record.current?.id??null;const key=noteEditor?.key,saved=noteBefore.current;noteBefore.current=null;zoomAnchor.current=null;setNoteEditor(v=>v?.key===key?null:v);if(saved&&noteOriginRevision.current===restoreMotion.current)restoreSpot(saved)}
    async function saveNote(text:string,color?:string):Promise<void>{if(!noteEditor)return;const before=noteEditor.record.current;const draft={...noteEditor.draft,id:before?.id,revision:before?.revision,comment:text,color:color??before?.color??noteEditor.draft.color,highlightId:before?.highlightId??noteEditor.draft.highlightId};if(!text.trim()){if(color)setNoteEditor(v=>v?{...v,draft:{...v.draft,color}}:v);return}const after=await annotationHistory.write(draft,before);noteEditor.record.current=after;setNoteEditor(v=>v?.key===noteEditor.key?{...v,draft:{...v.draft,color:after.color}}:v)}
    useLayoutEffect(()=>{if(!noteEditor)return;const ticket=restoreMotion.current;let frame=requestAnimationFrame(()=>{if(ticket!==restoreMotion.current)return;const pane=source.current,anchor=noteEditor.draft.anchors[0],rect=pane&&anchor?anchorClientRect(pane,anchor):null;if(!pane||!rect)return;programmatic.current=Date.now()+400;pane.scrollTop+=rect.top-pane.getBoundingClientRect().top-pane.clientHeight/3});return()=>cancelAnimationFrame(frame)},[noteEditor?.key]);
    async function highlight(slot:number,existing?:Annotation,picked=selection,markStyle:'highlight'|'underline'=existing?.markStyle??'highlight'):Promise<void>{
        if(!existing&&!picked)return;const p=palette(colorSettings.settings.paletteId),draft:AnnotationDraft=existing?annotationDraft(existing):{documentVersionId,type:'highlight',anchors:picked!.anchors.map(a=>({...a,pageLabel:pageLabels[a.pageIndex]})),quote:picked!.quote,comment:''};
        const sourceBlock=!existing&&picked?segments.find(s=>containsAnchors(segmentAnchors(s,documentVersionId),picked.anchors)):null;
        setSelection(null);window.getSelection()?.removeAllRanges();setHighlightEditor(null);
        await annotationHistory.write({...draft,markStyle,translation:!existing?(picked?.result??(sourceBlock?blocks[sourceBlock.id]?.result:undefined)):undefined,paletteId:p.id,slot,color:p.colors[slot-1]},existing??null);await colorSettings.update({recentSlot:slot});setFeedback('')
    }
    async function removeAnnotation(a:Annotation):Promise<void>{await annotationHistory.remove(a);setHighlightEditor(null);if(noteEditor?.record.current?.id===a.id)closeNoteEditor()}
    function pointNoteAt(clientX:number,clientY:number,el:PageElement,pageNote=false):void{
        const page=el.pdfPage;if(!page)return;const rect=el.getBoundingClientRect(),point:[number,number]=[clientX-rect.left,clientY-rect.top],mapped=el.pdfGeometry?el.pdfGeometry.toSourcePoint(point):point;if(!mapped){if(pageNote)startNote([{documentVersionId,pageIndex:Number(el.dataset.page)-1,kind:'point',point:[.94,.08],rects:[],exact:''}],'',el);return}
        const vp=page.getViewport({scale:renderScale,rotation:page.rotate+rotation}),pdf=vp.convertToPdfPoint(mapped[0],mapped[1]),base=page.getViewport({scale:1,rotation:0}),unrotated=base.convertToViewportPoint(pdf[0],pdf[1]);
        startNote([{documentVersionId,pageIndex:Number(el.dataset.page)-1,kind:'point',point:[Math.min(1,Math.max(0,unrotated[0]/base.width)),Math.min(1,Math.max(0,unrotated[1]/base.height))],rects:[],exact:'',orderKey:-pdf[1]}],'',el,{left:clientX,top:clientY})
    }
    function placeNoteAt(e:React.MouseEvent):void{if(!placing||(e.target as HTMLElement).closest('button,a,textarea'))return;const el=(e.target as HTMLElement).closest<PageElement>('.pdf-page-host');if(el){pointNoteAt(e.clientX,e.clientY,el);e.stopPropagation()}}
    function openSourceContext(e:React.MouseEvent,id:string|null=null):void{
        e.preventDefault();e.stopPropagation();const native=window.getSelection(),range=native?.rangeCount&&!native.isCollapsed?native.getRangeAt(0):null;
        const anchors=range&&source.current?.contains(range.commonAncestorContainer)?collectSourceSelection(source.current,range,documentVersionId,renderScale):[];
        const picked=anchors.length?{quote:native!.toString(),anchors,context:segments.find(s=>s.id===id)?.text??''}:undefined,el=(e.target as HTMLElement).closest<HTMLElement>('.pdf-page-host');
        if(picked){selectionBox.current=range!.getBoundingClientRect();setSelection(picked);setSelectionMessage('');setSelectionExpanded(true);setContextMenu(null);return}
        setSelection(null);setContextMenu({x:Math.max(12,Math.min(e.clientX,innerWidth-260)),y:Math.max(86,Math.min(e.clientY,innerHeight-380)),id,kind:'source',selection:picked,point:el?{x:e.clientX,y:e.clientY,element:el}:undefined})
    }
    useEffect(()=>{const key=(e:KeyboardEvent)=>{
        if(e.defaultPrevented||(e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')||document.querySelector('[aria-modal=true]')||noteEditor)return;
        if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();void annotationHistory.travel(!e.shiftKey);return}
        if(e.metaKey||e.ctrlKey||e.altKey)return;
        if(e.key==='Escape'){setFocused(false);setNavOpen(false);setFindOpen(false);setTool('select');setPlacing(false);setHighlightEditor(null);setSelection(null);return}
        if(e.key==='Enter'&&selection){e.preventDefault();startNote();return}
        const key=e.key.toLowerCase();if(key==='n'){e.preventDefault();noteCurrentPage();return}if(key==='t'){e.preventDefault();setDockOpen(v=>!v);return}if(key==='f'){e.preventDefault();setFocused(v=>!v);return}if(key==='l'){e.preventDefault();toggleNavigator();return}if(key==='j'||key==='k'){e.preventDefault();navigateNote(key==='j'?1:-1);return}if(['ArrowLeft','ArrowRight','PageUp','PageDown'].includes(e.key)){e.preventDefault();setSelection(null);jumpPage(currentPage+(['ArrowLeft','PageUp'].includes(e.key)?-1:1));return}
        if(selection&&!selection.fromTranslation&&selection.anchors.length>0&&(/[1-6]/.test(e.key)&&e.key.length===1||e.key.toLowerCase()==='h')){e.preventDefault();catchAnnotation(highlight(e.key.toLowerCase()==='h'?colorSettings.settings.recentSlot:Number(e.key)))}
    };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)});
    useEffect(() => {
        mounted.current = true;
        let dead = false;
        restored.current = false;
        generation.current++;
        setPages({});
        setBlocks({});
        setOpened(null);
        setReaderReady(false);setReaderData(EMPTY_READER_DATA);setNativeLabelsReady(false);setMetadataPages(null);metadataPageAttempted.current=false;
        void window.jian.m3.readerData(documentVersionId).then(r=>{if(dead)return;if(r.ok){setReaderData(r.data);setReaderReady(true)}else setError(r.error.message)});
        setError('');
        setSelection(null);
        void window.jian.documents.open(documentVersionId).then(r => { if (dead)
            return; if (r.ok)
            setOpened(r.data);
        else
            setError(r.error.message); });
        refreshProvider();
        void refreshAnnotations();
        return () => { dead = true; mounted.current = false; generation.current++; if (sourceScrollTimer.current) clearTimeout(sourceScrollTimer.current); for (const id of requests.current.keys())
            void window.jian.m3.cancel(id); requests.current.clear(); };
    }, [documentVersionId, refreshProvider, refreshAnnotations]);
    useEffect(() => { const key = (e: KeyboardEvent) => { if (e.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]') || (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]'))) return; if (e.key === 'Escape' && selectionRef.current) {
        for (const [id, k] of requests.current)
            if (k === 'selection') {
                void window.jian.m3.cancel(id);
                requests.current.delete(id);
            }
        setSelection(null);
    } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
    useEffect(() => {
        if (!provider)
            return;
        const gen = generation.current;
        for (const segment of segments) {
            const input = paragraphInput(segment, segments, opened?.itemId ?? null), key = JSON.stringify({ input, provider });
            if (cacheLookups.current.has(key))
                continue;
            cacheLookups.current.add(key);
            void window.jian.m3.cached(input).then(r => { if (gen !== generation.current || !mounted.current || !r.ok || !r.data)
                return; setBlocks(b => b[segment.id]?.state === 'loading' ? b : { ...b, [segment.id]: { state: r.data!.status, text: r.data!.text, result: r.data! } }); });
        }
    }, [segments, provider, opened?.itemId]);
    const onSegments = useCallback((page: number, ss: Segment[]) => setPages(p => ({ ...p, [page]: ss })), []);
    useEffect(() => {
        if (!doc)
            return;
        void window.jian.documents.setPageCount(documentVersionId, doc.numPages);
        if (restored.current)
            return;
        restored.current = true;
        if (location) {if(location.panel){setNotesMode('overview');setPanel('notes');setNoteFilter(location.panel==='notes'?'notes':'excerpts');setSidebar(true)}return;}
        const restoreTicket=restoreMotion.current;
        if(initialSession){const session=initialSession;let tries=0;const resume=()=>{const pane=source.current;if(!pane||!mounted.current||restoreTicket!==restoreMotion.current)return;const el=pane.querySelector<PageElement>('[data-page="'+session.page+'"]');if(!el?.pdfPage&&tries++<60){setTimeout(resume,25);return}pane.scrollTop=session.scrollTop;pane.scrollLeft=session.scrollLeft;if(target.current)target.current.scrollTop=session.targetScroll;programmatic.current=Date.now()+300};requestAnimationFrame(resume);return}
        void window.jian.reading.get(documentVersionId).then(r => {
            if (!r.ok || !r.data || !mounted.current || restoreTicket!==restoreMotion.current)
                return;
            const state = r.data, zoom = Math.min(4, Math.max(.5, state.zoom));
            setScale(zoom);
            setMode(state.mode === 'bilingual' ? 'bilingual' : 'source');setSidebar(state.mode==='bilingual');
            let offset = 0, viewportOffset = 0;
            try {
                const anchor = JSON.parse(state.anchor ?? '{}');
                offset = anchor.offset ?? 0; viewportOffset = anchor.viewportOffset ?? 0;
            }
            catch { /* old state */ }
            setTimeout(() => { if(!mounted.current||restoreTicket!==restoreMotion.current)return;const el = source.current?.querySelector(`[data-page="${state.pageIndex + 1}"]`); if (el && source.current)
                source.current.scrollTop += el.getBoundingClientRect().top - source.current.getBoundingClientRect().top + offset * renderScaleRef.current - viewportOffset; setCurrentPage(state.pageIndex + 1); }, 250);
        });
    }, [doc, documentVersionId]);
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!doc || !restored.current || !source.current)
                return;
            const el = source.current.querySelector(`[data-page="${currentPage}"]`);
            let offset = el ? (source.current.getBoundingClientRect().top - el.getBoundingClientRect().top) / renderScale : 0, viewportOffset = 0;
            if (mode === 'inline' && el) { const stable = captureSourceAnchor(source.current); if (stable?.element === el) { offset = stable.sourcePoint[1] / renderScale; viewportOffset = stable.viewportOffset; } }
            void window.jian.reading.save(documentVersionId, { pageIndex: currentPage - 1, zoom: scale, mode: mode === 'inline' ? 'bilingual' : mode, anchor: JSON.stringify({ offset, viewportOffset }), panes: JSON.stringify({ panel, split }) });
        }, 600);
        return () => clearTimeout(timer);
    }, [doc, currentPage, scale, mode, panel, split, active, documentVersionId, scrollCheckpoint]);
    useEffect(() => window.jian.m3.onTranslation(event => {
        if (event.generation !== generation.current)
            return;
        const key = requests.current.get(event.requestId);
        if (!key || event.type !== 'chunk')
            return;
        if (key === 'selection'){setSelectionResult(s=>s?{...s,text:s.text+(event.text??'')}:s);setSelection(s => s ? { ...s, text: (s.text ?? '') + (event.text ?? '') } : s);}
        else
            setBlocks(b => ({ ...b, [key]: { ...b[key], state: 'loading', text: (b[key]?.text ?? '') + (event.text ?? '') } }));
    }), []);
    useEffect(() => { let dead = false; const poll = async () => { const r = await window.jian.m3.jobs(documentVersionId); if (r.ok && !dead) {
        if (r.data.some(j => j.status === 'completed' && !completedJobs.current.has(j.id))) {
            r.data.filter(j => j.status === 'completed').forEach(j => completedJobs.current.add(j.id));
            cacheLookups.current.clear();
            setPages(p => ({ ...p }));
        }
        setJobs(r.data);
    } }; void poll(); const timer = setInterval(() => void poll(), 1200); return () => { dead = true; clearInterval(timer); }; }, [documentVersionId]);
    async function translate(s: Segment | Selection, key: string, force = false): Promise<void> {
        const id = crypto.randomUUID(), gen = generation.current;
        requests.current.set(id, key);
        if (key === 'selection'){setSelectionResult({quote:'quote' in s?s.quote:s.text,text:'',state:'loading'});setSelection(v => v ? { ...v, state: 'loading', text: '', error: undefined } : v);}
        else
            setBlocks(b => ({ ...b, [key]: { state: 'loading', text: '' } }));
        const text = 'quote' in s ? s.quote : s.text, context = 'context' in s ? s.context : segments.slice(Math.max(0, segments.findIndex(x => x.id === s.id) - 1), segments.findIndex(x => x.id === s.id) + 2).filter(x => x.id !== s.id).map(x => x.text).join('\n').slice(0, 12000);
        const result = await window.jian.m3.translate({ requestId: id, generation: gen, force, input: 'quote' in s ? { mode: 'selection', text, context, itemId: opened?.itemId ?? null, sourceLanguage: 'auto' } : paragraphInput(s, segments, opened?.itemId ?? null) });
        if (gen !== generation.current || !requests.current.has(id))
            return;
        requests.current.delete(id);
        if(key==='selection')setSelectionResult(old=>old?result.ok?{...old,text:result.data.text,state:result.data.status}:{...old,state:'failed',error:result.error.message}:old);
        if (key === 'selection')
            setSelection(v => v ? { ...v, state: result.ok ? result.data.status : 'failed', text: result.ok ? result.data.text : '', result: result.ok ? result.data : undefined, error: result.ok ? undefined : result.error.message } : v);
        else
            setBlocks(b => ({ ...b, [key]: result.ok ? { state: result.data.status, text: result.data.text, result: result.data } : { state: 'failed', text: '', error: result.error.message } }));
    }
    const pick = useCallback((quote: string, anchors: PdfAnchor[], context: string) => { for (const [id, key] of requests.current)
        if (key === 'selection') {
            void window.jian.m3.cancel(id);
            requests.current.delete(id);
        } const native=window.getSelection(),box=native?.rangeCount?native.getRangeAt(0).getBoundingClientRect():null;setSelectionMessage('');setSelectionExpanded(false);selectionBox.current=box;if(box)setSelectionPosition({left:Math.max(12,Math.min(innerWidth-420,box.left)),top:box.top>135?box.top-64:Math.max(76,Math.min(innerHeight-100,box.bottom+10))});setSelection({ quote, anchors, context, clipboardText:native?.toString()||quote }); }, []);
    function navigate(id: string, fromTarget = false): void {
        setActive(id);
        programmatic.current = Date.now() + 450;
        const segment = segments.find(s => s.id === id);
        if (!segment)
            return;
        if(fromTarget)setCurrentPage(segment.pageIndex + 1);
        if(fromTarget){
            setFlash(id+':'+Date.now());
            const el=source.current?.querySelector<HTMLElement>('[data-segment="'+id+'"]');
            if(el&&source.current)scrollWithin(source.current,el,.4);
        }
        else {
            if(mode!=='bilingual')return;
            setSidebar(true);setPanel('translation');
            requestAnimationFrame(()=>{const el=target.current?.querySelector<HTMLElement>('[data-translation="'+id+'"]');if(el&&target.current)scrollWithin(target.current,el)});
        }
    }
    const scrollFrame=useRef(0),progressBar=useRef<HTMLSpanElement>(null),pageElements=useRef<HTMLElement[]>([]);
    useLayoutEffect(()=>{pageElements.current=[...source.current?.querySelectorAll<HTMLElement>('.pdf-page-host')??[]]},[doc,readingTools.singlePage,currentPage,mode]);
    useEffect(()=>()=>cancelAnimationFrame(scrollFrame.current),[]);
    function scrollSource(): void {
        if(window.getSelection()?.isCollapsed)setSelection(null);setHighlightEditor(null);
        if(sourceScrollTimer.current)clearTimeout(sourceScrollTimer.current);
        sourceScrollTimer.current=setTimeout(()=>setScrollCheckpoint(v=>v+1),220);
        if(scrollFrame.current)return;
        scrollFrame.current=requestAnimationFrame(()=>{scrollFrame.current=0;const pane=source.current,els=pageElements.current;if(!pane||!els.length)return;const top=pane.getBoundingClientRect().top;
            let lo=0,hi=els.length-1,best=0;while(lo<=hi){const mid=(lo+hi)>>1;if(els[mid].getBoundingClientRect().top<=top+140){best=mid;lo=mid+1}else hi=mid-1}
            const el=els[best],n=Number(el.dataset.page),box=el.getBoundingClientRect();setCurrentPage(old=>old===n?old:n);
            if(progressBar.current)progressBar.current.style.width=((n-1+Math.max(0,Math.min(1,(top-box.top)/box.height)))/Math.max(1,doc?.numPages??1)*100)+'%';
            if(mode!=='bilingual'||panel!=='translation'||!sidebar||Date.now()<programmatic.current||!window.getSelection()?.isCollapsed)return;
            const mid=top+pane.clientHeight*.5;let nearest:HTMLElement|null=null,distance=Infinity;for(const e of el.querySelectorAll<HTMLElement>('[data-segment]')){const d=Math.abs(e.getBoundingClientRect().top-mid);if(d<distance){distance=d;nearest=e}}
            if(nearest?.dataset.segment&&nearest.dataset.segment!==active){setActive(nearest.dataset.segment);programmatic.current=Date.now()+260;const t=target.current?.querySelector<HTMLElement>('[data-translation="'+nearest.dataset.segment+'"]');if(t)scrollWithin(target.current!,t)}
        });
    }
    function scrollTarget(): void {
        if (!target.current || Date.now() < programmatic.current || !window.getSelection()?.isCollapsed)
            return;
        const top = target.current.getBoundingClientRect().top, block = [...target.current.querySelectorAll<HTMLElement>('[data-translation]')].find(x => x.getBoundingClientRect().bottom > top + 100);
        if (block?.dataset.translation)
            navigate(block.dataset.translation, true);
    }
    function switchMode(next:'source'|'bilingual'|'inline'):void{void commitNoteAction(()=>{if(noteEditor)closeNoteEditor();applyMode(next)})}
    function applyMode(next: 'source' | 'bilingual' | 'inline'): void {
        if (next === mode) return;
        cancelReadingMotion();const motion=restoreMotion.current;
        const pane = source.current, stable = pane ? captureSourceAnchor(pane) : null;
        const pageNumber = stable?.element.dataset.page;
        const point = stable ? [stable.sourcePoint[0]/renderScale,stable.sourcePoint[1]/renderScale] as [number,number] : null;
        setMode(next);setSidebar(next==='bilingual'||notesMode==='overview');if(next==='bilingual'){setNotesMode('hidden');setPanel('translation')}
        if (!pane || !stable || !point || !pageNumber) return;
        const gen = generation.current;
        let attempts = 0;
        const restore = (): void => {
            if (gen !== generation.current || !mounted.current || motion!==restoreMotion.current) return;
            const el = pane.querySelector<PageElement>(`[data-page="${pageNumber}"]`);
            if ((!el?.pdfPage || (next === 'inline' && el.dataset.inline === 'true' && !el.pdfGeometry)) && attempts++ < 40) { setTimeout(restore,25); return; }
            if (!el?.pdfPage) return;
            const scaled: [number,number] = [point[0]*renderScaleRef.current,point[1]*renderScaleRef.current];
            const mapped = el.pdfGeometry?.fromSourcePoint(scaled) ?? scaled;
            programmatic.current = Date.now()+300;
            pane.scrollTop += el.getBoundingClientRect().top + mapped[1] - pane.getBoundingClientRect().top - stable.viewportOffset;
        };
        setTimeout(()=>requestAnimationFrame(restore),50);
    }
    const jumpRevision=useRef(0),navigationFrame=useRef(0);
    function cancelReadingMotion():void{restoreMotion.current++;jumpRevision.current++;rotationSpot.current=null;zoomAnchor.current=null;cancelAnimationFrame(navigationFrame.current);if(source.current)cancelScroll(source.current);if(target.current)cancelScroll(target.current)}
    useEffect(()=>{const pane=source.current;if(!pane)return;const cancel=()=>cancelReadingMotion();for(const event of ['wheel','pointerdown','touchstart'])pane.addEventListener(event,cancel,{passive:true});return()=>{for(const event of ['wheel','pointerdown','touchstart'])pane.removeEventListener(event,cancel);cancelAnimationFrame(navigationFrame.current)}},[]);
    const zoomAnchor=useRef<{page:string;point:[number,number];offset:[number,number]}|null>(null),zoomValue=useRef(scale);zoomValue.current=scale;
    function captureSpot():ReadingSpot|null{const pane=source.current,stable=pane?captureSourceAnchor(pane):null;if(!pane||!stable)return null;const box=pane.getBoundingClientRect(),r=stable.element.getBoundingClientRect();return {page:stable.element.dataset.page!,point:[stable.sourcePoint[0]/renderScaleRef.current,stable.sourcePoint[1]/renderScaleRef.current],offset:[r.left+stable.sourcePoint[0]-box.left,stable.viewportOffset]}}
    function restoreSpot(saved:ReadingSpot):void{const motion=++restoreMotion.current;programmatic.current=Date.now()+400;requestAnimationFrame(()=>{const pane=source.current;if(!pane||motion!==restoreMotion.current||!mounted.current)return;const el=pane.querySelector<PageElement>('[data-page="'+saved.page+'"]');if(!el)return;const raw:[number,number]=[saved.point[0]*renderScaleRef.current,saved.point[1]*renderScaleRef.current],mapped=el.pdfGeometry?.fromSourcePoint(raw)??raw;pane.scrollTop+=el.getBoundingClientRect().top+mapped[1]-pane.getBoundingClientRect().top-saved.offset[1]})}
    function noteCurrentPage():void{const pane=source.current,el=pane?.querySelector<PageElement>('[data-page="'+currentPage+'"]');if(!pane||!el?.pdfPage)return;const b=el.getBoundingClientRect(),v=pane.getBoundingClientRect();pointNoteAt(Math.min(v.right-35,b.right-10),Math.max(b.top+8,Math.min(b.bottom-8,v.top+pane.clientHeight/3)),el,true)}
    function toggleNavigator():void{void commitNoteAction(()=>{if(noteEditor)closeNoteEditor();applyNavigator()})}
    function applyNavigator():void{rememberReadingPosition();setFindOpen(false);if(navOpen){setNavOpen(false);if(navReturn.current){setSidebar(navReturn.current.sidebar);setNotesMode(navReturn.current.notes);navReturn.current=null}}else{navReturn.current={notes:notesMode,sidebar};setNavOpen(true);setSidebar(false);setNotesMode('hidden')}}
    function cycleNotes():void{rememberReadingPosition();setNavOpen(false);setFindOpen(false);if(noteEditor){void commitNoteAction(closeNoteEditor);return}const visible=sidebar&&panel==='notes';setNotesMode(visible?'hidden':'overview');setSidebar(!visible);if(!visible)setPanel('notes');}
    function navigateNote(delta:number):void{const notes=annotations.filter(a=>a.type==='note');if(!notes.length)return;let index=notes.findIndex(a=>a.id===noteCursor.current);if(index<0)index=delta>0?-1:0;const a=notes[(index+delta+notes.length)%notes.length];noteCursor.current=a.id;setNotesMode('overview');setSidebar(true);setPanel('notes');jumpToAnchor(a.anchors[0]);setTimeout(()=>source.current?.querySelector<HTMLElement>('[data-annotation-marker="'+a.id+'"],[data-cluster-members~="'+a.id+'"]')?.focus({preventScroll:true}),250)}
    function addBookmark():void{if(readingTools.bookmarks.some(b=>b.pageIndex===currentPage-1))return;void updateTools({bookmarks:[...readingTools.bookmarks,{id:crypto.randomUUID(),pageIndex:currentPage-1,title:chapters.filter(c=>c.page<=currentPage).at(-1)?.title??ui('第 {0} 页',currentPage),createdAt:new Date().toISOString()}]})}
    function openInfo():void{setInfoOpen(true)}
    function selectionTranslate():void{if(!selection)return;const picked=selection;void commitNoteAction(()=>{if(noteEditor)closeNoteEditor();rememberReadingPosition();setNotesMode('hidden');setSidebar(true);setPanel('translation');void translate(picked,'selection');setSelection(null);window.getSelection()?.removeAllRanges()})}
    async function reloadDocument():Promise<void>{const saved=captureSpot(),r=await window.jian.documents.open(documentVersionId);if(!r.ok){setError(r.error.message);return}setOpened(r.data);if(saved)setTimeout(()=>restoreSpot(saved),500)}
    async function systemPrint():Promise<void>{const r=await window.jian.documents.print(documentVersionId);setFeedback(r.ok?ui('已在系统阅读器打开，请使用系统打印。'):r.error.message)}
    function rememberReadingPosition():void {
        if(!noteEditor&&target.current)noteReturn.current={scroll:target.current.scrollTop,panel};
        const pane=source.current,stable=pane?captureSourceAnchor(pane):null;if(!pane||!stable)return;
        const box=pane.getBoundingClientRect(),r=stable.element.getBoundingClientRect();
        zoomAnchor.current={page:stable.element.dataset.page!,point:[stable.sourcePoint[0]/renderScaleRef.current,stable.sourcePoint[1]/renderScaleRef.current],offset:[r.left+stable.sourcePoint[0]-box.left,stable.viewportOffset]};
        programmatic.current=Date.now()+500;
    }
    const rotationSpot=useRef<{page:string;pdf:[number,number];offset:[number,number]}|null>(null),rotationTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
    async function rotatePage():Promise<void>{cancelReadingMotion();const ticket=restoreMotion.current;const pane=source.current;if(!pane||!doc)return;const el=pane.querySelector<PageElement>('[data-page="'+currentPage+'"]');if(!el)return;const p=el.pdfPage??await doc.getPage(currentPage);if(!mounted.current||ticket!==restoreMotion.current)return;const b=pane.getBoundingClientRect(),r=el.getBoundingClientRect(),point:[number,number]=[Math.max(0,Math.min(r.width,b.left+pane.clientWidth/2-r.left)),Math.max(0,Math.min(r.height,b.top+Math.min(180,pane.clientHeight/3)-r.top))],raw=el.pdfGeometry?.toSourcePoint(point)??point,viewport=p.getViewport({scale:renderScale,rotation:p.rotate+rotation});rotationSpot.current={page:el.dataset.page!,pdf:viewport.convertToPdfPoint(raw[0],raw[1]) as [number,number],offset:[r.left+point[0]-b.left,r.top+point[1]-b.top]};zoomAnchor.current=null;programmatic.current=Date.now()+500;setRotation(r=>(r+90)%360)}
    useLayoutEffect(()=>{const saved=rotationSpot.current,pane=source.current;if(!saved||!pane)return;const el=pane.querySelector<PageElement>('[data-page="'+saved.page+'"]'),page=el?.pdfPage;if(!el||!page)return;const vp=page.getViewport({scale:renderScale,rotation:page.rotate+rotation}),raw=vp.convertToViewportPoint(saved.pdf[0],saved.pdf[1]) as [number,number],point=el.pdfGeometry?.fromSourcePoint(raw)??raw,r=el.getBoundingClientRect(),b=pane.getBoundingClientRect();pane.scrollTop+=r.top+point[1]-b.top-saved.offset[1];pane.scrollLeft+=r.left+point[0]-b.left-saved.offset[0];setCurrentPage(Number(saved.page));clearTimeout(rotationTimer.current);rotationTimer.current=setTimeout(()=>{rotationSpot.current=null},250)},[rotation,renderScale]);
    useEffect(()=>()=>clearTimeout(rotationTimer.current),[]);
    function changeZoom(next:number,focal?:{x:number;y:number}):void{cancelReadingMotion();
        next=Math.min(4,Math.max(.5,next));if(Math.abs(next-1)<.0001&&!focal){rememberReadingPosition();autoFit.current=true;setFitWidth(availableWidth());setScale(1);return}autoFit.current=false;if(Math.abs(next-zoomValue.current)<.0001)return;setZoomBusy(true);clearTimeout(zoomQuiet.current);zoomQuiet.current=setTimeout(()=>setZoomBusy(false),240);
        const pane=source.current;if(pane){const b=pane.getBoundingClientRect(),x=focal?.x??b.left+pane.clientWidth/2,y=focal?.y??b.top+Math.min(180,pane.clientHeight/3),pages=[...pane.querySelectorAll<PageElement>('.pdf-page-host')],el=pages.find(p=>{const r=p.getBoundingClientRect();return r.top<=y&&r.bottom>=y})??pages.find(p=>p.getBoundingClientRect().bottom>b.top);if(el){const r=el.getBoundingClientRect(),local:[number,number]=[Math.max(0,Math.min(r.width,x-r.left)),Math.max(0,Math.min(r.height,y-r.top))],raw=el.pdfGeometry?el.pdfGeometry.toSourcePoint(local):local;if(raw)zoomAnchor.current={page:el.dataset.page!,point:[raw[0]/renderScaleRef.current,raw[1]/renderScaleRef.current],offset:[r.left+local[0]-b.left,r.top+local[1]-b.top]}}}
        zoomValue.current=next;setScale(next);programmatic.current=Date.now()+500;
    }
    useLayoutEffect(()=>{const saved=zoomAnchor.current,pane=source.current;if(!saved||!pane)return;const el=pane.querySelector<PageElement>('[data-page="'+saved.page+'"]');if(!el)return;const raw:[number,number]=[saved.point[0]*renderScale,saved.point[1]*renderScale],mapped=el.pdfGeometry?.fromSourcePoint(raw)??raw,r=el.getBoundingClientRect(),b=pane.getBoundingClientRect();pane.scrollTop+=r.top+mapped[1]-b.top-saved.offset[1];pane.scrollLeft+=r.left+mapped[0]-b.left-saved.offset[0];zoomAnchor.current=null},[renderScale]);
    function jumpToAnchor(anchor: PdfAnchor,attempt=0,ticket?:number): void {if(!attempt){cancelReadingMotion();ticket=jumpRevision.current}if(!mounted.current||ticket!==jumpRevision.current)return;
        const pane = source.current, el = pane?.querySelector<HTMLElement>(`[data-page="${anchor.pageIndex + 1}"]`);
        if (!pane || !el){if(mounted.current&&readingTools.singlePage&&attempt<40){setCurrentPage(anchor.pageIndex+1);setTimeout(()=>jumpToAnchor(anchor,attempt+1,ticket),25)}return;}
        const p = (el as HTMLElement & {
            pdfPage?: PDFPageProxy;
        }).pdfPage, rect = anchor.rects[0];
        if(!p&&attempt<40){setTimeout(()=>jumpToAnchor(anchor,attempt+1,ticket),25);return}
        const vp = p?.getViewport({ scale:renderScale,rotation:p.rotate+rotation }), ys = vp && rect ? [vp.convertToViewportPoint(rect[0], rect[1])[1], vp.convertToViewportPoint(rect[2], rect[3])[1]] : [0];
        const pointBase=p?.getViewport({scale:1,rotation:0}),rawPoint=anchor.point&&pointBase?pointBase.convertToPdfPoint(anchor.point[0]*pointBase.width,anchor.point[1]*pointBase.height):null;
        const sourceY = rawPoint&&vp?vp.convertToViewportPoint(rawPoint[0],rawPoint[1])[1]:Math.min(...ys), displayY = (el as PageElement).pdfGeometry?.fromSourcePoint([1,sourceY])?.[1] ?? sourceY;
        programmatic.current = Date.now() + 500;
        pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top + displayY - 60;
        setCurrentPage(anchor.pageIndex + 1);
    }
    useEffect(() => {
        if (!searchLocation || !doc || !pages[searchLocation.pageIndex] || jumpedSearch.current) return;
        const found=annotations.find(a=>a.id===searchLocation.annotationId);
        if(searchLocation.annotationId&&!found)return;
        jumpedSearch.current=true;
        jumpToAnchor(found?.anchors[0]??{documentVersionId,pageIndex:searchLocation.pageIndex,rects:searchLocation.rects??[],exact:''});
        if (searchLocation.annotationId) { setMode('bilingual');setSidebar(true); setPanel('notes');setNoteFilter(found?.type==='note'?'notes':'excerpts'); requestAnimationFrame(() => target.current?.querySelector(`[data-annotation="${searchLocation.annotationId}"]`)?.scrollIntoView({block:'center'})); }
        setFeedback(ui("已定位至第 {0} 页", searchLocation.pageIndex+1));
    }, [searchLocation,doc,pages,documentVersionId,annotations]);
    function revealAnnotation(a:Annotation):void{if(!a.anchors[0])return;jumpToAnchor(a.anchors[0]);let attempts=0;const flash=()=>{if(!mounted.current)return;const el=source.current?.querySelector<HTMLElement>('[data-annotation-marker="'+a.id+'"],[data-highlight="'+a.id+'"]');if(!el){if(attempts++<40)setTimeout(flash,25);return}el.classList.remove('annotation-jump');requestAnimationFrame(()=>{el.classList.add('annotation-jump');setTimeout(()=>el.classList.remove('annotation-jump'),1000)})};setTimeout(flash,30)}
    function findHit(hit: SearchHit): void {
        jumpedSearch.current = false;
        setSearchLocation({pageIndex:hit.pageIndex??0,rects:hit.anchor?.rects,query:hit.snippet,annotationId:hit.annotationId??undefined});
    }
    async function save(quote:string,anchors:PdfAnchor[],translation:TranslationResult|undefined,type:'highlight'|'excerpt'|'note',comment=''):Promise<void>{
        if(type==='note'){startNote(anchors,quote);return}
        const p=palette(colorSettings.settings.paletteId),slot=colorSettings.settings.recentSlot;
        try{await annotationHistory.write({documentVersionId,type,anchors,quote,comment,translation,color:p.colors[slot-1],paletteId:p.id,slot} as AnnotationDraft,null);setSelection(null);setFeedback('')}catch(e){setError(e instanceof Error?e.message:String(e))}
    }
    async function pageTranslate(retryOnly=false):Promise<void>{
        if(sameLanguage)return;
        const run=++pageRun.current;
        for(const s of currentSegments){
            if(!mounted.current||run!==pageRun.current)break;
            if(retryOnly&&blocks[s.id]?.state!=='failed'||!retryOnly&&blocks[s.id]?.result)continue;
            await translate(s,s.id,retryOnly);
        }
        if(mounted.current&&run===pageRun.current&&!localStorage.getItem('jian.all-translation-tip')){
            localStorage.setItem('jian.all-translation-tip','1');setFeedback(ui('可在更多菜单中翻译全文 · ⌘⇧T'));
        }
    }
    function stop(): void { pageRun.current++; for (const id of requests.current.keys())
        void window.jian.m3.cancel(id); requests.current.clear(); setBlocks(b => Object.fromEntries(Object.entries(b).map(([id, v]) => [id, v.state === 'loading' ? { ...v, state: 'failed', error: ui("已停止，可重试") } : v]))); setSelection(s => s ? { ...s, state: 'failed', error: ui("已停止") } : s); }
    const editKey=(s:Segment):string=>(provider?.targetLanguage??'')+':'+s.id;
    async function updateReader(next:ReaderData):Promise<boolean>{
        if(!readerReady||saveBusy)return false;
        setSaveBusy(true);
        try{const r=await window.jian.m3.saveReaderData(documentVersionId,next);if(r.ok)setReaderData(next);else setError(r.error.message);return r.ok}finally{setSaveBusy(false)}
    }
    async function repair(action:'replace'|'merge'|'ignore',picked=selection):Promise<void>{
        const id=contextMenu?.id??active;setContextMenu(null);
        if(action==='replace'&&picked){
            if(picked.anchors.length!==1){setFeedback(ui('请在同一页内选中一个段落。'));return}
            const a=picked.anchors[0];
            const touched=segments.filter(s=>s.pageIndex===a.pageIndex&&!ignored(s)&&s.rects.some(r=>a.rects.some(c=>Math.min(r[2],c[2])-Math.max(r[0],c[0])>1&&Math.min(r[3],c[3])-Math.max(r[1],c[1])>1)));
            if(touched.some(s=>!s.rects.every(r=>a.rects.some(c=>c[0]<=r[0]+3&&c[1]<=r[1]+3&&c[2]>=r[2]-3&&c[3]>=r[3]-3)))){setFeedback(ui('请选中完整段落，再使用“作为一段”。'));return}
            const segment:Segment={id:'manual:'+crypto.randomUUID(),pageIndex:a.pageIndex,text:normalizeBlockText(picked.quote),rects:a.rects,kind:'body',confidence:1};
            await updateReader({...readerData,overrides:[...readerData.overrides,{id:segment.id,action,segment}]});setSelection(null);return;
        }
        if(id)await updateReader({...readerData,overrides:[...readerData.overrides,{id,action}]});
    }
    useEffect(()=>{
        let dead=false;
        const refresh=():void=>{refreshProvider();cacheLookups.current.clear();setBlocks({});void window.jian.m3.glossary(opened?.itemId??null).then(r=>{if(r.ok&&!dead)setTerms(r.data)})};
        refresh();if(opened?.itemId)void window.jian.library.get(opened.itemId).then(r=>{if(dead||!r.ok||!r.data)return;setMetadataPages(r.data.fields.pages??'');setReferenceLine([r.data.creatorsList.map(c=>c.nameMode==='literal'?c.literalName??'':[c.familyName,c.givenName].filter(Boolean).join(' ')).join(', '),r.data.fields.publicationTitle,r.data.date,r.data.fields.DOI?'DOI '+r.data.fields.DOI:''].filter(Boolean).join(' · '));setAuthorNames(r.data.creatorsList.map(c=>c.nameMode==='literal'?c.literalName??'':(c.familyName??'')+(c.givenName??'')))});window.addEventListener('jian:settings-changed',refresh);
        return()=>{dead=true;window.removeEventListener('jian:settings-changed',refresh)}
    },[opened?.itemId,refreshProvider]);
    useEffect(()=>{
        if(!prefs.inlineEnabled&&mode==='inline')switchMode('source');
    },[prefs.inlineEnabled]);
    useEffect(()=>{
        if(sameLanguage&&mode==='bilingual'){switchMode('source');setFeedback(ui('文献与目标语言相同，无需对读。'))}
    },[sameLanguage]);
    useEffect(()=>{
        if(!prefs.autoTranslate||mode!=='bilingual'||sameLanguage||!readerReady||!provider||!currentSegments.length||autoPages.current.has(currentPage))return;
        autoPages.current.add(currentPage);void pageTranslate();
    },[prefs.autoTranslate,mode,sameLanguage,readerReady,provider,currentPage,currentSegments.length]);
    useEffect(()=>{
        if(!contextMenu)return;
        const close=():void=>setContextMenu(null);
        const key=(e:KeyboardEvent):void=>{if(e.key==='Escape'){e.preventDefault();close()}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){const all=[...document.querySelectorAll<HTMLButtonElement>('.reader-context-menu button:not(:disabled)')].filter(el=>el.getClientRects().length);if(!all.length)return;e.preventDefault();const i=all.indexOf(document.activeElement as HTMLButtonElement);all[(i+(e.key==='ArrowDown'?1:all.length-1)+all.length)%all.length]?.focus()}};
        document.querySelector<HTMLButtonElement>('.reader-context-menu button:not(:disabled)')?.focus();
        window.addEventListener('pointerdown',close);window.addEventListener('keydown',key);
        return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',key)}
    },[contextMenu]);
    useEffect(()=>{
        const key=(e:KeyboardEvent):void=>{
            if(e.defaultPrevented||document.querySelector('[role="dialog"][aria-modal="true"]')||!e.metaKey&&!e.ctrlKey)return;
            const field=(e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]');
            if(field&&e.key!==',')return;
            const k=e.key.toLowerCase();
            if(k==='t'){e.preventDefault();if(e.shiftKey){if(!sameLanguage)setConfirmJob(true)}else if(selection)selectionTranslate();else if(!sameLanguage){switchMode('bilingual');void pageTranslate()}}
            if(k==='\\'){e.preventDefault();cycleNotes()}
            if(k==='f'){e.preventDefault();rememberReadingPosition();setNavOpen(false);setFindOpen(true);}
            if(['+','=','-','0'].includes(k)){e.preventDefault();changeZoom(k==='0'?1:Math.min(4,Math.max(.5,scale+(k==='-'?-.1:.1))))}
        };
        window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
    });
    const zoomHandler=useRef(changeZoom);zoomHandler.current=changeZoom;
    useEffect(()=>{const pane=source.current;if(!pane)return;let frame=0,delta=0,point={x:0,y:0};const wheel=(e:WheelEvent)=>{if(!e.ctrlKey)return;e.preventDefault();delta+=e.deltaY;point={x:e.clientX,y:e.clientY};if(!frame)frame=requestAnimationFrame(()=>{frame=0;zoomHandler.current(zoomValue.current*Math.exp(-delta*.003),point);delta=0})};pane.addEventListener('wheel',wheel,{passive:false});return()=>{pane.removeEventListener('wheel',wheel);cancelAnimationFrame(frame)}},[]);
    function selectionFromGloss():void{
        const native=window.getSelection();if(!native||native.isCollapsed||!native.rangeCount)return;
        const element=native.anchorNode?.parentElement?.closest<HTMLElement>('[data-translation]');
        const s=segments.find(s=>s.id===element?.dataset.translation);if(!s)return;
        const selected=native.toString();pick(s.text,segmentAnchors(s,documentVersionId),s.text);setSelection(v=>v?{...v,fromTranslation:true,text:selected,result:blocks[s.id]?.result?{...blocks[s.id].result!,text:selected}:undefined}:v);
    }
    useEffect(()=>{if(location){jumpedSearch.current=false;setCurrentPage(location.pageIndex+1);setSearchLocation(location)}},[location]);
    const sourcePick=(quote:string,anchors:PdfAnchor[],context:string):void=>{if(tool==='highlight'||tool==='underline')catchAnnotation(highlight(colorSettings.settings.recentSlot,undefined,{quote,anchors,context},tool==='underline'?'underline':'highlight'));else pick(quote,anchors,context);}
    const jumpPage=(n:number):void=>{cancelReadingMotion();n=Math.max(1,Math.min(doc?.numPages??1,n));setCurrentPage(n);programmatic.current=Date.now()+400;const ticket=jumpRevision.current;navigationFrame.current=requestAnimationFrame(()=>{if(ticket===jumpRevision.current&&mounted.current)source.current?.querySelector('[data-page="'+n+'"]')?.scrollIntoView({block:'start'})})}
    const panelVisible=(sidebar&&mode!=='inline'||!!noteEditor)&&!focused;
    const drawerNote=!!noteEditor&&(narrow||readingTools.noteLayout==='drawer');
    const activeJob=jobs.find(j=>['running','paused','failed'].includes(j.status));
    const setZoom=(n:number):void=>changeZoom(Math.min(4,Math.max(.5,n)));
    const noteLeave=useRef<(()=>Promise<boolean>)|null>(null);
    const writeSession=useRef<()=>Promise<ReaderSession|null>>(async()=>null);
    writeSession.current=async()=>{const pane=source.current,el=pane?.querySelector<HTMLElement>('[data-page="'+currentPage+'"]');let offset=pane&&el?(pane.getBoundingClientRect().top-el.getBoundingClientRect().top)/renderScale:0,viewportOffset=0;if(mode==='inline'&&pane){const spot=captureSourceAnchor(pane);if(spot){offset=spot.sourcePoint[1]/renderScale;viewportOffset=spot.viewportOffset}}const result=await window.jian.reading.save(documentVersionId,{pageIndex:currentPage-1,zoom:scale,mode:mode==='inline'?'bilingual':mode,anchor:JSON.stringify({offset,viewportOffset}),panes:JSON.stringify({panel,split})});if(!result.ok){setError(result.error.message);return null}return {pageCount:doc?.numPages??0,page:currentPage,scale,fitWidth,autoFit:autoFit.current,rotation,mode,sidebar,panel,filter:noteFilter,tool,scrollTop:pane?.scrollTop??0,scrollLeft:pane?.scrollLeft??0,targetScroll:target.current?.scrollTop??0}};
    useImperativeHandle(controllerRef,()=>({documentVersionId,leave:async()=>{if(!doc||!restored.current)return undefined;if(noteLeave.current&&!await noteLeave.current())return null;return writeSession.current()}}));
    const handlers=useRef({editNote,navigate,sourcePick,openSourceContext,tool,removeAnnotation,catchAnnotation});handlers.current={editNote,navigate,sourcePick,openSourceContext,tool,removeAnnotation,catchAnnotation};
    const pageHandlers=useMemo(()=>({onNoteOpen:(a:Annotation,e:HTMLElement)=>handlers.current.editNote(a,e),onActive:(id:string)=>handlers.current.navigate(id),onSelection:(q:string,a:PdfAnchor[],c:string)=>handlers.current.sourcePick(q,a,c),onBlockMenu:(id:string|null,e:React.MouseEvent)=>handlers.current.openSourceContext(e,id),onHighlightOpen:(rows:Annotation[],x:number,y:number)=>{setSelection(null);if(handlers.current.tool==='erase')handlers.current.catchAnnotation(handlers.current.removeAnnotation(rows[0]));else setHighlightEditor({rows,index:0,x,y})}}),[]);
    return <div className="m3-reader redesigned-reader" data-document={documentVersionId} data-text-selected={Boolean(selection&&!selection.fromTranslation||contextMenu?.selection)} data-mode={mode} data-zoom={scale} data-source-width={sourceWidth} data-panel={panelVisible} data-note-open={!!noteEditor} data-margin={false} data-note-drawer={drawerNote} data-note-mode={notesMode} data-focus={focused} data-chrome={true} data-zoom-busy={zoomBusy} data-single={readingTools.singlePage} data-current-page={currentPage} data-dock-open={dockOpen} data-paper={readingTools.paper} data-note-font={readingTools.noteFont} style={{'--reader-brightness':readingTools.brightness} as React.CSSProperties} data-placing={placing}>
        {!focused&&<><header className="toolbar reader-toolbar reader-appbar">
            <span className="toolbar__title"><Brand/></span><button type="button" className="reader-back" onClick={onBack}><Mark name="arrow-left" size={16}/>{ui('书府')}</button><div className="reader-tabs-slot">{documentTabs??<span className="reader-title" title={title}>{title}</span>}</div>
            <div className="topbar-actions"><Menu label={ui('导出')} text={ui('导出')}><div className="reader-menu-label">{ui('引用与书目')}</div><button disabled={!opened?.itemId} onClick={()=>setExportOpen(true)}>{ui('引用格式与书目导出')}</button><button disabled={!annotations.length} onClick={()=>void exportReaderNotes(false)}>{ui('Markdown · 仅札记')}</button><button disabled={!annotations.length} onClick={()=>void exportReaderNotes(true)}>{ui('Markdown · 含原文引文')}</button></Menu><HomeSwitch active="library" onLibrary={onBack} onMemoir={onDashboard}/><button className="icon-button app-settings" aria-label={ui('文房 · 设置 ⌘,')} onClick={()=>onSettings('general',opened?.itemId)}><Mark name="settings"/></button></div>
        </header><div className="reader-tools reader-toolband" role="toolbar" aria-label={ui('阅读工具')} inert={!doc} aria-busy={!doc}>
            <div className="reader-tools-left"><div className="reader-tool-group reader-browse-tools"><button aria-label={ui('目录与书签')} title={ui('目录与书签')} aria-pressed={navOpen} onClick={toggleNavigator}><Mark name="outline" size={17}/></button><button aria-label={ui('上一页')} title={ui('上一页')} disabled={!doc||currentPage<=1} onClick={()=>jumpPage(currentPage-1)}><Mark name="arrow-left" size={16}/></button><PageLocator page={currentPage} pages={doc?.numPages??initialSession?.pageCount??0} disabled={!doc} onJump={jumpPage}/><button aria-label={ui('下一页')} title={ui('下一页')} disabled={!doc||currentPage>=doc.numPages} onClick={()=>jumpPage(currentPage+1)}><Mark name="arrow-right" size={16}/></button></div>
            <div className="reader-tool-group reader-mark-tools" onMouseDown={e=>e.preventDefault()}>{([['select','text-select','选择文字'],['highlight','highlight','高亮工具'],['underline','underline','下划线']]as const).map(([id,icon,label])=><button key={id} aria-label={ui(label)} title={ui(label)} aria-pressed={tool===id&&!placing} onClick={()=>{setPlacing(false);if(id!=='select'&&selection){catchAnnotation(highlight(colorSettings.settings.recentSlot,undefined,selection,id==='underline'?'underline':'highlight'));setTool('select')}else setTool(id)}}><Mark name={icon} size={17}/></button>)}<button aria-label={ui('添加批注')} title={ui('添加批注')} onClick={()=>selection?startNote():noteCurrentPage()}><Mark name="comment" size={17}/></button></div>
            </div><div className="reader-tools-right"><div className="segmented" role="group" aria-label={ui('阅读模式')}><button aria-pressed={mode==='source'} onClick={()=>switchMode('source')}>{ui('原文')}</button><button aria-pressed={mode==='bilingual'} disabled={sameLanguage} title={sameLanguage?ui('文献与目标语言相同，无需对读。'):ui('原文 + 译文')} onClick={()=>switchMode('bilingual')}>{ui('对读')}</button></div>
            <div className="reader-zoom"><button aria-label={ui('缩小 · ⌘-')} disabled={scale<=.5} onClick={()=>changeZoom(scale-.1)}><Mark name="minus" size={16}/></button><button aria-label={ui('适合宽度')} onClick={()=>changeZoom(1)}>{Math.abs(scale-1)<.001?ui('适宽'):Math.round(scale*100)+'%'}</button><button aria-label={ui('放大 · ⌘+')} disabled={scale>=4} onClick={()=>changeZoom(scale+.1)}><Mark name="plus" size={16}/></button></div>
            <button className="reader-rotate" aria-label={ui('旋转页面')} title={ui('旋转页面')} onClick={()=>void rotatePage()}><Mark name="rotate" size={17}/></button><button className="reader-view-button" aria-label={ui('视图与纸色')} title={ui('视图与纸色')} onClick={()=>setDockOpen(true)}><Mark name="view" size={17}/></button>
            <button className="reader-notes-toggle" aria-label={ui('札记显示方式')} aria-pressed={panelVisible} onClick={cycleNotes}><Mark name="panel" size={16}/>{ui('札记')}</button>
            <Menu label={ui('阅读选项')}><button className="reader-narrow-action" onClick={()=>void rotatePage()}>{ui('旋转页面')}</button><button className="reader-narrow-action" onClick={()=>setDockOpen(true)}>{ui('视图与纸色')}</button><button onClick={()=>{rememberReadingPosition();setNavOpen(false);setFindOpen(true)}}>{ui('查找 · ⌘F')}</button><button disabled={!annotationHistory.canUndo} onClick={()=>void annotationHistory.travel(true)}>{ui('撤销')} <kbd>⌘Z</kbd></button><button disabled={!annotationHistory.canRedo} onClick={()=>void annotationHistory.travel(false)}>{ui('重做')} <kbd>⌘⇧Z</kbd></button><button disabled={!!noteEditor} onClick={()=>setFocused(v=>!v)}>{ui('专注模式')} <kbd>F</kbd></button><button onClick={openInfo}>{ui('文档信息')}</button><button onClick={()=>void systemPrint()}>{ui('系统打印（原文件）')}</button><button onClick={()=>void reloadDocument()}>{ui('重新加载')}</button><button onClick={()=>setShortcutsOpen(true)}>{ui('快捷键一览')}</button>{!sameLanguage&&<button onClick={()=>setConfirmJob(true)}>{ui('翻译全文')} <kbd>⌘⇧T</kbd></button>}{prefs.inlineEnabled&&<button onClick={()=>switchMode(mode==='inline'?'source':'inline')}>{ui('夹注 · 实验')}</button>}<button onClick={()=>onSettings('reading',opened?.itemId)}>{ui('阅读与外观')}</button><button onClick={()=>onSettings('general',opened?.itemId)}>{ui('文房')} <kbd>⌘,</kbd></button></Menu>
            </div><span ref={progressBar} className="reader-progress" aria-hidden="true" style={{width:((readingTools.singlePage?currentPage/Math.max(1,doc?.numPages??1):0)*100)+'%'}}/>
        </div></>}
        {dockOpen&&<Dialog title={ui('视图与纸色')} onClose={()=>setDockOpen(false)}><ReaderViewOptions scale={scale} tools={readingTools} onChange={patch=>void updateTools(patch)} onZoom={changeZoom} onRotate={()=>void rotatePage()} inline/></Dialog>}
        {(focused)&&<div className="reading-page-echo" data-focus={focused}><PageLocator page={currentPage} pages={doc?.numPages??initialSession?.pageCount??0} disabled={!doc} onJump={jumpPage}/>{focused&&<button className="focus-exit" onClick={()=>setFocused(false)} aria-label={ui('退出专注模式')} title={ui('退出专注模式')}>F</button>}</div>}
        {infoOpen&&<Dialog title={ui('文档信息')} onClose={()=>setInfoOpen(false)}><div className="reader-info"><h3>{title}</h3><p>{referenceLine}</p><p>{ui('PDF 共 {0} 页',doc?.numPages??0)}</p></div></Dialog>}
        {shortcutsOpen&&<Dialog title={ui('快捷键一览')} onClose={()=>setShortcutsOpen(false)}><dl className="reader-shortcuts">{[['Enter','对选区写朱批'],['N','写当前页页批'],['Esc','收起浮层'],['⌘/Ctrl + Enter','收起朱批'],['J / K','跳转朱批'],['L','目录与书签'],['F','专注模式'],['⌘/Ctrl + F','查找'],['⌘/Ctrl + Z','撤销'],['⇧ + ⌘/Ctrl + Z','重做'],['← / →','翻页']].map(([key,action])=><div key={key}><dt>{ui(action)}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl></Dialog>}
        {exportOpen&&opened?.itemId&&<ExportDialog ids={[opened.itemId]} onClose={()=>setExportOpen(false)}/>}
        {mode==='inline'&&<div className="inline-mode-tools"><span>{ui('夹注实验 · 复杂页面保留原版')}</span><button className="btn" disabled={sameLanguage} onClick={()=>translating?stop():void pageTranslate()}>{translating?ui('停止'):ui('翻译本页')}</button><span role="status">{ui(inlineStatus[currentPage]??'')}</span></div>}
        <div className="reader__body">
            {navOpen&&!focused&&doc&&<ReaderNavigator doc={doc} page={currentPage} labels={pdfLabels} chapters={chapters} bookmarks={readingTools.bookmarks} tab={navTab} setTab={setNavTab} onClose={toggleNavigator} onJump={jumpPage} onBookmark={addBookmark} onRemove={id=>void updateTools({bookmarks:readingTools.bookmarks.filter(b=>b.id!==id)})}/>}
            {findOpen&&!focused&&<aside className="reader-search-drawer"><DocumentFind version={documentVersionId} onClose={()=>setFindOpen(false)} onHit={findHit}/></aside>}

            <section ref={source} className="reader__pane reader__pane--source" aria-label={ui('原文')} onPointerDown={e=>{restoreMotion.current++;if(e.button===0)setSelection(null)}} onClickCapture={placeNoteAt} onScroll={scrollSource} onWheel={()=>{restoreMotion.current++;setSelection(null)}} onContextMenu={e=>openSourceContext(e)}>
                {(error||pdfError||toolsError)&&<p className="reader__error" role="alert">{ui(error||pdfError||toolsError)} <button className="btn" onClick={()=>setError('')}>{ui('关闭')}</button></p>}
                {loading&&<p>{ui('正在加载 PDF…')}</p>}
                {doc&&<div className="pdf-scroll">{(readingTools.singlePage?numbers.filter(n=>n===currentPage):numbers).map(n=>mode==='inline'?<InlinePdfPage key={n} doc={doc} documentVersionId={documentVersionId} pageNumber={n} scale={renderScale} rotation={rotation} {...pageHandlers} searchRects={searchLocation?.pageIndex===n-1?searchLocation.rects:undefined} annotations={annotationsByPage.get(n-1)??EMPTY_ANNOTATIONS} selectionAnchors={selection&&!selection.fromTranslation&&selection.anchors.some(a=>a.pageIndex===n-1)?selection.anchors:undefined} activeSegment={active} onSegments={onSegments} onActive={setActive} onSelection={sourcePick} translations={Object.fromEntries(Object.entries(blocks).map(([id,b])=>[id,{text:b.text,state:b.state,error:b.error,warning:b.result?.warning}]))} onTranslate={s=>void translate(s,s.id,!!blocks[s.id]?.result)} onSave={s=>void save(s.text,segmentAnchors(s,documentVersionId),blocks[s.id]?.result,'excerpt')} onStatus={reportInline}/>:<PdfPage key={n} doc={doc} documentVersionId={documentVersionId} pageNumber={n} scale={renderScale} rotation={rotation} {...pageHandlers} searchRects={searchLocation?.pageIndex===n-1?searchLocation.rects:undefined} annotations={annotationsByPage.get(n-1)??EMPTY_ANNOTATIONS} selectionAnchors={selection&&!selection.fromTranslation&&selection.anchors.some(a=>a.pageIndex===n-1)?selection.anchors:undefined} activeSegment={mode==='bilingual'&&displayByPage.get(n-1)?.some(s=>s.id===active)?active:null} flash={flash} displaySegments={displayByPage.get(n-1)??EMPTY_SEGMENTS} onSegments={onSegments}/>)}</div>}
            </section>
            {panelVisible&&<>
                <section className={"reader-side"+(noteEditor?" reader-note-rail":"")} aria-label={ui('阅读侧栏')}>
                    <div className="gloss-tabs" role="tablist" aria-label={ui('阅读侧栏')}>
                        {([['translation','笺注'],['notes','札记']] as const).map(([id,label])=><button role="tab" key={id} aria-selected={panel===id} onClick={()=>void commitNoteAction(()=>{if(noteEditor)closeNoteEditor();setPanel(id)})}>{ui(label)}</button>)}
                    </div>
                    {!noteEditor&&panel==='translation'&&<div className="gloss-page-action">
                        {translating?<><span className="translation-progress"/><button className="btn" onClick={stop}>{ui('停止')}</button></>:failed.length?<p className="gloss-failure">⚠ {ui('{0} 段未完成',failed.length)} · <button onClick={()=>void pageTranslate(true)}>{ui('重试')}</button></p>:!complete&&!sameLanguage&&currentSegments.length>0?<button className="btn btn--primary" onClick={()=>void pageTranslate()}>{ui('翻译本页')} <kbd>⌘T</kbd></button>:null}
                    </div>}
                    <div ref={target as React.RefObject<HTMLDivElement>} className="reader__pane reader__pane--target gloss-flow" onScroll={panel==='translation'?scrollTarget:undefined} onMouseUp={panel==='translation'?selectionFromGloss:undefined}>
                        {feedback&&<p className="m3-feedback" role="status">{ui(feedback)}<button aria-label={ui('关闭提示')} onClick={()=>setFeedback('')}>×</button></p>}
                        {noteEditor?<NotePopover leaveRef={noteLeave} key={noteEditor.key} draft={{...noteEditor.draft,id:noteEditor.record.current?.id??noteEditor.draft.id}} pageLabel={String((noteEditor.draft.anchors[0]?.pageIndex??0)+1)} anchorElement={null} onSave={saveNote} onColor={(color,text)=>saveNote(text,color)} onClose={closeNoteEditor} onView={()=>{setPanel('notes');setNoteFilter('notes');closeNoteEditor()}} onDelete={noteEditor.record.current?()=>removeAnnotation(noteEditor.record.current!):undefined}/>:panel==='translation'?selectionResult?<section className="selection-result"><header><strong>{ui('所选原文的笺注')}</strong><button aria-label={ui('关闭选区笺注')} onClick={()=>setSelectionResult(null)}><Mark name="close" size={14}/></button></header><blockquote>{selectionResult.quote}</blockquote>{selectionResult.error?<p role="alert">{ui(selectionResult.error)}</p>:<p className="translation-body">{selectionResult.text||ui('正在翻译…')}</p>}<button className="provider-text-button" disabled={!selectionResult.text} onClick={()=>void window.jian.clipboard.writeText(selectionResult.text)}>{ui('复制译文')}</button></section>:<>
                            {sameLanguage?<p className="reader-empty">{ui('文献与目标语言相同，无需对读。')}</p>:!segments.length?<p className="reader-empty">{ui('正在提取可读段落；无文本层页面可继续阅读原文。')}</p>:<>
                            {!complete&&!translating&&<p className="gloss-empty-hint">{ui('这一页还没有完整笺注。')} <span>{ui('原文 + 译文')}</span></p>}
                            {visibleSegments.map(s=>ignored(s)?<details className="ignored-block" key={s.id}><summary>{ui('已忽略的内容')} · {ui('第 {0} 页',s.pageIndex+1)}</summary><p>{s.text}</p></details>:<GlossBlock key={s.id} segment={s} state={blocks[s.id]} active={active===s.id} edited={readerData.edits[editKey(s)]?.source===s.text?readerData.edits[editKey(s)].text:undefined} terms={terms} onNavigate={()=>navigate(s.id,true)} onTranslate={()=>void translate(s,s.id,!!blocks[s.id]?.result)} onCopy={()=>void window.jian.clipboard.writeText(readerData.edits[editKey(s)]?.text??blocks[s.id]?.text??'')} onSave={()=>void save(s.text,segmentAnchors(s,documentVersionId),blocks[s.id]?.result,'excerpt')} onEdit={()=>setEditing({segment:s,text:readerData.edits[editKey(s)]?.text??blocks[s.id]?.text??''})} onContext={e=>{e.preventDefault();if(selection?.fromTranslation&&window.getSelection()?.isCollapsed===false){setSelectionExpanded(true);setContextMenu(null)}else{setSelection(null);setContextMenu({x:Math.max(12,Math.min(e.clientX,innerWidth-260)),y:Math.max(86,Math.min(e.clientY,innerHeight-340)),id:s.id,kind:'translation'})}}}/>)}
                            </>}
                        </>:<NotesPanel labels={pdfLabels} rows={annotations} title={title} version={documentVersionId} metadata={referenceLine} filter={noteFilter} setFilter={setNoteFilter} onJump={revealAnnotation} onEdit={a=>a.type==='note'?editNote(a):setHighlightEditor({rows:[a],index:0,x:Math.max(12,innerWidth-400),y:120})} onDelete={a=>catchAnnotation(removeAnnotation(a))}/>}
                        {activeJob&&<div className="job-panel"><span>{ui('翻译任务')} · {activeJob.completed}/{activeJob.total}</span><button className="provider-text-button" onClick={()=>void window.jian.m3.controlJob(activeJob.id,activeJob.status==='running'?'pause':'resume')}>{activeJob.status==='running'?ui('暂停'):ui('继续')}</button><button className="provider-text-button" onClick={()=>void window.jian.m3.controlJob(activeJob.id,'cancel')}>{ui('取消')}</button>{activeJob.error&&<p className="reader__error">{ui(activeJob.error)}</p>}</div>}
                    </div>
                    {panel==='translation'&&!noteEditor&&<button className="gloss-engine" title={ui('翻译服务')} onClick={()=>onSettings('translation',opened?.itemId)}>{provider?.model??ui('未配置')} · {ui('已译 {0}/{1} 页',Object.values(pages).filter(ss=>ss.filter(s=>!ignored(s)).length&&ss.filter(s=>!ignored(s)).every(s=>blocks[s.id]?.result)).length,doc?.numPages??0)}</button>}
                </section>
            </>}

        </div>
        {!panelVisible&&feedback&&<div className="reader-status" role="status">{ui(feedback)}</div>}
        {placing&&<div className="annotation-placement" role="status">{ui('点击页面落批 · Esc 取消')}</div>}
        {annotationHistory.deletedUntil>Date.now()&&<div className="annotation-toast" role="status">{ui('已删除')} <button onClick={()=>void annotationHistory.travel(true)}>{ui('撤销')}</button></div>}
        {selection&&!focused&&<div ref={selectionToolbar} className="selection-panel selection-toolbar selection-slim" data-docked={selectionDocked} style={selectionDocked?undefined:{left:selectionPosition.left,top:selectionPosition.top}} role="dialog" aria-label={ui('选区操作')} onMouseDown={e=>e.preventDefault()}><SelectionTools colors={[2,4,5,3].map(slot=>({slot,color:palette(colorSettings.settings.paletteId).colors[slot-1],name:(getLocale()==='en'?palette(colorSettings.settings.paletteId).english:palette(colorSettings.settings.paletteId).names)[slot-1]}))} expanded={selectionExpanded} onExpand={()=>setSelectionExpanded(v=>!v)} canRepair={readerReady&&!saveBusy&&!selection.fromTranslation} onRepair={()=>void repair('replace')} onHighlight={slot=>catchAnnotation(highlight(slot))} onUnderline={()=>catchAnnotation(highlight(colorSettings.settings.recentSlot,undefined,selection,'underline'))} onNote={()=>startNote()} onCopy={()=>void copySelection()} onCitation={()=>void copyQuotedPassage()} onExcerpt={()=>void save(selection.quote,selection.anchors,selection.result,'excerpt')} onPaste={()=>void pasteMarginNote()} onTranslate={selectionTranslate} busy={selection.state==='loading'} message={selectionMessage}/></div>}
        {highlightEditor&&<div className="highlight-popover" role="dialog" aria-label={ui('编辑高亮')} style={{left:Math.max(12,Math.min(innerWidth-330,highlightEditor.x)),top:Math.max(76,Math.min(innerHeight-300,highlightEditor.y))}}>
            <div className="highlight-heading"><span>{ui('高亮')}{highlightEditor.rows.length>1&&<button onClick={()=>setHighlightEditor(v=>v?{...v,index:(v.index+1)%v.rows.length}:v)}>{ui('此处有 {0} 条',highlightEditor.rows.length)} · {highlightEditor.index+1}</button>}</span><button className="icon-button" aria-label={ui('关闭')} onClick={()=>setHighlightEditor(null)}><Mark name="close" size={16}/></button></div>
            <ColorLabel a={highlightEditor.rows[highlightEditor.index]}/><ColorChoices settings={colorSettings.settings} onPick={slot=>catchAnnotation(highlight(slot,highlightEditor.rows[highlightEditor.index]))}/><div className="highlight-actions"><button onClick={()=>{const a=highlightEditor.rows[highlightEditor.index];startNote(a.anchors,a.quote)}}>{ui('写朱批')}</button><button onClick={()=>void window.jian.clipboard.writeText(highlightEditor.rows[highlightEditor.index].quote)}>{ui('复制')}</button><button onClick={()=>catchAnnotation(removeAnnotation(highlightEditor.rows[highlightEditor.index]))}>{ui('删除')}</button></div>
        </div>}

        {contextMenu&&<div className="quiet-menu reader-context-menu" style={{left:contextMenu.x,top:contextMenu.y}} onPointerDown={e=>e.stopPropagation()} role="group" aria-label={ui('阅读操作')}>
            <div className="context-heading">{contextMenu.kind==='translation'?ui('此段译文'):contextMenu.selection?ui('已选原文'):ui('页面操作')}</div>
            {contextMenu.kind==='translation'&&contextMenu.id&&(()=>{const s=segments.find(s=>s.id===contextMenu.id);if(!s)return null;const text=readerData.edits[editKey(s)]?.text??blocks[s.id]?.text;return <><button disabled={!text} onClick={()=>{void window.jian.clipboard.writeText(text??'');setContextMenu(null)}}>{ui('复制译文')}</button><button disabled={!text} onClick={()=>{setEditing({segment:s,text:text??''});setContextMenu(null)}}>{ui('编辑译文')}</button><button onClick={()=>{void translate(s,s.id,!!text);setContextMenu(null)}}>{text?ui('重新翻译此段'):ui('翻译此段')}</button><button onClick={()=>{setContextMenu(null);startNote(segmentAnchors(s,documentVersionId),s.text)}}>{ui('批注对应原文')}</button><details><summary>{ui('段落识别修正')}</summary><button disabled={!readerReady||saveBusy} onClick={()=>void repair('merge')}>{ui('合并到上一段')}</button><button disabled={!readerReady||saveBusy} onClick={()=>void repair('ignore')}>{ui('忽略此块')}</button>{readerData.overrides.length>0&&<button onClick={()=>{void updateReader({...readerData,overrides:[]});setContextMenu(null)}}>{ui('恢复自动切分')}</button>}</details></>})()}
            {contextMenu.kind==='source'&&!contextMenu.selection&&<><button disabled={!contextMenu.point} onClick={()=>{const p=contextMenu.point;setContextMenu(null);if(p)pointNoteAt(p.x,p.y,p.element as PageElement)}}>{ui('在此添加朱批')}</button><button onClick={()=>{setZoom(1);setContextMenu(null)}}>{ui('适合宽度')}</button><button onClick={()=>{setFindOpen(true);setContextMenu(null)}}>{ui('查找 · ⌘F')}</button></>}
        </div>}
        {editing&&<Dialog title={ui('编辑译文')} onClose={()=>setEditing(null)} footer={<div className="m3-actions"><button className="btn" disabled={saveBusy} onClick={()=>{const next={...readerData.edits};delete next[editKey(editing.segment)];void updateReader({...readerData,edits:next}).then(saved=>{if(saved)setEditing(null)})}}>{ui('恢复机器译文')}</button><button className="btn btn--primary" disabled={saveBusy||!editing.text.trim()} onClick={()=>void updateReader({...readerData,edits:{...readerData.edits,[editKey(editing.segment)]:{source:editing.segment.text,text:editing.text}}}).then(saved=>{if(saved)setEditing(null)})}>{ui('保存')}</button></div>}><textarea className="note-editor" aria-label={ui('译文内容')} value={editing.text} onChange={e=>setEditing(v=>v?{...v,text:e.target.value}:v)}/></Dialog>}
        {glossary&&<GlossaryDialog itemId={opened?.itemId??null} initial={glossary} onClose={()=>setGlossary(null)}/>}
        {confirmJob&&<Dialog title={ui('翻译全文')} onClose={()=>setConfirmJob(false)}><p>{ui('已解析 {0}/{1} 页，共 {2} 个可翻译段落。',Object.keys(pages).length,doc?.numPages??0,segments.filter(s=>!ignored(s)).length)}</p><p>{ui('将向 {0}（模型 {1}）发送文字。首次整篇估算 {2}–{3} Token；缓存命中会跳过请求，实际费用以服务商账单为准。',provider?.baseUrl,provider?.model,Math.ceil(segments.reduce((n,s)=>n+s.text.length,0)/4),Math.ceil(segments.reduce((n,s)=>n+s.text.length,0)*2))}</p><p className="m3-muted">{ui('任务可暂停并在重启后继续；关闭阅读器不取消后台任务。配置与术语在开始时固定。')}</p><button className="btn btn--primary" disabled={sameLanguage||!readerReady||!doc||Object.keys(pages).length<doc.numPages} onClick={()=>void window.jian.m3.startJob(documentVersionId,segments,opened?.itemId??null).then(r=>{if(r.ok){setFeedback(ui('整篇任务已开始'));setConfirmJob(false)}else setError(r.error.message)})}>{ui('开始翻译')}</button></Dialog>}
    </div>;
}
