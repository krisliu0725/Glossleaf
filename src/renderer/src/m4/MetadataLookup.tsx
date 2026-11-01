import {useEffect,useState} from 'react'
import {ui} from '../i18n'
import type {MetadataCandidate,MetadataDraft,MetadataHints} from '@shared/m4'
import {metadataChanges,mergeMetadata,type MetadataChange} from '@shared/metadata-match'
export default function MetadataLookup({id,current,onApply}:{id:string;current:MetadataDraft;onApply:(draft:MetadataDraft)=>void}):React.ReactElement{
 const [query,setQuery]=useState(current.fields.DOI??current.title.slice(0,500)),[hints,setHints]=useState<MetadataHints|null>(null),[candidates,setCandidates]=useState<MetadataCandidate[]>([]),[selected,setSelected]=useState<MetadataCandidate|null>(null),[changes,setChanges]=useState<MetadataChange[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 useEffect(()=>{let dead=false;void window.jian.m4.metadataHints(id).then(r=>{if(!dead&&r.ok){setHints(r.data);if(r.data.dois.length===1)setQuery(r.data.dois[0])}});return()=>{dead=true;void window.jian.m4.doiCancel()}},[id])
 useEffect(()=>{if(selected)setChanges(metadataChanges(current,selected.draft))},[current,selected])
 async function search():Promise<void>{setBusy(true);setMessage('');setSelected(null);setCandidates([]);try{const r=await window.jian.m4.metadataCandidates(query);if(r.ok){setCandidates(r.data);if(!r.data.length)setMessage(ui('没有找到候选，可修改题名或手动编辑。'));else if(r.data.length===1&&r.data[0].match==='identifier')choose(r.data[0])}else setMessage(r.error.message)}finally{setBusy(false)}}
 function choose(c:MetadataCandidate):void{setSelected(c);setChanges(metadataChanges(current,c.draft));setMessage('')}
 function apply():void{if(!selected)return;onApply(mergeMetadata(current,selected.draft,changes.filter(c=>c.use).map(c=>c.key)));setSelected(null);setCandidates([]);setMessage(ui('已填入表单，请核对后保存修改。'))}
 return <details className="metadata-lookup"><summary>{ui('检索与补全文献信息')}</summary><div className="metadata-lookup-body">
 <p className="m3-muted">{ui('先检查本机 PDF 前两页中的 DOI，再检索 Crossref / DataCite。仅发送下方 DOI 或题名，不发送正文或笔记。')}</p>
 {hints&&!hints.indexedPages&&<p className="m3-muted">{ui('未检测到已索引的 PDF 文字；可先用题名或手动输入 DOI 查询。')}</p>}
 {!!hints?.dois.length&&<div className="metadata-hints">{hints.dois.map(doi=><button type="button" className="btn" disabled={busy} key={doi} onClick={()=>setQuery(doi)}>{doi}</button>)}</div>}
 <label>{ui('DOI 或完整题名')}<input aria-label={ui('DOI 或完整题名')} maxLength={500} value={query} disabled={busy} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(query.trim()&&!busy)void search()}}}/></label>
 <button type="button" className="btn" disabled={busy||!query.trim()} onClick={()=>void search()}>{ui(busy?'正在查找候选…':'查找候选')}</button>
 {candidates.length>0&&<div className="metadata-candidates">{candidates.map(c=><button key={c.doi} type="button" className="metadata-candidate" aria-pressed={selected?.doi===c.doi} onClick={()=>choose(c)}><strong>{c.draft.title}</strong><span>{c.draft.creators.map(p=>p.literalName??[p.familyName,p.givenName].filter(Boolean).join(' ')).join('; ')||ui('未记录作者')} · {c.draft.date??ui('未记录日期')}</span><small>{c.draft.fields.publicationTitle} · {c.doi}</small><small>{c.match==='identifier'?ui('DOI 精确匹配'):ui('题名相似度 {0}%；请核对作者、年份与刊物',Math.round(c.similarity*100))}</small></button>)}</div>}
 {selected&&<div className="metadata-review"><p>{ui('仅勾选需要采用的字段。已有信息默认保留，空白字段默认补全。')}</p><div className="m3-actions"><button type="button" className="provider-text-button" onClick={()=>setChanges(c=>c.map(v=>({...v,use:!v.before.trim()})))}>{ui('仅补全空白')}</button><button type="button" className="provider-text-button" onClick={()=>setChanges(c=>c.map(v=>({...v,use:true})))}>{ui('采用全部候选字段')}</button></div>
 {changes.length?changes.map((c,index)=><label className="metadata-change" key={c.key}><input type="checkbox" checked={c.use} onChange={e=>setChanges(rows=>rows.map((v,i)=>i===index?{...v,use:e.target.checked}:v))}/><span><strong>{ui(c.label)}</strong><span className="metadata-before">{c.before||ui('空白')}</span><span>{c.after}</span></span></label>):<p>{ui('候选信息与当前记录相同。')}</p>}
 <p className="m3-muted">{selected.draft.fields.metadataSource} · {ui('题名检索结果需要人工核对，不代表已确认文章身份。')}</p><button type="button" className="btn" disabled={!changes.some(c=>c.use)} onClick={apply}>{ui('填入选中字段')}</button></div>}
 {message&&<p role="status" className="provider-status">{ui(message)}</p>}
 </div></details>
}
