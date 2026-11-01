const motions=new WeakMap<HTMLElement,()=>void>()
/** One cancellable scroll per pane; direct reader input always takes precedence. */
export function cancelScroll(pane:HTMLElement):void{motions.get(pane)?.()}
export function scrollWithin(pane:HTMLElement,element:HTMLElement,fraction=1/3):void{
 cancelScroll(pane)
 const from=pane.scrollTop,to=Math.max(0,from+element.getBoundingClientRect().top-pane.getBoundingClientRect().top-pane.clientHeight*fraction)
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){pane.scrollTop=to;return}
 let frame=0,stopped=false
 const stop=()=>{if(stopped)return;stopped=true;cancelAnimationFrame(frame);for(const name of ['wheel','pointerdown','touchstart','keydown'])pane.removeEventListener(name,stop);if(motions.get(pane)===stop)motions.delete(pane)}
 motions.set(pane,stop);for(const name of ['wheel','pointerdown','touchstart','keydown'])pane.addEventListener(name,stop,{passive:true})
 const start=performance.now()
 const animate=(now:number)=>{if(stopped||!pane.isConnected){stop();return}const t=Math.min(1,(now-start)/160);pane.scrollTop=from+(to-from)*(1-Math.pow(1-t,3));if(t<1)frame=requestAnimationFrame(animate);else stop()}
 frame=requestAnimationFrame(animate)
}
