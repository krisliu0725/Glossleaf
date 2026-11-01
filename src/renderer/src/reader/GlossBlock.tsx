import type {GlossaryEntry,Segment} from '@shared/m3'
import {ui} from '../i18n'
import Mark from '../design/Mark'
export interface GlossState {state:string;text:string;error?:string;result?:{warning?:string;status:string}}
function Terms({text,terms}:{text:string;terms:GlossaryEntry[]}):React.ReactElement{
 const choices=terms.filter(t=>t.target&&text.includes(t.target)).sort((a,b)=>b.target.length-a.target.length)
 if(!choices.length)return <>{text}</>
 const escaped=choices.map(t=>t.target.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&'))
 const parts=text.split(new RegExp('('+escaped.join('|')+')','g'))
 return <>{parts.map((p,i)=>{const term=choices.find(t=>t.target===p);return term?<abbr key={i} title={term.source+' → '+term.target} className="gloss-term">{p}</abbr>:p})}</>
}
export default function GlossBlock({segment:s,state:b,active,edited,terms,onNavigate,onTranslate,onCopy,onSave,onEdit,onContext}:{segment:Segment;state?:GlossState;active:boolean;edited?:string;terms:GlossaryEntry[];onNavigate:()=>void;onTranslate:()=>void;onCopy:()=>void;onSave:()=>void;onEdit:()=>void;onContext:(e:React.MouseEvent)=>void}):React.ReactElement{
 const text=edited??b?.text,loading=b?.state==='loading',failed=b?.state==='failed'
 const content=<>
  {text?<p className="translation-body" onMouseUp={e=>{e.stopPropagation()}}><Terms text={text} terms={terms}/></p>:loading?<div className="gloss-skeleton" role="status" aria-label={ui("正在翻译…")}><i/><i/></div>:failed?<p className="gloss-failure">⚠ {ui("未能翻译")} · <button onClick={e=>{e.stopPropagation();onTranslate()}}>{ui("重试")}</button></p>:<div className="gloss-placeholder"><span/><button className="provider-text-button" onClick={e=>{e.stopPropagation();onTranslate()}}>{ui("翻译此段")}</button></div>}
  {b?.error&&<small className="gloss-error" role="status">{ui(b.error)}</small>}
  {b?.result?.warning&&<small className="gloss-error">⚠ {ui(b.result.warning)}</small>}
  {!!text&&!loading&&<div className="gloss-actions">
   <button className="icon-button" title={ui("复制")} aria-label={ui("复制")} onClick={e=>{e.stopPropagation();onCopy()}}><Mark name="copy" size={16}/></button>
   <button className="icon-button" title={ui("重译")} aria-label={ui("重译")} onClick={e=>{e.stopPropagation();onTranslate()}}><Mark name="refresh" size={16}/></button>
   <button className="icon-button" title={ui("保存为撷英")} aria-label={ui("保存为撷英")} onClick={e=>{e.stopPropagation();onSave()}}><Mark name="excerpts" size={16}/></button>
  </div>}
  {edited!==undefined&&<button className="gloss-edited" title={ui("已修改译文 · 点击编辑或恢复")} aria-label={ui("已修改译文 · 点击编辑或恢复")} onClick={e=>{e.stopPropagation();onEdit()}}/>}
 </>
 return <article className={'translation-block gloss-block kind-'+s.kind+(active?' is-active':'')} data-translation={s.id} onClick={()=>{if(window.getSelection()?.isCollapsed)onNavigate()}} onContextMenu={onContext} tabIndex={0} aria-label={ui("第 {0} 页译文",s.pageIndex+1)} onKeyDown={e=>{if(e.target===e.currentTarget&&e.key==='Enter')onNavigate()}}>
  {s.kind==='footnote'?<details><summary>{ui("脚注")}</summary>{content}</details>:content}
 </article>
}
