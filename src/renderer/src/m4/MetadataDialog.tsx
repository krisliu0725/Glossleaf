import { ui } from '../i18n'
import { useEffect, useState } from 'react'
import type { ItemDetail } from '@shared/domain'
import type { DoiPreview, MetadataDraft, MetadataCandidate } from '@shared/m4'
import Dialog from '../reader/Dialog'
import MetadataLookup from './MetadataLookup'
import ReferenceSearch from './ReferenceSearch'
const types=[['journalArticle',"期刊文章"],['book',"图书"],['bookSection',"图书章节"],['conferencePaper',"会议论文"],['thesis',"学位论文"],['report',"报告"],['webpage',"网页"],['preprint',"预印本"],['dataset',"数据集"],['other',"其他"]]
const blank:MetadataDraft={title:'',type:'journalArticle',date:null,language:null,fields:{},creators:[]}
export default function MetadataDialog({item,onClose,onSaved,onExisting}:{item?:ItemDetail;onClose:()=>void;onSaved:(id:string,message?:string)=>void;onExisting?:(id:string)=>void}):React.ReactElement {
 const [autoDownload,setAutoDownload]=useState(true),[downloadId,setDownloadId]=useState<string|null>(null),[createdId,setCreatedId]=useState<string|null>(null)
 const [draft,setDraft]=useState<MetadataDraft>(item?{title:item.title,type:item.type,date:item.date,language:item.language,fields:item.fields,creators:item.creatorsList}:blank),[preview,setPreview]=useState<DoiPreview|null>(null),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[ready,setReady]=useState(!!item),[allowDuplicate,setAllowDuplicate]=useState(false)
 useEffect(()=>()=>{void window.jian.m4.doiCancel()},[])
 const change=(patch:Partial<MetadataDraft>):void=>setDraft(d=>({...d,...patch}))
 const field=(key:string,value:string):void=>setDraft(d=>({...d,fields:{...d.fields,[key]:value}}))
 async function choose(candidate:MetadataCandidate):Promise<void>{setDraft(candidate.draft);setReady(true);setMessage(ui('请核对并补全元数据后入库。'));setAllowDuplicate(false);setPreview({doi:candidate.doi,draft:candidate.draft,duplicates:candidate.duplicates??[],source:candidate.source})}
 async function save():Promise<void>{if(busy)return;setBusy(true);setSaving(true);try{
  const r=item?await window.jian.m4.metadataSave(item.id,draft):createdId?{ok:true as const,data:createdId}:await window.jian.m4.doiCommit(draft,allowDuplicate)
  if(!r.ok){setMessage(r.error.message);return}
  const id=item?.id??String(r.data);if(!item)setCreatedId(id)
  let notice:string|undefined
  if(!item&&autoDownload&&draft.fields.DOI){setDownloadId(id);setMessage(ui('文献已入库，正在获取可下载的全文…'));const downloaded=await window.jian.m4.downloadFullText(id);notice=downloaded.ok?ui(downloaded.data.message):ui('文献已入库，全文暂未下载：{0}',ui(downloaded.error.message));setDownloadId(null)}
  onSaved(id,notice)
 }finally{setBusy(false);setSaving(false)}}
 return <Dialog title={item?ui("编辑文献信息"):ui("查找文献并入库")} onClose={onClose} closeDisabled={saving} footer={<div className="provider-footer-content">{message&&<p role="status" className="provider-status">{ui(message)}</p>}{!!preview?.duplicates.length&&!allowDuplicate&&<p className="m3-muted">{ui("打开已有文献，或勾选保留独立条目后入库。")}</p>}<div className="m3-actions">{downloadId&&<button className="btn" onClick={()=>void window.jian.m4.downloadCancel(downloadId)}>{ui("取消下载")}</button>}<button type="submit" form="metadata-form" className="btn btn--primary" disabled={busy||!ready||!!preview?.duplicates.length&&!allowDuplicate}>{item?ui("保存修改"):ui("确认入库")}</button></div></div>}>
  {item&&<MetadataLookup id={item.id} current={draft} onApply={setDraft}/>}
  {!item&&!ready&&<ReferenceSearch onChoose={choose} onManual={()=>{setDraft(blank);setReady(true);setMessage(ui('手动填写文献信息。'))}}/>}
  {!item&&ready&&<div className="reference-import-options"><label className="provider-consent"><input type="checkbox" checked={autoDownload} disabled={busy} onChange={e=>setAutoDownload(e.target.checked)}/>{ui('入库后自动下载可获取的全文')}</label><p className="m3-muted">{ui('按核对后的 DOI 查找全文。下载到的文件只保存一份；已有本地文件请选择关联。无法下载时保留文献记录。')}</p></div>}

  {preview?.duplicates.length? <div className="doi-duplicates"><p>{ui("文库已有相同 DOI：")}</p>{preview.duplicates.map(d=><button className="btn" key={d.id} onClick={()=>onExisting?.(d.id)}>{d.title} {ui("· 打开已有")}</button>)}<label className="provider-consent"><input type="checkbox" checked={allowDuplicate} onChange={e=>setAllowDuplicate(e.target.checked)}/>{ui("仍保留为独立条目")}</label></div>:null}
  {ready&&<form id="metadata-form" className="m3-form" onSubmit={e=>{e.preventDefault();void save()}}><fieldset disabled={busy} className="provider-fields">
   <label>{ui("题名")}<input required maxLength={2000} value={draft.title} onChange={e=>change({title:e.target.value})}/></label>
   <div className="provider-numbers"><label>{ui("类型")}<select value={draft.type} onChange={e=>change({type:e.target.value})}>{!types.some(([id])=>id===draft.type)&&<option value={draft.type}>{draft.type}</option>}{types.map(([id,label])=><option key={id} value={id}>{ui(label)}</option>)}</select></label><label>{ui("日期")}<input value={draft.date??''} placeholder={ui("2026 或 2026-10-29")} onChange={e=>change({date:e.target.value||null})}/></label></div>
   <label>{ui("语言")}<input value={draft.language??''} placeholder={ui("未知；可填 zh-CN、en 等")} onChange={e=>change({language:e.target.value||null})}/></label>
   <div className="metadata-authors"><span>{ui("作者与其他责任者")}</span>{draft.creators.map((c,index)=><div className="creator-row" key={index}>
    <select aria-label={ui("责任者 {0} 角色", index+1)} value={c.role} onChange={e=>change({creators:draft.creators.map((v,i)=>i===index?{...v,role:e.target.value}:v)})}>{!['author','editor','translator'].includes(c.role)&&<option value={c.role}>{c.role}</option>}<option value="author">{ui("作者")}</option><option value="editor">{ui("编者")}</option><option value="translator">{ui("译者")}</option></select>
    <select aria-label={ui("责任者 {0} 类型", index+1)} value={c.nameMode} onChange={e=>change({creators:draft.creators.map((v,i)=>i===index?{...v,nameMode:e.target.value as 'person'|'literal',literalName:[v.familyName,v.givenName].filter(Boolean).join(' ')||v.literalName}:v)})}><option value="person">{ui("个人")}</option><option value="literal">{ui("机构")}</option></select>
    {c.nameMode==='literal'?<input aria-label={ui("责任者 {0} 机构名", index+1)} placeholder={ui("机构名称")} value={c.literalName??''} onChange={e=>change({creators:draft.creators.map((v,i)=>i===index?{...v,literalName:e.target.value}:v)})}/>:<><input aria-label={ui("责任者 {0} 姓", index+1)} placeholder={ui("姓")} value={c.familyName??''} onChange={e=>change({creators:draft.creators.map((v,i)=>i===index?{...v,familyName:e.target.value}:v)})}/><input aria-label={ui("责任者 {0} 名", index+1)} placeholder={ui("名")} value={c.givenName??''} onChange={e=>change({creators:draft.creators.map((v,i)=>i===index?{...v,givenName:e.target.value}:v)})}/></>}
    <button type="button" className="btn" aria-label={ui("移除责任者 {0}", index+1)} onClick={()=>change({creators:draft.creators.filter((_,i)=>i!==index)})}>×</button>
   </div>)}<button type="button" className="provider-text-button" onClick={()=>change({creators:[...draft.creators,{order:draft.creators.length,role:'author',nameMode:'person',familyName:'',givenName:'',literalName:null}]})}>{ui("添加责任者")}</button></div>
   {[['DOI','DOI'],['publicationTitle',ui("期刊 / 书名 / 会议名称")],['volume',ui("卷")],['issue',ui("期")],['pages',ui("页码")],['publisher',ui("出版社 / 机构")],['ISBN','ISBN'],['ISSN','ISSN'],['thesisType',ui("学位类型（学位论文适用）")],['place',ui("出版地")],['url','URL']].map(([key,label])=><label key={key}>{ui(label)}<input value={draft.fields[key]??''} onChange={e=>field(key,e.target.value)}/></label>)}
   <p className="m3-muted">{ui("未显示的已有字段会保留。语言未知时不根据文字外观推断。")}</p>
  </fieldset></form>}
 </Dialog>
}
