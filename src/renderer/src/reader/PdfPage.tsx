import {stackAnnotations} from '@shared/annotations'
import AnnotationLayer from './AnnotationLayer'
import { ui } from '../i18n'
import { memo, useEffect, useRef, useState } from 'react';
import { TextLayer, Util } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { Annotation, PdfAnchor, Segment, Rect } from '@shared/m3';
import { analyzePage, type Glyph } from './layout/analyze';
import { collectSourceSelection } from './inline/selection';
export interface PdfPageProps {
    doc: PDFDocumentProxy;
    documentVersionId: string;
    pageNumber: number;
    scale: number;
    rotation?:number;
    onNoteOpen?:(a:Annotation,element:HTMLElement)=>void;
    onHighlightOpen?:(rows:Annotation[],x:number,y:number)=>void;
    searchRects?: Rect[];
    annotations: Annotation[];
    selectionAnchors?:PdfAnchor[];
    activeSegment: string | null;
    onSegments: (page: number, segments: Segment[]) => void;
    onActive: (id: string) => void;
    displaySegments?:Segment[];
    flash?:string;
    onBlockMenu?:(id:string|null,event:React.MouseEvent)=>void;
    onSelection: (quote: string, anchors: PdfAnchor[], context: string) => void;
}
function PdfPage({ doc, documentVersionId, pageNumber, scale, rotation=0,onNoteOpen,onHighlightOpen, searchRects, annotations, selectionAnchors, activeSegment, onSegments, onActive, onSelection, displaySegments,flash,onBlockMenu }: PdfPageProps): React.ReactElement {
    const [hasBeenVisible,setHasBeenVisible]=useState(pageNumber<=2);
    const [hover,setHover]=useState<string|null>(null);
    const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), textHost = useRef<HTMLDivElement>(null);
    const [page, setPage] = useState<PDFPageProxy | null>(null), [segments, setSegments] = useState<Segment[]>([]), [links, setLinks] = useState<Array<{
        rect: Rect;
        url?: string;
        dest?: unknown;
    }>>([]), [visible, setVisible] = useState(pageNumber <= 2), [error, setError] = useState('');
    useEffect(() => { let dead = false; void doc.getPage(pageNumber).then(p => { if (!dead)
        setPage(p); }); return () => { dead = true; }; }, [doc, pageNumber]);
    useEffect(() => { if (!host.current)
        return; const io = new IntersectionObserver(entries => {setVisible(entries[0].isIntersecting);if(entries[0].isIntersecting)setHasBeenVisible(true)}, { rootMargin: '600px' }); io.observe(host.current); return () => io.disconnect(); }, []);
    useEffect(() => {
        if (!page||!hasBeenVisible)
            return;
        let dead = false;
        void page.getTextContent().then(content => {
            if (dead)
                return;
            const vp = page.getViewport({ scale: 1, rotation: 0 }), glyphs: Glyph[] = [];
            for (let i = 0; i < content.items.length; i++) {
                const item = content.items[i];
                if (!('str' in item) || !item.str.trim())
                    continue;
                const m = item.transform, fs = Math.hypot(m[2], m[3]), angle = Math.atan2(m[1], m[0]), w = item.width;
                const dx = Math.cos(angle) * w, dy = Math.sin(angle) * w, hx = -Math.sin(angle) * fs, hy = Math.cos(angle) * fs;
                const points = [[m[4], m[5]], [m[4] + dx, m[5] + dy], [m[4] + hx, m[5] + hy], [m[4] + dx + hx, m[5] + dy + hy]];
                const transformed = points.map(([x, y]) => vp.convertToViewportPoint(x, y)), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
                glyphs.push({ index: i, text: item.str, x0: Math.min(...transformed.map(p => p[0])), y0: Math.min(...transformed.map(p => p[1])), x1: Math.max(...transformed.map(p => p[0])), y1: Math.max(...transformed.map(p => p[1])), rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
            }
            const blocks = analyzePage(glyphs, vp.width, vp.height, pageNumber - 1);
            setSegments(blocks);
            onSegments(pageNumber - 1, blocks);
        }).catch(() => setError(ui("此页无法提取文本，可继续阅读原文")));
        void page.getAnnotations({ intent: 'display' }).then(as => { if (!dead)
            setLinks(as.filter(a => a.subtype === 'Link' && a.rect).map(a => ({ rect: a.rect, url: a.url, dest: a.dest }))); });
        return () => { dead = true; };
    }, [page, pageNumber, onSegments,hasBeenVisible]);
    useEffect(() => {
        const c = canvas.current;
        if (!page || !c || !visible) {
            if (c) {
                c.width = 0;
                c.height = 0;
            }
            return;
        }
        const vp = page.getViewport({ scale,rotation:page.rotate+rotation }), dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8000000 / (vp.width * vp.height)));
        // Keep the previous raster visible while the next scale is rendered offscreen.
        const staging=document.createElement('canvas');staging.width=Math.floor(vp.width*dpr);staging.height=Math.floor(vp.height*dpr);
        const context=staging.getContext('2d');if(!context)return;
        const render=page.render({canvasContext:context,viewport:vp,transform:[dpr,0,0,dpr,0,0]} as Parameters<typeof page.render>[0]);let dead=false;
        void render.promise.then(()=>{if(dead)return;c.width=staging.width;c.height=staging.height;c.getContext('2d')?.drawImage(staging,0,0);host.current?.setAttribute('data-raster-scale',String(scale));staging.width=0;staging.height=0}).catch(e=>{if(!dead&&!String(e).includes('RenderingCancelled'))setError(ui('此页绘制失败，请重新打开'))});
        return()=>{dead=true;render.cancel();staging.width=0;staging.height=0};

    }, [page, scale, rotation, visible]);
    // Keep the lightweight text DOM while canvas is virtualized: a cross-page selection
    // must not lose earlier ranges when the reader scrolls to its end.
    useEffect(() => {
        const t = textHost.current;
        if (!page || !t||!hasBeenVisible)
            return;
        const vp = page.getViewport({ scale,rotation:page.rotate+rotation });
        host.current?.setAttribute('data-text-ready','false');
        t.replaceChildren();
        t.style.setProperty('--total-scale-factor', String(scale * page.userUnit));
        t.style.setProperty('--scale-round-x', '1px');
        t.style.setProperty('--scale-round-y', '1px');
        const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: t, viewport: vp });
        let dead = false;
        void layer.render().then(()=>{if(!dead)host.current?.setAttribute('data-text-ready','true')}).catch(() => { if (!dead)
            setError(ui("文本层未完成，可继续阅读原页")); });
        return () => { dead = true; layer.cancel(); t.replaceChildren(); };
    }, [page, scale,rotation,hasBeenVisible]);
    const vp = page?.getViewport({ scale,rotation:page.rotate+rotation }), box = vp ? { width: vp.width, height: vp.height } : { width: 612 * scale, height: 792 * scale };
    const cssRect = (rect: Rect): React.CSSProperties => { if (!vp)
        return {}; const a = vp.convertToViewportPoint(rect[0], rect[1]), b = vp.convertToViewportPoint(rect[2], rect[3]); const r = Util.normalizeRect([a[0], a[1], b[0], b[1]]); return { left: r[0], top: r[1], width: r[2] - r[0], height: r[3] - r[1] }; };
    function select(): void {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount || !host.current || !page)
            return;
        const range = selection.getRangeAt(0);
        if (!range.intersectsNode(textHost.current!))
            return;
        // Reader gathers every page's clipped range, so cross-page selections keep all anchors.
        const pane = host.current.closest('.reader__pane--source');
        const anchors = pane ? collectSourceSelection(pane, range, documentVersionId, scale) : [];
        if (anchors.length) {
            const quote = anchors.map(a => a.exact).join('\n\n').trim();
            if (quote)
                onSelection(quote, anchors, segments.find(s => s.text.includes(quote.slice(0, 30)))?.text ?? segments.map(s => s.text).join('\n').slice(0, 6000));
        }
    }
    useEffect(() => { const h = host.current as (HTMLDivElement & {
        pdfPage?: PDFPageProxy;
    }) | null; if (h)
        h.pdfPage = page ?? undefined; }, [page]);
    const shown=(displaySegments??segments).flatMap(s=>{
        const part=s.parts?.find(p=>p.pageIndex===pageNumber-1);
        return part?[{...s,rects:part.rects}]:!s.parts&&s.pageIndex===pageNumber-1?[s]:[];
    });
    const bounds=(s:Segment):React.CSSProperties=>{
        const boxes=s.rects.map(cssRect);
        const left=Math.min(...boxes.map(b=>Number(b.left))),top=Math.min(...boxes.map(b=>Number(b.top)));
        return {left,top,width:Math.max(...boxes.map(b=>Number(b.left)+Number(b.width)))-left,height:Math.max(...boxes.map(b=>Number(b.top)+Number(b.height)))-top};
    };
    return <div ref={host} className="pdf-page-host" style={box} data-page={pageNumber} data-rotation={rotation} data-render-scale={scale} onContextMenu={e=>onBlockMenu?.(hover,e)} onMouseMove={e=>{if(window.getSelection()?.isCollapsed===false)return;const h=host.current!.getBoundingClientRect(),x=e.clientX-h.left,y=e.clientY-h.top;const hit=shown.find(s=>{const b=bounds(s);return x>=Number(b.left)&&x<=Number(b.left)+Number(b.width)&&y>=Number(b.top)&&y<=Number(b.top)+Number(b.height)});setHover(hit?.id??null)}} onMouseLeave={()=>setHover(null)} onClick={e=>{if(!(e.target as HTMLElement).closest('a,button')&&window.getSelection()?.isCollapsed&&page&&vp){const h=host.current!.getBoundingClientRect(),p=vp.convertToPdfPoint(e.clientX-h.left,e.clientY-h.top),hits=annotations.filter(a=>(a.type==='highlight'||a.type==='excerpt')&&a.anchors.some(x=>x.pageIndex===pageNumber-1&&x.rects.some(r=>p[0]>=r[0]&&p[0]<=r[2]&&p[1]>=r[1]&&p[1]<=r[3]))).sort(stackAnnotations).reverse();if(hits.length){e.stopPropagation();onHighlightOpen?.(hits,e.clientX,e.clientY);return}}if(!(e.target as HTMLElement).closest('a,button')&&window.getSelection()?.isCollapsed&&hover)onActive(hover)}} onMouseUp={select} onKeyUp={e => { if (e.key === 'Shift')
        select(); }}>
  <canvas ref={canvas} className="pdf-page" style={{ width: box.width, height: box.height }} aria-hidden="true"/>
  {page&&<AnnotationLayer page={page} pageNumber={pageNumber} scale={scale} rotation={rotation} annotations={annotations} selectionAnchors={selectionAnchors} onOpen={onNoteOpen}/>}
  <div className="pdf-search-highlights" aria-hidden="true">{searchRects?.map((r,i)=><span key={i} style={cssRect(r)}/>)}</div>
  <div ref={textHost} className="textLayer"/>
  {links.map((l, i) => <a key={i} className="pdf-link" style={cssRect(l.rect)} href={l.url && /^https?:/.test(l.url) ? l.url : undefined} target="_blank" rel="noreferrer" aria-label={l.url ?? ui("PDF 内部链接")} onClick={e => { if (!l.url) {
        e.preventDefault();
        void (async () => { const dest = typeof l.dest === 'string' ? await doc.getDestination(l.dest) : l.dest; if (Array.isArray(dest)) {
            const idx = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
            document.querySelector(`[data-page="${idx + 1}"]`)?.scrollIntoView({ block: 'start' });
        } })();
    } }}/>)}
  <div className="paragraph-markers">{shown.filter(s=>s.kind!=='margin'&&s.kind!=='reference').map((s,i)=><button type="button" key={s.id} style={{top:Number(bounds(s).top)}} data-segment={s.id} className={activeSegment===s.id?'is-active':''} aria-label={ui("查看第 {0} 段译文",i+1)} onClick={()=>onActive(s.id)}><span>{i+1}</span></button>)}</div>
  {shown.filter(s=>s.id===activeSegment||s.id===hover&&s.kind!=='margin').map(s=><span key={s.id===activeSegment?flash||s.id:s.id} className={s.id===activeSegment?'pdf-block-active':'pdf-block-hover'} style={bounds(s)} aria-hidden="true"/>)}
  {error && <span className="page-note">{ui(error)}</span>}
  {page && !segments.length && visible && <span className="page-note">{ui("未检测到可提取文字；可阅读原页，OCR 暂未提供")}</span>}
 </div>;
}

export default memo(PdfPage);
