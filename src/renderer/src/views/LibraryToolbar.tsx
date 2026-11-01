import Brand from '../design/Brand'
import {ui,useStrings} from '../i18n'
import {useRef} from 'react'
import type {IndexStats,SearchScope} from '@shared/m4'
import Dialog from '../reader/Dialog'
import Menu from '../design/Menu'
import HomeActions from '../design/HomeActions'
import Mark from '../design/Mark'
import './library.css'
interface Props{
 query:string;scope:SearchScope;busy:boolean;inputRef:React.RefObject<HTMLInputElement|null>;
 onQuery:(v:string)=>void;onScope:(v:SearchScope)=>void;onComposition:(v:boolean)=>void;
 onImport:()=>void;onZotero:()=>void;onDoi:()=>void;onSettings:()=>void;onDashboard:()=>void;
}
export default function LibraryToolbar(p:Props):React.ReactElement{
 const s=useStrings(),anchor=useRef<HTMLDivElement>(null)
 function clear():void{p.onQuery('');p.inputRef.current?.focus()}
 return <header className="toolbar library-topbar" ref={anchor}>
  <span className="toolbar__title"><Brand/></span>
  <div className="library-search" role="search" aria-label={ui('文库检索')}>
   <Mark name="search" size={17}/>
   <input ref={p.inputRef} aria-label={ui('搜索文库')} className="search" type="search" value={p.query} placeholder={s.lib.search} onChange={e=>p.onQuery(e.target.value)} onCompositionStart={()=>p.onComposition(true)} onCompositionEnd={()=>p.onComposition(false)} onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing&&p.query){e.preventDefault();e.stopPropagation();clear()}}}/>
   {p.query?<button className="library-search__clear" aria-label={ui('清空搜索')} onClick={clear}>×</button>:<kbd className="library-search__shortcut">⌘F</kbd>}
   <div className="search-scope"><Menu label={ui('搜索范围')} text={ui(({all:'全部',metadata:'文献',body:'正文',excerpts:'摘录'} as const)[p.scope])}>{([['all','全部'],['metadata','文献'],['body','正文'],['excerpts','摘录']]as const).map(([id,label])=><button key={id} aria-pressed={p.scope===id} onClick={()=>p.onScope(id)}>{ui(label)}</button>)}</Menu></div>

  </div>
  <HomeActions active="library" onLibrary={()=>undefined} onMemoir={p.onDashboard} busy={p.busy} onImport={kind=>kind==='local'?p.onImport():kind==='zotero'?p.onZotero():p.onDoi()} onSettings={p.onSettings}/>

 </header>
}
export function LibraryIndexDialog({stats,onClose,onAction}:{stats:IndexStats|null;onClose:()=>void;onAction:()=>void}):React.ReactElement {
  return <Dialog title={ui("全文索引")} onClose={onClose} footer={<button className="btn btn--primary" onClick={onAction} disabled={!stats}>{stats?.running ? ui("暂停索引") : ui("更新索引")}</button>}><div className="library-index-dialog">
    <p>{ui("全文检索在本机提取 PDF 文字，不需要模型 API。索引运行时可以继续浏览文库。")}</p>
    {stats ? <><dl><div><dt>{ui("已完成")}</dt><dd>{stats.completed} / {stats.total} {ui("篇")}</dd></div><div><dt>{ui("已提取")}</dt><dd>{stats.pages} {ui("页")}</dd></div><div><dt>{ui("需处理")}</dt><dd>{stats.failed} {ui("篇")}</dd></div></dl><p role="status">{stats.running ? ui("正在建立索引…") : stats.total === 0 ? ui("导入 PDF 后会自动建立索引。") : stats.failed ? ui("部分文档未完成。可更新索引重试。") : ui("索引已就绪。")}</p>{stats.errors.length > 0 && <div className="library-index-errors">{stats.errors.map((e,i) => <p key={`${e.title}-${i}`}><strong>{e.title}</strong><span>{ui(e.error)}</span></p>)}</div>}</> : <p>{ui("正在读取索引状态…")}</p>}
  </div></Dialog>
}
