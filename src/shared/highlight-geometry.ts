import type {Rect} from './m3'
/** Visual union only. Stored anchors stay exact; column gaps and different baselines remain separate. */
export function mergeHighlightRects(rects:Rect[]):Rect[]{
 const rows:Rect[][]=[]
 for(const r of rects.filter(r=>r.every(Number.isFinite)&&r[2]>r[0]&&r[3]>r[1]).sort((a,b)=>b[3]-a[3]||a[0]-b[0])){
  const h=r[3]-r[1],row=rows.find(row=>{const a=row[0],ah=a[3]-a[1];return Math.abs((a[1]+a[3]-r[1]-r[3])/2)<=Math.min(h,ah)*.3&&Math.max(h,ah)/Math.min(h,ah)<1.6});if(row)row.push([...r]);else rows.push([[...r]])
 }
 return rows.flatMap(row=>{const result:Rect[]=[];for(const r of row.sort((a,b)=>a[0]-b[0])){const prev=result.at(-1),gap=prev?r[0]-prev[2]:Infinity;if(prev&&gap<=Math.min(prev[3]-prev[1],r[3]-r[1])*.45){prev[0]=Math.min(prev[0],r[0]);prev[1]=Math.min(prev[1],r[1]);prev[2]=Math.max(prev[2],r[2]);prev[3]=Math.max(prev[3],r[3])}else result.push([...r])}return result})
}
