import type { Rect, Segment } from '@shared/m3';
export interface SourceBand { id: string; source: Rect; target: Rect; segmentId: string; translationHeight: number }
export type InlinePlan = { ok: true; bands: SourceBand[]; width: number; sourceHeight: number; height: number } | { ok: false; reason: string };
export interface LayoutSegment { segment: Segment; bounds: Rect }
export interface PageGeometry {
    toSourcePoint(point: [number, number], bandId?: string): [number, number] | null;
    fromSourcePoint(point: [number, number]): [number, number] | null;
    fromSourceRect(rect: Rect): Rect[];
    toSourceRect(rect: Rect): Rect[];
}
const finite = (r: Rect): boolean => r.every(Number.isFinite) && r[2] > r[0] && r[3] > r[1];
/** The partition includes margins and every source pixel. Insertions never replace source areas. */
export function planInlinePage(width: number, height: number, rotation: number, segments: LayoutSegment[], heights: Record<string, number> = {}, graphics = false, rotatedText = false): InlinePlan {
    if (rotation % 360 !== 0) return { ok: false, reason: '旋转页面保留原版；行间原型仅支持未旋转的单栏页面。' };
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { ok: false, reason: '页面尺寸无效，已保留原版。' };
    if (graphics) return { ok: false, reason: '此页包含图片或矢量图形，保留原版以避免拆开图表。' };
    if (rotatedText) return { ok: false, reason: '此页存在斜排或旋转文字，已保留原版。' };
    if (!segments.length || segments.every(s => s.segment.kind === 'margin')) return { ok: false, reason: '没有足够可靠的可提取正文，已保留原版。' };
    if (segments.some(s => s.segment.confidence < .88 || !finite(s.bounds))) return { ok: false, reason: '栏位或段落置信度不足，已保留原版；仍可使用双语视图。' };
    const sorted = [...segments].sort((a, b) => a.bounds[1] - b.bounds[1]);
    for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i].bounds;
        if (r[0] < -.5 || r[1] < -.5 || r[2] > width + .5 || r[3] > height + .5) return { ok: false, reason: '文字超出源页边界，已保留原版。' };
        if (i && r[1] - sorted[i - 1].bounds[3] < 2) return { ok: false, reason: '段落区域重叠或间距不足，已保留原版以避免裁掉文字。' };
    }
    const cuts = [0, ...sorted.slice(1).map((s, i) => (sorted[i].bounds[3] + s.bounds[1]) / 2), height];
    let targetY = 0;
    const bands = sorted.map(({segment}, i): SourceBand => {
        const h = cuts[i + 1] - cuts[i], translationHeight = Math.max(0, Math.min(100000, Number.isFinite(heights[segment.id]) ? heights[segment.id] : 0));
        const band: SourceBand = { id: `band:${segment.id}`, source: [0, cuts[i], width, cuts[i + 1]], target: [0, targetY, width, targetY + h], segmentId: segment.id, translationHeight };
        targetY += h + translationHeight;
        return band;
    });
    return { ok: true, bands, width, sourceHeight: height, height: targetY };
}
function intersect(a: Rect, b: Rect): Rect | null {
    const r: Rect = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
    return finite(r) ? r : null;
}
export function bandGeometry(bands: SourceBand[]): PageGeometry {
    const find = (point: [number, number], key: 'source' | 'target', id?: string): SourceBand | undefined => bands.find((b, i) => (!id || b.id === id) && point[0] >= b[key][0] && point[0] <= b[key][2] && point[1] >= b[key][1] && (point[1] < b[key][3] || (i === bands.length - 1 && point[1] === b[key][3])));
    const point = (p: [number, number], from: 'source' | 'target', id?: string): [number, number] | null => {
        const b = find(p, from, id); if (!b) return null;
        const to = from === 'source' ? 'target' : 'source';
        return [p[0] + b[to][0] - b[from][0], p[1] + b[to][1] - b[from][1]];
    };
    const rect = (r: Rect, from: 'source' | 'target'): Rect[] => bands.flatMap(b => {
        const clipped = intersect(r, b[from]); if (!clipped) return [];
        const to = from === 'source' ? 'target' : 'source', dx = b[to][0] - b[from][0], dy = b[to][1] - b[from][1];
        return [[clipped[0] + dx, clipped[1] + dy, clipped[2] + dx, clipped[3] + dy] as Rect];
    });
    return { toSourcePoint: (p, id) => point(p, 'target', id), fromSourcePoint: p => point(p, 'source'), fromSourceRect: r => rect(r, 'source'), toSourceRect: r => rect(r, 'target') };
}
/** One source buffer plus all copied tiles. Dynamic translations do not allocate raster pixels. */
export function rasterBudget(width: number, height: number, devicePixelRatio: number, byteLimit = 48 * 1024 * 1024): { ratio: number; width: number; height: number; bytes: number } {
    const ratio = Math.min(Math.max(.01, devicePixelRatio), 2, Math.sqrt(byteLimit / (8 * width * height)));
    const w = Math.max(1, Math.floor(width * ratio)), h = Math.max(1, Math.floor(height * ratio));
    return { ratio, width: w, height: h, bytes: w * h * 8 };
}
export function pixelBands(bands: SourceBand[], pixelHeight: number, sourceHeight: number): Array<{start: number; end: number}> {
    return bands.map((b, i) => ({ start: i === 0 ? 0 : Math.round(b.source[1] / sourceHeight * pixelHeight), end: i === bands.length - 1 ? pixelHeight : Math.round(b.source[3] / sourceHeight * pixelHeight) }));
}
