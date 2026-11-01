import { ui } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import type { SearchHit, SearchResponse } from '@shared/m4'
import SearchResults from './SearchResults'
export default function DocumentFind({version,onClose,onHit}:{version:string;onClose:()=>void;onHit:(hit:SearchHit)=>void}):React.ReactElement {
 const [query,setQuery]=useState(''),[result,setResult]=useState<SearchResponse|null>(null),[status,setStatus]=useState(''),[busy,setBusy]=useState(false)
 const input=useRef<HTMLInputElement>(null),run=useRef(0)
 useEffect(()=>{input.current?.focus();return()=>{run.current++}},[])
 useEffect(()=>{
  const request=++run.current
  setResult(null);setStatus(query.trim()?ui("正在查找…"):'');setBusy(!!query.trim())
  if(!query.trim())return
  const timer=setTimeout(()=>{void window.jian.m4.search({query,scope:'all',documentVersionId:version}).then(r=>{
   if(request!==run.current)return
   setBusy(false)
   if(r.ok){setResult(r.data);setStatus(r.data.groups.length?'':ui("当前已索引页面没有命中；索引完成后可重试。"))}else setStatus(r.error.message)
  }).catch(()=>{if(request===run.current){setBusy(false);setStatus(ui("查找暂时失败，请重试。"))}})},180)
  return()=>{run.current++;clearTimeout(timer)}
 },[query,version])
 async function more():Promise<void>{
  if(result?.nextCursor==null||busy)return
  const request=run.current;setBusy(true)
  try{const r=await window.jian.m4.search({query,scope:'all',documentVersionId:version,cursor:result.nextCursor});if(request!==run.current)return
   if(r.ok)setResult(old=>{const groups=new Map((old?.groups??[]).map(g=>[g.itemId,{...g,hits:[...g.hits]}]));for(const g of r.data.groups){const prior=groups.get(g.itemId);if(prior)prior.hits.push(...g.hits.filter(h=>!prior.hits.some(p=>p.id===h.id)));else groups.set(g.itemId,g)}return {...r.data,groups:[...groups.values()]}});else setStatus(r.error.message)
  }finally{if(request===run.current)setBusy(false)}
 }
 return <section className="reader-find" aria-label={ui("本文查找")} aria-busy={busy}><div className="reader-find__input"><input ref={input} aria-label={ui("查找本文")} type="search" value={query} placeholder={ui("查找本文 · ⌘F")} onChange={e=>{run.current++;setResult(null);setQuery(e.target.value)}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose()}}}/><button className="btn" onClick={onClose}>{ui("关闭查找")}</button></div><p className="m3-muted" role="status">{ui(status)}</p><SearchResults groups={result?.groups??[]} onHit={onHit}/>{result?.nextCursor!=null&&<button className="btn" disabled={busy} onClick={()=>void more()}>{busy?ui("正在查找…"):ui("继续查找")}</button>}</section>
}
