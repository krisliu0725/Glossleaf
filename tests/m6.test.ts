import test from 'node:test';
import assert from 'node:assert/strict';
import { bandGeometry, pixelBands, planInlinePage, rasterBudget, type LayoutSegment } from '../src/renderer/src/reader/inline/geometry';
const parts: LayoutSegment[] = [
    {segment:{id:'a',pageIndex:0,text:'First paragraph.',rects:[[40,600,550,640]],kind:'body',confidence:.95},bounds:[40,100,550,140]},
    {segment:{id:'b',pageIndex:0,text:'Second paragraph.',rects:[[40,400,550,460]],kind:'body',confidence:.95},bounds:[40,280,550,340]},
    {segment:{id:'c',pageIndex:0,text:'Footer',rects:[[40,20,550,40]],kind:'margin',confidence:.95},bounds:[40,760,550,780]}
];
test('M6 source bands partition the entire page without clipping any margin or source gap',()=>{
    const p=planInlinePage(612,792,0,parts,{a:250,b:480});assert.equal(p.ok,true);if(!p.ok)return;
    assert.equal(p.bands[0].source[1],0);assert.equal(p.bands.at(-1)!.source[3],792);
    assert.equal(p.bands.reduce((n,b)=>n+(b.source[2]-b.source[0])*(b.source[3]-b.source[1]),0),612*792);
    p.bands.slice(1).forEach((b,i)=>assert.equal(p.bands[i].source[3],b.source[1]));
    assert.equal(p.height,792+250+480);
    assert.equal(new Set(p.bands.map(b=>b.id)).size,p.bands.length);
});
test('M6 point transforms are reversible by band; insertion points never become false PDF coordinates',()=>{
    const p=planInlinePage(612,792,0,parts,{a:120,b:300});if(!p.ok)throw Error(p.reason);const g=bandGeometry(p.bands);
    for(const b of p.bands)for(const x of [0,50,611])for(const y of [b.source[1]+.001,(b.source[1]+b.source[3])/2,b.source[3]-.001]){
        const mapped=g.fromSourcePoint([x,y]);assert.ok(mapped);const inverse=g.toSourcePoint(mapped,b.id);assert.ok(inverse);assert.ok(Math.abs(inverse[0]-x)<1e-9&&Math.abs(inverse[1]-y)<1e-9);
    }
    assert.equal(g.toSourcePoint([50,p.bands[0].target[3]+50]),null);
    assert.equal(g.toSourcePoint([50,p.bands[1].target[1]+10],p.bands[0].id),null);
    assert.equal(g.fromSourcePoint([-1,200]),null);
});
test('M6 links, highlights and search rectangles split across bands with no translation-space anchors',()=>{
    const p=planInlinePage(612,792,0,parts,{a:120,b:300});if(!p.ok)throw Error(p.reason);const g=bandGeometry(p.bands),source:[number,number,number,number]=[30,200,550,570];
    const mapped=g.fromSourceRect(source);assert.equal(mapped.length,3);
    const inverses=mapped.flatMap(r=>g.toSourceRect(r));
    assert.equal(inverses.reduce((n,r)=>n+(r[2]-r[0])*(r[3]-r[1]),0),(source[2]-source[0])*(source[3]-source[1]));
    assert.deepEqual(g.toSourceRect([0,211,100,320]),[]);
});
test('M6 zero-translation source-pixel slicing and recomposition is byte-exact at varied DPR and zoom',()=>{
    for(const scale of [.8,1,1.2,2])for(const dpr of [1,1.25,2,3]){
        const w=612*scale,h=792*scale,p=planInlinePage(w,h,0,parts.map(l=>({...l,bounds:l.bounds.map(n=>n*scale) as [number,number,number,number]})));if(!p.ok)throw Error(p.reason);
        const budget=rasterBudget(w,h,dpr),cuts=pixelBands(p.bands,budget.height,h);
        const source=Uint32Array.from({length:budget.width*budget.height},(_,i)=>(i*2654435761)>>>0),output=new Uint32Array(source.length);
        for(const cut of cuts)output.set(source.subarray(cut.start*budget.width,cut.end*budget.width),cut.start*budget.width);
        assert.deepEqual(output,source);assert.ok(budget.bytes<=48*1024*1024);
    }
});
test('M6 conservatively rejects rotated, sparse, overlapping, graphics and uncertain column pages',()=>{
    for(const rotation of [90,180,270])assert.equal(planInlinePage(612,792,rotation,parts).ok,false);
    assert.equal(planInlinePage(612,792,0,[]).ok,false);
    assert.equal(planInlinePage(612,792,0,parts,{},true).ok,false);
    assert.equal(planInlinePage(612,792,0,parts,{},false,true).ok,false);
    assert.equal(planInlinePage(612,792,0,parts.map(p=>({...p,segment:{...p.segment,confidence:.75}}))).ok,false);
    assert.equal(planInlinePage(612,792,0,[parts[0],{...parts[1],bounds:[330,110,550,150]}]).ok,false);
    assert.equal(planInlinePage(612,792,0,[{...parts[0],bounds:[-20,100,550,140]}]).ok,false);
});
test('M6 translation height never changes source bands or raster budget, and source anchor tracks its band',()=>{
    const small=planInlinePage(612,792,0,parts,{a:100}),long=planInlinePage(612,792,0,parts,{a:10000});if(!small.ok||!long.ok)throw Error('expected plans');
    assert.deepEqual(small.bands.map(b=>b.source),long.bands.map(b=>b.source));
    const point:[number,number]=[80,300],a=bandGeometry(small.bands).fromSourcePoint(point)!,b=bandGeometry(long.bands).fromSourcePoint(point)!;
    assert.equal(b[1]-a[1],9900);
    assert.deepEqual(rasterBudget(small.width,small.sourceHeight,2),rasterBudget(long.width,long.sourceHeight,2));
    const huge=rasterBudget(18000,25000,3);assert.ok(huge.bytes<=48*1024*1024);assert.ok(huge.ratio<1);
});
