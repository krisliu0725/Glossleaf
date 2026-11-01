import {useState} from 'react'
import {ui} from '../i18n'
import type {MetadataCandidate} from '@shared/m4'
export default function ReferenceSearch({onChoose,onManual}:{onChoose:(candidate:MetadataCandidate)=>Promise<void>;onManual:()=>void}):React.ReactElement{
 const [query,setQuery]=useState(''),[busy,setBusy]=useState(false),[results,setResults]=useState<MetadataCandidate[]>([]),[message,setMessage]=useState('')
 async function find():Promise<void>{if(busy)return;setBusy(true);setMessage('');setResults([]);try{const r=await window.jian.m4.metadataCandidates(query.replace(/\.pdf$/i,'').trim());if(r.ok){if(r.data.length===1&&r.data[0].match==='identifier')await onChoose(r.data[0]);else {setResults(r.data);if(!r.data.length)setMessage(ui('没有找到候选，可修改题名或手动编辑。'))}}else setMessage(r.error.message)}finally{setBusy(false)}}
 return <div className="reference-search"><label>{ui('DOI、题名或文件名')}<input aria-label={ui('DOI、题名或文件名')} maxLength={500} value={query} disabled={busy} placeholder={ui('粘贴 DOI，或输入文章的完整题名')} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(query.trim())void find()}}}/></label><div className="m3-actions"><button className="btn" disabled={busy||!query.trim()} onClick={()=>void find()}>{ui(busy?'正在查找候选…':'查找候选')}</button><button className="provider-text-button" disabled={busy} onClick={onManual}>{ui('手动填写')}</button></div><p className="m3-muted">{ui('仅发送输入的标识或题名查找文献。核对后入库，可自动获取可下载的原文。')}</p>
 {results.length>0&&<div className="metadata-candidates">{results.map(c=><button className="metadata-candidate" key={c.doi} disabled={busy} onClick={()=>{setBusy(true);void onChoose(c).finally(()=>setBusy(false))}}><strong>{c.draft.title}</strong><span>{c.draft.creators.map(p=>p.literalName??[p.familyName,p.givenName].filter(Boolean).join(' ')).join('; ')}</span><small>{c.draft.date} · {c.draft.fields.publicationTitle} · {c.doi}</small><small>{ui('题名相似度 {0}%；请核对作者、年份与刊物',Math.round(c.similarity*100))}</small></button>)}</div>}
 {message&&<p role="status" className="provider-status">{ui(message)}</p>}
 </div>
}
