import type { PDFPageProxy } from 'pdfjs-dist';
import type { PdfAnchor, Rect } from '@shared/m3';
import type { PageGeometry } from './geometry';
export interface PageElement extends HTMLElement { pdfPage?: PDFPageProxy; pdfGeometry?: PageGeometry }
/** Source and inline pages share one selection collector, including selections crossing a fallback page. */
export function collectSourceSelection(pane: Element, range: Range, documentVersionId: string, scale: number): PdfAnchor[] {
    const anchors: PdfAnchor[] = [];
    pane.querySelectorAll<PageElement>('.pdf-page-host').forEach(el => {
        const pdf = el.pdfPage; if (!pdf) return;
        let prefix='',suffix='',orderKey=0;
        const view = pdf.getViewport({ scale,rotation:pdf.rotate+Number(el.dataset.rotation??0) }), box = el.getBoundingClientRect(), rects: Rect[] = [], exact: string[] = [];
        el.querySelectorAll<HTMLElement>('.textLayer').forEach(layer => {
            if (!range.intersectsNode(layer)) return;
            const clipped = range.cloneRange(), contents = document.createRange(); contents.selectNodeContents(layer);
            if (clipped.compareBoundaryPoints(Range.START_TO_START, contents) < 0) clipped.setStart(contents.startContainer, contents.startOffset);
            if (clipped.compareBoundaryPoints(Range.END_TO_END, contents) > 0) clipped.setEnd(contents.endContainer, contents.endOffset);
            if (clipped.collapsed) return;
            const text = clipped.toString(); if (text) exact.push(text);
            const before=contents.cloneRange(),after=contents.cloneRange();before.setEnd(clipped.startContainer,clipped.startOffset);after.setStart(clipped.endContainer,clipped.endOffset);if(!prefix)prefix=before.toString().slice(-120);suffix=after.toString().slice(0,120);
            const walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT),selectedRects:DOMRect[]=[];let node:Node|null;
            while((node=walker.nextNode())){if(!range.intersectsNode(node)||!node.textContent?.length)continue;const piece=document.createRange();piece.selectNodeContents(node);if(node===clipped.startContainer)piece.setStart(node,clipped.startOffset);if(node===clipped.endContainer)piece.setEnd(node,clipped.endOffset);if(!piece.collapsed)selectedRects.push(...piece.getClientRects())}
            for (const r of selectedRects) {
                if (r.width < 1 || r.height < 1) continue;
                const local: Rect = [Math.max(0, r.left - box.left), Math.max(0, r.top - box.top), Math.min(box.width, r.right - box.left), Math.min(box.height, r.bottom - box.top)];
                const sources = el.pdfGeometry ? el.pdfGeometry.toSourceRect(local) : [local];
                for (const s of sources) {
                    if (s[2] <= s[0] || s[3] <= s[1]) continue;
                    const a = view.convertToPdfPoint(s[0], s[1]), z = view.convertToPdfPoint(s[2], s[3]);
                    rects.push([Math.min(a[0], z[0]), Math.min(a[1], z[1]), Math.max(a[0], z[0]), Math.max(a[1], z[1])]);
                }
            }
        });
        if (rects.length){orderKey=-rects[0][3];anchors.push({ documentVersionId, pageIndex: Number(el.dataset.page) - 1, exact: exact.join('\n'), rects,kind:'text',prefix,suffix,orderKey })}
    });
    return anchors;
}
export interface StableSourceAnchor { element: PageElement; sourcePoint: [number, number]; viewportOffset: number }
export function captureSourceAnchor(pane: HTMLElement): StableSourceAnchor | null {
    const top = pane.getBoundingClientRect().top + 50;
    const pages = [...pane.querySelectorAll<PageElement>('.pdf-page-host')];
    const page = pages.find(el => el.getBoundingClientRect().bottom > top);
    if (!page) return null;
    const r = page.getBoundingClientRect(), y = Math.max(0, top - r.top), geometry = page.pdfGeometry;
    let sourcePoint = geometry ? geometry.toSourcePoint([1, y]) : [1, y] as [number, number];
    let displayY = y;
    // If the viewport is inside an insertion, keep the next source position at its actual offset.
    if (!sourcePoint && geometry) {
        const candidates = [...page.querySelectorAll<HTMLElement>('[data-source-band]')].map(el => ({el, rect: el.getBoundingClientRect()}));
        const next = candidates.find(c => c.rect.top >= top);
        if (next) { displayY = next.rect.top - r.top + .1; sourcePoint = geometry.toSourcePoint([1, displayY]); }
    }
    return sourcePoint ? { element: page, sourcePoint, viewportOffset: r.top + displayY - pane.getBoundingClientRect().top } : null;
}
export function restoreSourceAnchor(pane: HTMLElement, anchor: StableSourceAnchor): void {
    if (!anchor.element.isConnected) return;
    const mapped = anchor.element.pdfGeometry?.fromSourcePoint(anchor.sourcePoint) ?? anchor.sourcePoint;
    const delta = anchor.element.getBoundingClientRect().top + mapped[1] - pane.getBoundingClientRect().top - anchor.viewportOffset;
    if (Math.abs(delta) > .1) pane.scrollTop += delta;
}
