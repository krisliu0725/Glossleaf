import { useEffect, useRef } from 'react'
/** Foreground, recently active reading is a measured proxy, never inferred comprehension. */
export default function useReadingActivity(documentVersionId:string,pageNumber:number):void {
 const page=useRef(pageNumber),lastActivity=useRef(Date.now())
 page.current=pageNumber
 useEffect(()=>{
  let dead=false
  const activity=():void=>{lastActivity.current=Date.now()}
  const send=(forceInactive=false):void=>{
   if(dead)return
   const visible=document.visibilityState==='visible'&&document.hasFocus()&&!document.querySelector('[role="dialog"][aria-modal="true"]')
   void window.jian.analytics.heartbeat({documentVersionId,pageIndex:Math.max(0,page.current-1),visible,active:!forceInactive&&visible&&Date.now()-lastActivity.current<60000}).catch(()=>undefined)
  }
  const blur=():void=>send(true)
  const focus=():void=>{activity();send()}
  const visibility=():void=>{if(document.visibilityState==='visible')focus();else blur()}
  for(const name of ['pointerdown','keydown','wheel','touchstart','pointermove'])window.addEventListener(name,activity,{passive:true})
  window.addEventListener('focus',focus);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility)
  const timer=setInterval(()=>send(),5000);send()
  return ()=>{send(true);dead=true;clearInterval(timer);for(const name of ['pointerdown','keydown','wheel','touchstart','pointermove'])window.removeEventListener(name,activity);window.removeEventListener('focus',focus);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility)}
 },[documentVersionId])
 useEffect(()=>{void window.jian.analytics.heartbeat({documentVersionId,pageIndex:Math.max(0,pageNumber-1),visible:document.visibilityState==='visible'&&document.hasFocus(),active:document.hasFocus()&&!document.querySelector('[role="dialog"][aria-modal="true"]')&&Date.now()-lastActivity.current<60000}).catch(()=>undefined)},[documentVersionId,pageNumber])
}
