import {useEffect,useRef,useState} from 'react'
import type {PDFDocumentProxy} from 'pdfjs-dist'
/** Only rasterize a thumbnail when it approaches its scroll viewport. */
export default function PageThumbnail({doc,page,width=84}:{doc:PDFDocumentProxy;page:number;width?:number}){
 const host=useRef<HTMLSpanElement>(null),canvas=useRef<HTMLCanvasElement>(null),[visible,setVisible]=useState(false)
 useEffect(()=>{const io=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting),{rootMargin:'140px'});if(host.current)io.observe(host.current);return()=>io.disconnect()},[])
 useEffect(()=>{if(!visible)return;let dead=false,task:{cancel:()=>void}|undefined;const c=canvas.current;void doc.getPage(page).then(p=>{if(dead||!c)return;const base=p.getViewport({scale:1}),vp=p.getViewport({scale:width/base.width}),dpr=Math.min(devicePixelRatio,2);c.width=Math.ceil(vp.width*dpr);c.height=Math.ceil(vp.height*dpr);const context=c.getContext('2d');if(!context)return;const render=p.render({canvasContext:context,canvas:c,viewport:vp,transform:[dpr,0,0,dpr,0,0]});task=render;return render.promise}).catch(()=>undefined);return()=>{dead=true;task?.cancel()}},[doc,page,width,visible])
 return <span className="page-thumbnail" ref={host} style={{width}} aria-hidden="true"><canvas ref={canvas} style={{width}}/></span>
}
