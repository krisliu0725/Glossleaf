import AnnotationLayer from './AnnotationLayer'
import { ui } from '../i18n'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { OPS, TextLayer, Util } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { Rect, Segment } from '@shared/m3';
import PdfPage, { type PdfPageProps } from './PdfPage';
import { analyzePage, type Glyph } from './layout/analyze';
import { bandGeometry, pixelBands, planInlinePage, rasterBudget, type LayoutSegment } from './inline/geometry';
import { captureSourceAnchor, collectSourceSelection, restoreSourceAnchor, type PageElement, type StableSourceAnchor } from './inline/selection';
import './inline/inline.css';
export interface InlineTranslation { text: string; state: string; error?: string; warning?: string }
interface Props extends PdfPageProps {
    translations: Record<string, InlineTranslation>;
    onTranslate: (segment: Segment) => void;
    onSave: (segment: Segment) => void;
    onStatus: (pageNumber: number, reason: string | null) => void;
}
interface ParsedPage { page: PDFPageProxy; segments: Segment[]; layout: LayoutSegment[]; graphics: boolean; rotatedText: boolean }
const graphicsOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.constructPath, OPS.shadingFill]);
export default function InlinePdfPage(props: Props): React.ReactElement {
    const { doc, documentVersionId, pageNumber, scale, translations, onSegments, onStatus, onActive, onSelection, onTranslate, onSave, annotations, searchRects, activeSegment } = props;
    const host = useRef<HTMLDivElement>(null), tiles = useRef(new Map<string, HTMLCanvasElement>()), layers = useRef(new Map<string, HTMLDivElement>()), inserts = useRef(new Map<string, HTMLDivElement>());
    const [parsed, setParsed] = useState<ParsedPage | null>(null), [failure, setFailure] = useState(''), [heights, setHeights] = useState<Record<string, number>>({}), [visible, setVisible] = useState(pageNumber <= 2);
    const pendingAnchor = useRef<{pane: HTMLElement; anchor: StableSourceAnchor} | null>(null);
    useEffect(() => {
        let dead = false; setParsed(null); setFailure(''); setHeights({});
        void (async () => {
            const page = await doc.getPage(pageNumber), [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
            if (dead) return;
            const vp = page.getViewport({scale:1,rotation:0}), glyphs: Glyph[] = []; let rotatedText = false;
            for (let i = 0; i < content.items.length; i++) {
                const item = content.items[i]; if (!('str' in item) || !item.str.trim()) continue;
                const m = item.transform, fs = Math.hypot(m[2], m[3]), angle = Math.atan2(m[1], m[0]);
                if (Math.abs(angle) > .005) rotatedText = true;
                const dx = Math.cos(angle) * item.width, dy = Math.sin(angle) * item.width, hx = -Math.sin(angle) * fs, hy = Math.cos(angle) * fs;
                const points = [[m[4],m[5]],[m[4]+dx,m[5]+dy],[m[4]+hx,m[5]+hy],[m[4]+dx+hx,m[5]+dy+hy]], display = points.map(([x,y]) => vp.convertToViewportPoint(x,y));
                glyphs.push({ index:i, text:item.str, x0:Math.min(...display.map(p=>p[0])), y0:Math.min(...display.map(p=>p[1])), x1:Math.max(...display.map(p=>p[0])), y1:Math.max(...display.map(p=>p[1])), rect:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))] });
            }
            const segments = analyzePage(glyphs,vp.width,vp.height,pageNumber-1);
            const layout: LayoutSegment[] = segments.map(segment => {
                const rs = segment.rects.map(r=>Util.normalizeRect([...vp.convertToViewportPoint(r[0],r[1]),...vp.convertToViewportPoint(r[2],r[3])]));
                return { segment, bounds:[Math.min(...rs.map(r=>r[0])),Math.min(...rs.map(r=>r[1])),Math.max(...rs.map(r=>r[2])),Math.max(...rs.map(r=>r[3]))] };
            });
            setParsed({page,segments,layout,graphics:operators.fnArray.some(op=>graphicsOps.has(op)),rotatedText});
            onSegments(pageNumber-1,segments);
        })().catch(() => { if (!dead) setFailure(ui("页面分析未完成，已保留原版。")); });
        return () => { dead = true; };
    },[doc,pageNumber,onSegments]);
    const vp = parsed?.page.getViewport({scale}), plan = useMemo(() => {
        if (!parsed || !vp) return null;
        return planInlinePage(vp.width,vp.height,parsed.page.rotate,parsed.layout.map(l=>({...l,bounds:l.bounds.map(n=>n*scale) as Rect})),heights,parsed.graphics,parsed.rotatedText);
    },[parsed,scale,heights,vp?.width,vp?.height]);
    const fallback = failure || (plan && !plan.ok ? plan.reason : '');
    const geometry = useMemo(() => plan?.ok ? bandGeometry(plan.bands) : null,[plan]);
    useEffect(() => { onStatus(pageNumber, fallback || null); },[fallback,pageNumber,onStatus]);
    useEffect(() => {
        const el = host.current; if (!el) return;
        const io = new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting),{rootMargin:'500px'});io.observe(el);return()=>io.disconnect();
    },[!!plan, fallback]);
    useLayoutEffect(() => {
        if (!host.current || !parsed || !geometry) return;
        const el = host.current as PageElement; el.pdfPage = parsed.page; el.pdfGeometry = geometry;
        if (pendingAnchor.current) { const {pane,anchor} = pendingAnchor.current; restoreSourceAnchor(pane,anchor);pendingAnchor.current = null; }
        return () => { delete el.pdfGeometry; delete el.pdfPage; };
    },[parsed,geometry]);
    const bandIds = plan?.ok ? plan.bands.map(b=>b.id).join('|') : '';
    // The source buffer is bounded independently of translation height. Copies cover each row exactly once.
    useEffect(() => {
        if (!parsed || !plan?.ok || !vp || !visible || fallback) {
            tiles.current.forEach(c=>{c.width=0;c.height=0;}); return;
        }
        let dead = false;
        const budget = rasterBudget(vp.width,vp.height,window.devicePixelRatio||1), source = document.createElement('canvas');
        source.width=budget.width;source.height=budget.height;
        const context=source.getContext('2d');if(!context)return;
        const render=parsed.page.render({canvasContext:context,viewport:vp,transform:[budget.width/vp.width,0,0,budget.height/vp.height,0,0]} as Parameters<typeof parsed.page.render>[0]);
        void render.promise.then(()=>{
            if(dead)return;
            const rows=pixelBands(plan.bands,source.height,vp.height);
            plan.bands.forEach((band,i)=>{const c=tiles.current.get(band.id);if(!c)return;c.width=source.width;c.height=rows[i].end-rows[i].start;c.getContext('2d')?.drawImage(source,0,rows[i].start,source.width,c.height,0,0,source.width,c.height);});
            host.current?.setAttribute('data-raster-bytes',String(budget.bytes));
            source.width=0;source.height=0;
        }).catch(e=>{if(!dead&&!String(e).includes('RenderingCancelled'))setFailure(ui("页面绘制未完成，已保留原版。"));});
        return()=>{dead=true;render.cancel();source.width=0;source.height=0;};
    // Translation changes update DOM geometry without rerendering source pixels.
    },[parsed,scale,visible,bandIds,fallback]);
    useEffect(()=>{
        if(!parsed||!plan?.ok||!vp||fallback||!host.current)return;
        let dead=false;
        const staging=document.createElement('div');staging.className='textLayer inline-text-staging';
        staging.style.width=`${vp.width}px`;staging.style.height=`${vp.height}px`;
        staging.style.setProperty('--total-scale-factor',String(scale*parsed.page.userUnit));staging.style.setProperty('--scale-round-x','1px');staging.style.setProperty('--scale-round-y','1px');
        host.current.appendChild(staging);
        layers.current.forEach(l=>l.replaceChildren());
        const text=new TextLayer({textContentSource:parsed.page.streamTextContent(),container:staging,viewport:vp});
        void text.render().then(()=>{
            if(dead||!host.current)return;
            const box=staging.getBoundingClientRect();
            // Flat PDF.js spans retain its font metrics and native selection. Nested marked content is conservative fallback.
            if([...staging.children].some(el=>el.classList.contains('markedContent'))) {setFailure(ui("此页文本层含嵌套标记结构，已保留原版。"));return;}
            const placements:Array<{el:Element;bandId:string}>=[];
            let previousBandId=plan.bands[0].id;
            for(const child of [...staging.children]) {
                if(child.tagName==='BR'){placements.push({el:child,bandId:previousBandId});continue;}
                const r=child.getBoundingClientRect();
                const y0=r.top-box.top,y1=r.bottom-box.top;
                const band=plan.bands.find(b=>y0>=b.source[1]-.5&&y1<=b.source[3]+.5);
                if(!band&&child.textContent?.trim()){setFailure(ui("文字边界穿过片段切线，已保留原版。"));return;}
                if(band){placements.push({el:child,bandId:band.id});previousBandId=band.id;}
            }
            placements.forEach(({el,bandId})=>layers.current.get(bandId)?.appendChild(el));
            host.current.dataset.textReady='true';staging.remove();
        }).catch(()=>{if(!dead)setFailure(ui("文本层未完整生成，已保留原版。"));});
        return()=>{dead=true;text.cancel();staging.remove();layers.current.forEach(l=>l.replaceChildren());};
    },[parsed,scale,bandIds,fallback]);
    useLayoutEffect(()=>{
        if(!plan?.ok||fallback)return;
        const observer=new ResizeObserver(()=>{
            const next:Record<string,number>={};inserts.current.forEach((el,id)=>{next[id]=el.getBoundingClientRect().height;});
            if(Object.keys(next).some(id=>Math.abs((heights[id]??0)-next[id])>.25)||Object.keys(heights).some(id=>!(id in next))){
                const pane=host.current?.closest<HTMLElement>('.reader__pane--source');
                const anchor=pane?captureSourceAnchor(pane):null;
                if(pane&&anchor)pendingAnchor.current={pane,anchor};
                setHeights(next);
            }
        });
        inserts.current.forEach(el=>observer.observe(el));return()=>observer.disconnect();
    },[translations,bandIds,heights,fallback]);
    const [links,setLinks]=useState<Array<{rect:Rect;url?:string;dest?:unknown}>>([]);
    useEffect(()=>{let dead=false;void parsed?.page.getAnnotations({intent:'display'}).then(as=>{if(!dead)setLinks(as.filter(a=>a.subtype==='Link'&&a.rect).map(a=>({rect:a.rect,url:a.url,dest:a.dest})));});return()=>{dead=true;};},[parsed]);
    function mappedRect(rect:Rect):Rect[]{if(!vp||!geometry)return[];return geometry.fromSourceRect(Util.normalizeRect([...vp.convertToViewportPoint(rect[0],rect[1]),...vp.convertToViewportPoint(rect[2],rect[3])]) as Rect);}
    const styleRect=(r:Rect):React.CSSProperties=>({left:r[0],top:r[1],width:r[2]-r[0],height:r[3]-r[1]});
    function select():void{
        const s=window.getSelection(),pane=host.current?.closest('.reader__pane--source');if(!s||s.isCollapsed||!s.rangeCount||!pane||!host.current)return;
        const range=s.getRangeAt(0);if(![...host.current.querySelectorAll('.textLayer')].some(el=>range.intersectsNode(el)))return;
        const anchors=collectSourceSelection(pane,range,documentVersionId,scale),quote=anchors.map(a=>a.exact).join('\n\n').trim();
        if(quote)onSelection(quote,anchors,parsed?.segments.map(s=>s.text).join('\n').slice(0,6000)??'');
    }
    if(props.rotation)return <PdfPage {...props}/>;
    if(fallback)return <div className="inline-fallback"><p className="inline-fallback__reason" role="status">{ui("第 {0} 页 · {1}", pageNumber, ui(fallback))}</p><PdfPage {...props}/></div>;
    if(!plan?.ok||!parsed||!vp)return <div className="inline-preparing" style={{width:612*scale,height:792*scale}}>{ui("正在检查第 {0} 页的行间适配条件…", pageNumber)}</div>;
    return <div ref={host} className="pdf-page-host inline-page" data-page={pageNumber} data-render-scale={scale} data-rotation={0} data-inline="true" data-text-ready="false" style={{width:vp.width,height:plan.height}} onMouseUp={select} onKeyUp={e=>{if(e.key==='Shift')select();}}>
        {plan.bands.map(b=>{
            const segment=parsed.segments.find(s=>s.id===b.segmentId)!,translation=translations[b.segmentId],eligible=segment.kind!=='margin'&&segment.kind!=='reference';
            return <div key={b.id} className="inline-band" data-source-band={b.id} style={{top:b.target[1],height:b.target[3]-b.target[1]}}>
                <canvas ref={el=>{if(el)tiles.current.set(b.id,el);else tiles.current.delete(b.id);}} style={{width:vp.width,height:b.source[3]-b.source[1]}} aria-hidden="true"/>
                <div ref={el=>{if(el)layers.current.set(b.id,el);else layers.current.delete(b.id);}} className="textLayer" style={{top:-b.source[1],width:vp.width,height:vp.height,'--inline-clip-top':`${b.source[1]}px`,'--inline-clip-bottom':`${vp.height-b.source[3]}px`,'--total-scale-factor':String(scale*parsed.page.userUnit),'--scale-round-x':'1px','--scale-round-y':'1px'} as React.CSSProperties}/>
                {eligible&&<button type="button" className={`inline-paragraph-marker ${activeSegment===segment.id?'is-active':''}`} disabled={translation?.state==='loading'} data-segment={segment.id} aria-label={ui("翻译第 {0} 段", parsed.segments.indexOf(segment)+1)} onClick={()=>{onActive(segment.id);onTranslate(segment);}}>{ui("译")}</button>}
                {eligible&&translation&&<div ref={el=>{if(el)inserts.current.set(segment.id,el);else inserts.current.delete(segment.id);}} className={`inline-insertion ${activeSegment===segment.id?'is-active':''}`} data-translation={segment.id} style={{top:b.target[3]-b.target[1]}}>
                    <div className="inline-insertion__label"><span>{ui("译文")}</span><button className="btn" disabled={translation.state==='loading'} onClick={()=>onTranslate(segment)}>{ui("重译")}</button><button className="btn" disabled={!translation.text||translation.state==='loading'} onClick={()=>onSave(segment)}>{ui("存为摘录")}</button></div>
                    <p className="translation-body">{translation.text|| (translation.state==='failed'?ui("翻译未完成"):ui("正在翻译…"))}</p>{translation.error&&<p className="reader__error">{ui(translation.error)}</p>}{translation.warning&&<p className="reader__error">{ui("草稿 ·")}{ui(translation.warning)}</p>}
                </div>}
            </div>;
        })}
        <AnnotationLayer page={parsed.page} pageNumber={pageNumber} scale={scale} annotations={annotations} selectionAnchors={props.selectionAnchors} mapRect={mappedRect} mapPoint={p=>geometry?.fromSourcePoint(p)??p} displayHeight={plan.height} onOpen={props.onNoteOpen}/>
        <div className="pdf-search-highlights" aria-hidden="true">{searchRects?.flatMap((r,i)=>mappedRect(r).map((m,j)=><span key={`${i}-${j}`} style={styleRect(m)}/ >))}</div>
        {links.flatMap((link,i)=>mappedRect(link.rect).map((r,j)=><a key={`${i}-${j}`} className="pdf-link" style={styleRect(r)} href={link.url&&/^https?:/.test(link.url)?link.url:undefined} target="_blank" rel="noreferrer" aria-label={link.url??ui("PDF 内部链接")} onClick={e=>{if(!link.url){e.preventDefault();void(async()=>{const dest=typeof link.dest==='string'?await doc.getDestination(link.dest):link.dest;if(Array.isArray(dest)){const idx=typeof dest[0]==='number'?dest[0]:await doc.getPageIndex(dest[0]);document.querySelector(`[data-page="${idx+1}"]`)?.scrollIntoView({block:'start'});}})();}}}/>))}

    </div>;
}
