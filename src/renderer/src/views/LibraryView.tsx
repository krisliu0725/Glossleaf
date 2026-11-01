import {readablePdf} from '@shared/reader-support'
import Mark from '../design/Mark'
import Menu from '../design/Menu'
import {useReaderPreferences} from '../reader/preferences'
import { ui } from '../i18n'
import type { ReaderLocation, SearchGroup, SearchHit, SearchScope, SearchResponse, IndexStats } from '@shared/m4'
import SearchResults from '../m4/SearchResults'
import LibraryToolbar, { LibraryIndexDialog } from './LibraryToolbar'
import MetadataDialog from '../m4/MetadataDialog'
import ExportDialog from '../m4/ExportDialog'
import ImportedNote from '../reader/ImportedNote'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionNode, ItemDetail, ItemSummary, LibraryStats, TagCount } from '@shared/domain'
import ZoteroImportDialog from './ZoteroImportDialog'
import { useStrings } from '../i18n'

interface Props {
  readingTabs?:React.ReactNode;
  initialImport?:import('../design/HomeActions').ImportChoice|null
  onConsumeImport?:()=>void
  initialZotero?:boolean
  onConsumeZotero?:()=>void

  onDashboard:()=>void
  onSettings:()=>void

  onOpenDocument: (documentVersionId: string, title: string, location?: ReaderLocation) => void
  /** 从「志趣」页点话题跳过来时带上的检索词 */
  initialQuery?: string | null
  onConsumeInitialQuery?: () => void
}

export default function LibraryView({ readingTabs,initialImport,onConsumeImport,onOpenDocument, initialQuery, onConsumeInitialQuery,onDashboard,onSettings,initialZotero,onConsumeZotero }: Props): React.ReactElement {
  const s = useStrings(),prefs=useReaderPreferences()
  const [activeTag,setActiveTag]=useState<string|null>(null)
  const [tagsExpanded,setTagsExpanded]=useState(false),[collectionsExpanded,setCollectionsExpanded]=useState(true),[filter,setFilter]=useState<'all'|'unfiled'|'trash'>('all'),[sort,setSort]=useState<'date'|'title'|'author'>('date'),[density,setDensity]=useState<'compact'|'comfortable'>('comfortable'),[abstractExpanded,setAbstractExpanded]=useState(false),[doiCopied,setDoiCopied]=useState(false),[outcome,setOutcome]=useState({excerpts:0,notes:0});const lastChecked=useRef<number|null>(null)
  const [collections, setCollections] = useState<CollectionNode[]>([])
  const [tags, setTags] = useState<TagCount[]>([])
  const [items, setItems] = useState<ItemSummary[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [composing, setComposing] = useState(false)
  const [indexOpen, setIndexOpen] = useState(false)
  const [scope, setScope] = useState<SearchScope>('all')
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [indexStats, setIndexStats] = useState<IndexStats | null>(null)
  const [metadata, setMetadata] = useState<'doi' | 'edit' | null>(null)
  const [exportIds, setExportIds] = useState<string[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [recent, setRecent] = useState(false)
  const [compactDetail, setCompactDetail] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const searchRun = useRef(0)
  const listRun = useRef(0)
  const operation = useRef(false)
  const creatingCollection = useRef(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [searchEpoch, setSearchEpoch] = useState(0)
  const [downloadFor,setDownloadFor]=useState<string|null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [addingCollection, setAddingCollection] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [busy, setBusy] = useState(false)
  const [zoteroOpen, setZoteroOpen] = useState(() => {
    const v = new URLSearchParams(window.location.search).get('zotero')
    return v === '1' || v === 'import' || v === 'report'
  })
  const dragDepth = useRef(0)
  useEffect(()=>{if(initialZotero){setZoteroOpen(true);onConsumeZotero?.()}},[initialZotero,onConsumeZotero])

  useEffect(() => {
    if (composing) return
    const t = setTimeout(() => { setDebounced(query.trim()); setSearchEpoch(n=>n+1) }, 220)
    return () => clearTimeout(t)
  }, [query, composing])

  // 外部带来的检索词（从「志趣」点话题）直接落到搜索框并聚焦
  useEffect(() => {
    if (!initialQuery) return
    setQuery(initialQuery)
    setRecent(false)
    setSelectedCollection(null)
    searchInput.current?.focus()
    onConsumeInitialQuery?.()
  }, [initialQuery, onConsumeInitialQuery])

  // 支持 ?q= 深链，便于从别处直接带词进来，也方便无头截图核对
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) setQuery(q)
  }, [])

  const refreshMeta = useCallback(async () => {
    const [c, t, s] = await Promise.all([
      window.jian.collections.list(),
      window.jian.tags.list(),
      window.jian.library.stats()
    ])
    if (c.ok) setCollections(c.data)
    if (t.ok) setTags(t.data)
    if (s.ok) setStats(s.data)
  }, [])

  const refreshItems = useCallback(async () => {
    const run = ++listRun.current
    const res = await window.jian.library.list({
      collectionId: selectedCollection,
      query: null,
      recent,unfiled:filter==='unfiled',trash:filter==='trash',
      limit: 500
    })
    if (run !== listRun.current) return
    if (res.ok) {
      setItems(res.data.items)
      setTotal(res.data.total)
    } else {
      setStatus(ui("读取文库失败：{0}", ui(res.error.message)))
    }
  }, [selectedCollection, recent,filter])

  useEffect(() => {
    void refreshMeta()
  }, [refreshMeta])

  useEffect(() => {
    void refreshItems()
  }, [refreshItems])

  useEffect(() => {
    const focus = (): void => { if (searchInput.current?.closest('[inert]')) return; if (document.querySelector('[role=dialog][aria-modal=true]')) return; searchInput.current?.focus(); searchInput.current?.select() }
    window.addEventListener('jian:search-focus', focus)
    return () => window.removeEventListener('jian:search-focus', focus)
  }, [])
  useEffect(() => {
    let dead = false
    const poll = async (): Promise<void> => {
      const r = await window.jian.m4.indexStats()
      if (r.ok && !dead) setIndexStats(r.data)
    }
    void poll(); const timer = setInterval(() => void poll(), 1500)
    return () => { dead = true; clearInterval(timer) }
  }, [])
  useEffect(() => {
    const run = ++searchRun.current
    if (composing || !debounced || query.trim()!==debounced) { setSearchResult(null); setSearchBusy(!!query.trim()); return }
    setSearchBusy(true)
    setSearchResult(null)
    void window.jian.m4.search({query: debounced, scope, collectionId: selectedCollection}).then(r => {
      if (run !== searchRun.current) return
      setSearchBusy(false)
      if (r.ok) setSearchResult(r.data); else { setSearchResult(null); setStatus(r.error.message) }
    })
    return () => { searchRun.current++ }
  }, [composing, debounced, searchEpoch, query, scope, selectedCollection, indexStats?.pages, indexStats?.completed])
  async function moreResults(): Promise<void> {
    if (searchBusy || !searchResult || searchResult.nextCursor === null) return
    const run = searchRun.current; setSearchBusy(true)
    const r = await window.jian.m4.search({query: debounced, scope, collectionId:selectedCollection, cursor:searchResult.nextCursor})
    if(run !== searchRun.current) return
    setSearchBusy(false)
    if(!r.ok){setStatus(r.error.message);return}
    setSearchResult(old=>{
      if(!old)return r.data
      const groups=new Map<string,SearchGroup>(old.groups.map(g=>[g.itemId,{...g,hits:[...g.hits]}]))
      for(const g of r.data.groups){const prev=groups.get(g.itemId);if(prev)prev.hits.push(...g.hits.filter(h=>!prev.hits.some(p=>p.id===h.id)));else groups.set(g.itemId,g)}
      return {...r.data,groups:[...groups.values()]}
    })
  }
  function openHit(hit: SearchHit): void {
    setSelectedItem(hit.itemId)
    if (hit.documentVersionId && hit.pageIndex !== null) onOpenDocument(hit.documentVersionId, hit.title, {pageIndex:hit.pageIndex,rects:hit.anchor?.rects,annotationId:hit.annotationId??undefined,query:debounced})
  }
  async function refreshDetail(id: string): Promise<void> {
    setMetadata(null);setActiveTag(null);setSelectedItem(id)
    const r=await window.jian.library.get(id);if(r.ok)setDetail(r.data)
    await Promise.all([refreshMeta(),refreshItems()]);void window.jian.m4.indexStart()
    setQuery('')
  }

  // 列表加载后默认选中第一条，避免右侧长期空白
  useEffect(() => {
    if (query.trim()) return
    if (selectedItem && items.some(item => item.id === selectedItem)) return
    const first = items[0]
    setSelectedItem(first?.id ?? null)
  }, [items, selectedItem, query])

  useEffect(() => {
    if (!selectedItem) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetail(null)
    void window.jian.library.get(selectedItem,filter==='trash').then((res) => {
      if (cancelled) return
      if (res.ok) setDetail(res.data)
      else setStatus(ui("读取详情失败：{0}", ui(res.error.message)))
    })
    return () => {
      cancelled = true
    }
  }, [selectedItem, indexStats?.completed,filter])

  const doImport = useCallback(
    async (files?: string[]) => {
      if (operation.current || document.querySelector('[role=dialog][aria-modal=true]')) return
      operation.current = true
      setBusy(true)
      setStatus(files ? ui("正在导入 {0} 个文件…", files.length) : ui("正在导入…"))
      const res = await window.jian.documents.import(files)
      setBusy(false)
      operation.current = false
      if (!res.ok) {
        setStatus(ui("导入失败：{0}", ui(res.error.message)))
        return
      }
      if (res.data.canceled) {
        setStatus(null)
        return
      }
      const imported = res.data.imported
      const fresh = imported.filter((d) => !d.duplicate).length
      const dup = imported.length - fresh
      setStatus(
        ui("已关联 {0} 个本地文件{1}，未复制原文件", fresh, dup > 0 ? ui("，{0} 个内容重复已跳过", dup) : '')
      )
      await Promise.all([refreshMeta(), refreshItems()]); void window.jian.m4.indexStart()
    },
    [refreshItems, refreshMeta]
  )

  const onCreateCollection = async (): Promise<void> => {
    if (creatingCollection.current) return
    const name = newCollectionName.trim()
    if (!name) {
      setAddingCollection(false)
      return
    }
    creatingCollection.current = true
    const res = await window.jian.collections.create(name)
    creatingCollection.current = false
    if (res.ok) {
      setAddingCollection(false)
      setNewCollectionName('')
      await refreshMeta()
    } else {
      setStatus(ui("创建集合失败：{0}", ui(res.error.message)))
    }
  }

  // 窗口级拖入
  const onDragEnter = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepth.current += 1
    if (!operation.current && !document.querySelector('[role=dialog][aria-modal=true]') && e.dataTransfer.types.includes('Files')) setDragging(true)
  }
  const onDragLeave = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragging(false)
    }
  }
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (operation.current || document.querySelector('[role=dialog][aria-modal=true]')) return
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.jian.files.getPath(f))
      .filter(Boolean)
    if (paths.length > 0) void doImport(paths)
  }

  const selectedCollectionName = useMemo(
    () => collections.find((c) => c.id === selectedCollection)?.name ?? (filter==='trash'?ui('回收站'):filter==='unfiled'?ui('未归入集合'):recent ? s.lib.recent : s.lib.all),
    [collections, selectedCollection, recent,filter, s.lib.recent, s.lib.all]
  )

  useEffect(()=>{let dead=false;setOutcome({excerpts:0,notes:0});setAbstractExpanded(false);if(!detail)return;void Promise.all(detail.documents.filter(d=>d.activeVersionId).map(d=>window.jian.m3.annotations(d.activeVersionId!))).then(results=>{if(dead)return;const rows=results.flatMap(r=>r.ok?r.data:[]);setOutcome({excerpts:rows.filter(a=>a.type==='excerpt'||a.type==='highlight').length,notes:rows.filter(a=>a.type==='note').length})});return()=>{dead=true}},[detail])
  async function openItem(id:string):Promise<void>{const d=detail?.id===id?detail:await window.jian.library.get(id).then(r=>r.ok?r.data:null);const version=d?.documents.find(readablePdf)?.activeVersionId;if(version&&d)onOpenDocument(version,d.title);else if(d?.documents.length)setStatus(ui('此格式可作为附件保存，暂不支持在应用内阅读。'))}
  useEffect(()=>{const key=(e:KeyboardEvent):void=>{if(searchInput.current?.closest('[inert]')||e.defaultPrevented||document.querySelector('[role=dialog][aria-modal=true]')||!(e.metaKey||e.ctrlKey)||(e.target as HTMLElement).closest('input,textarea,select'))return;if(e.key.toLowerCase()==='f'){e.preventDefault();searchInput.current?.focus()}if(e.key.toLowerCase()==='a'){e.preventDefault();setChecked(new Set(items.map(i=>i.id)))}if(e.key.toLowerCase()==='o'&&selectedItem&&filter!=='trash'){e.preventDefault();void openItem(selectedItem)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[items,selectedItem,detail,filter])
  const ordered=useMemo(()=>[...items].sort((a,b)=>sort==='title'?a.title.localeCompare(b.title):sort==='author'?a.creators.localeCompare(b.creators):0),[items,sort])
  function pickRow(id:string,index:number,e:React.MouseEvent):void{setSelectedItem(id);if(e.shiftKey&&lastChecked.current!==null){const low=Math.min(index,lastChecked.current),high=Math.max(index,lastChecked.current);setChecked(v=>new Set([...v,...ordered.slice(low,high+1).map(i=>i.id)]))}else if(e.metaKey||e.ctrlKey)setChecked(v=>{const n=new Set(v);if(n.has(id))n.delete(id);else n.add(id);return n});lastChecked.current=index}
  async function linkFile(versionId?:string):Promise<void>{if(!detail)return;const id=detail.id;setBusy(true);try{const r=versionId?await window.jian.documents.relink(versionId):await window.jian.documents.attachLocal(id);if(r.ok&&!r.data.canceled){await refreshDetail(id);setStatus(ui('已关联原文件，未创建额外副本'))}else if(!r.ok)setStatus(r.error.message)}finally{setBusy(false)}}
  async function fetchFullText():Promise<void>{if(!detail||downloadFor)return;const id=detail.id;setDownloadFor(id);setStatus(ui('正在查找并下载全文…'));try{const r=await window.jian.m4.downloadFullText(id);if(r.ok){setStatus(ui(r.data.message));await refreshDetail(id)}else setStatus(r.error.message)}finally{setDownloadFor(null)}}
  async function trashItem():Promise<void>{if(!detail)return;const r=await window.jian.library.remove(detail.id);if(r.ok){setSelectedItem(null);await Promise.all([refreshItems(),refreshMeta()]);setStatus(ui('已移入回收站，可随时恢复。'))}else setStatus(r.error.message)}
  async function restoreItem():Promise<void>{if(!detail)return;const r=await window.jian.library.restore(detail.id);if(r.ok){setSelectedItem(null);await Promise.all([refreshItems(),refreshMeta()]);setStatus(ui('文献已恢复'))}else setStatus(r.error.message)}
  function chooseFilter(next:'all'|'unfiled'|'trash'):void{setActiveTag(null);setFilter(next);setSelectedCollection(null);setRecent(false);setQuery('');setChecked(new Set())}
  const filteredTags=useMemo(()=>tags.filter(t=>tagsExpanded||t.count>=2||t.name===activeTag).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)),[tags,tagsExpanded,activeTag])
  useEffect(()=>{if(!initialImport)return;onConsumeImport?.();if(initialImport==='local')void doImport();else if(initialImport==='zotero')setZoteroOpen(true);else setMetadata('doi')},[initialImport])
  return (<>
    <LibraryToolbar query={query} scope={scope} busy={busy} inputRef={searchInput} onQuery={value=>{setActiveTag(null);searchRun.current++;setSearchResult(null);setSearchBusy(!!value.trim());if(filter==='trash')chooseFilter('all');setQuery(value)}} onScope={value=>{searchRun.current++;setSearchResult(null);setScope(value)}} onComposition={setComposing} onImport={()=>void doImport()} onZotero={()=>setZoteroOpen(true)} onDoi={()=>setMetadata('doi')} onSettings={onSettings} onDashboard={onDashboard}/>
    {readingTabs&&<div className="library-reading-shelf"><span>{ui('阅读中')}</span>{readingTabs}</div>}
    <div
      className={"workspace redesigned-library density-"+density}
      data-zotero-open={zoteroOpen ? '1' : '0'}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <nav className="sidebar" aria-label={ui("文库导航")}>
        <button
          type="button"
          className="sidebar__row"
          aria-current={selectedCollection === null && !recent&&filter==='all'&&!activeTag}
          onClick={() => chooseFilter('all')}
        >
          <Mark name="library" size={17}/>
          {s.lib.all}
          <span className="sidebar__count">{stats?.items ?? 0}</span>
        </button>
        <button type="button" className="sidebar__row" aria-current={recent&&!activeTag} onClick={() => { setActiveTag(null);setFilter('all');setSelectedCollection(null); setRecent(true) }}>
          <Mark name="recent" size={17}/>
          {s.lib.recent}
        </button>

        <button className="sidebar__row" aria-current={filter==='unfiled'} onClick={()=>chooseFilter('unfiled')}><Mark name="collections" size={16}/>{ui('未归入集合')}</button>
        <div className="sidebar__group-label">
          <button className="sidebar-group-toggle" aria-expanded={collectionsExpanded} onClick={()=>setCollectionsExpanded(v=>!v)}>{s.lib.collections}<Mark name="chevron" size={14} style={{transform:collectionsExpanded?undefined:"rotate(-90deg)"}}/></button>
          <button
            type="button"
            className="sidebar__add"
            aria-label={ui("新建集合")}
            onClick={() => setAddingCollection(true)}
          >
            +
          </button>
        </div>

        {addingCollection && (
          <form className="collection-form" onSubmit={e => { e.preventDefault(); void onCreateCollection() }}>
          <input
            aria-label={ui("集合名称")}
            className="sidebar__input"
            autoFocus
            value={newCollectionName}
            placeholder={ui("集合名称")}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation()
                setAddingCollection(false)
                setNewCollectionName('')
              }
            }}
          />
          <div><button type="submit" className="provider-text-button" disabled={!newCollectionName.trim()}>{ui("创建")}</button><button type="button" className="provider-text-button" onClick={()=>{setAddingCollection(false);setNewCollectionName('')}}>{ui("取消")}</button></div>
          </form>
        )}

        {collectionsExpanded&&collections.map((c) => (
          <button
            key={c.id}
            type="button"
            className="sidebar__row"
            aria-current={selectedCollection === c.id}
            onClick={() => { setActiveTag(null);setFilter('all');setSelectedCollection(c.id); setRecent(false);setQuery('') }}
          >
            <Mark name="collections" size={17}/>
            <span className="sidebar__label">{c.name}</span>
            <span className="sidebar__count">{c.itemCount}</span>
          </button>
        ))}

        {collections.length === 0 && !addingCollection && (
          <p className="sidebar__empty">{ui("还没有集合")}</p>
        )}

        <div className="sidebar__group-label tag-heading"><button className="tag-heading-toggle" aria-expanded={tagsExpanded} onClick={()=>setTagsExpanded(v=>!v)}>{s.lib.tags}<span className="tag-expansion-label">{ui(tagsExpanded?'收起':'展开全部')}</span><Mark name="chevron" size={13}/></button></div>

        {filteredTags.slice(0,tagsExpanded?filteredTags.length:6).map((t) => (
          <button
            key={t.name}
            type="button"
            className="sidebar__row sidebar__row--tag"
            aria-current={activeTag===t.name}
            onClick={() => { setActiveTag(t.name);setFilter('all');setSelectedCollection(null);setRecent(false);searchRun.current++; setSearchResult(null); setQuery(t.name) }}
          >
            <Mark name="tag" size={17}/>
            {t.name}
            <span className="sidebar__count">{t.count}</span>
          </button>
        ))}
        {filteredTags.length===0&&<p className="sidebar__empty">{ui('暂无题签')}</p>}


        <div className="sidebar__footer">
          <button type="button" className="sidebar__row" aria-current={filter==='trash'} onClick={()=>chooseFilter('trash')}><Mark name="trash" size={17}/>{ui('回收站')}</button>

        </div>
      </nav>

      <main className="list-pane">
        <div className="library-controls"><div className="list-pane__header library-header">
          <div className="library-heading"><span className="library-heading__title">{selectedCollectionName}</span><span className="library-heading__count">{ui('{0} 篇',total)}</span></div>
          <div className="library-header__actions">
           {checked.size>0&&<button className="btn btn--small" onClick={()=>setExportIds([...checked])}>{ui('导出')} {checked.size}</button>}
           <button className="btn compact-detail-toggle" disabled={!detail} onClick={()=>setCompactDetail(true)}>{ui('查看详情')}</button>
           <Menu label={ui('列表视图')} text={ui('视图')}><button aria-pressed={density==='compact'} onClick={()=>setDensity('compact')}>{ui('紧凑列表')}</button><button aria-pressed={density==='comfortable'} onClick={()=>setDensity('comfortable')}>{ui('宽松列表')}</button></Menu>
           <Menu label={ui('排序')} text={ui('排序')}>{([['date','日期'],['title','标题'],['author','作者']] as const).map(([id,label])=><button key={id} aria-pressed={sort===id} onClick={()=>setSort(id)}>{ui(label)}</button>)}</Menu>
          </div>
        </div></div>

        {status && (
          <div className="status-bar" role="status">
            <span>{ui(status)}</span>{downloadFor&&<button className="provider-text-button" onClick={()=>void window.jian.m4.downloadCancel(downloadFor)}>{ui("取消下载")}</button>}
            <button type="button" className="status-bar__close" aria-label={ui("关闭提示")} onClick={() => setStatus(null)}>
              ×
            </button>
          </div>
        )}

        {checked.size>0&&<div className="selection-summary" role="status"><span>{ui("已选 {0} 篇文献用于导出",checked.size)}</span><button className="provider-text-button" onClick={()=>setChecked(new Set())}>{ui("清空选择")}</button></div>}
        <div className="list" role="list" aria-label={ui("文献列表")} aria-busy={searchBusy}>
          {debounced ? <><div className="search-summary" role="status">{searchBusy?ui("正在查找…"):ui("已找到 {0} 篇文献", searchResult?.groups.length??0)}{searchResult?.limitedScan?ui("· 短查询按批次查找"):''}{searchResult?.pendingMetadata?ui("· 还有 {0} 条信息待索引", searchResult.pendingMetadata):''}</div><SearchResults groups={searchResult?.groups??[]} onHit={openHit}/>{searchResult?.nextCursor!==null&&searchResult?.nextCursor!==undefined&&<button className="btn search-more" disabled={searchBusy} onClick={()=>void moreResults()}>{ui("继续查找更多结果")}</button>}{!searchBusy&&!searchResult?.groups.length&&<p className="search-summary">{ui("当前批次没有命中。可切换范围，或在索引完成后重试。")}</p>}</> : <>{ordered.map((item,rowIndex) => (
            <div
              key={item.id}
              className={"row"+(checked.size?" is-selecting":"")}
              role="listitem"
              aria-current={selectedItem === item.id ? 'true' : undefined}
              tabIndex={0}
              onClick={e=>pickRow(item.id,rowIndex,e)}
              onDoubleClick={()=>{if(filter!=='trash')void openItem(item.id)}}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelectedItem(item.id) }
              }}
            >
              <input className="row-check" type="checkbox" aria-label={ui("选择导出 {0}", item.title)} checked={checked.has(item.id)} onClick={e=>e.stopPropagation()} onChange={e=>setChecked(v=>{const next=new Set(v);if(e.target.checked)next.add(item.id);else next.delete(item.id);return next})}/>
              <div className="row__title" title={item.title}>{item.title || ui("（无标题）")}</div>
              <div className="row__year">{item.year ?? ''}</div>
              <div className="row__meta">{[item.creators,item.publicationTitle].filter(Boolean).join(' · ') || '—'}</div>
              <div className="row__badges">
                {item.documentCount!==1&&<span>{item.documentCount===0?ui('无附件'):ui('{0} 个附件',item.documentCount)}</span>}
                {prefs.statusDots&&<span className="row-status-dots">{!!item.noteCount&&<i data-kind="notes" title={ui('有札记')}/>} {!!item.annotationCount&&<i data-kind="excerpts" title={ui('有撷英')}/>} {!!item.translatedCount&&<i data-kind="translated" title={ui('已有保存译文')}/>}</span>}
              </div>
            </div>
          ))}

          {items.length === 0 && (
            <div className="empty-state">
              <p className="empty-state__title">
                {debounced ? ui("没有匹配的文献") : filter==='trash'?ui('回收站是空的'):ui('书府还是空的。')}
              </p>
              <p className="empty-state__body">
                {debounced
                  ? ui("换个关键词，或清空搜索框。")
                  : filter==='trash'?ui('移除的文献会保留在这里，可随时恢复。'):ui('拖入 PDF，或从 Zotero 导入。')}
              </p>
              {!debounced && filter!=='trash' && (
                <button type="button" className="btn btn--primary" onClick={() => void doImport()}>
                  {ui("选择文件")}</button>
              )}
            </div>
          )}</>}
        </div>
        {(indexStats?.running||!!indexStats?.failed)&&<button className="library-index-status" aria-label={ui("全文索引状态")} title={ui("查看全文索引状态与管理操作")} data-active={indexStats?.running} data-error={!!indexStats?.failed} onClick={() => setIndexOpen(true)}>
          <span className="library-index-status__dot" aria-hidden="true"/>
          <span>{!indexStats ? ui("正在读取索引状态…") : indexStats.running ? ui("正在索引 · {0}/{1} 篇 · {2} 页", indexStats.completed, indexStats.total, indexStats.pages) : indexStats.failed ? ui("{0} 篇需处理 · 已索引 {1} 页", indexStats.failed, indexStats.pages) : ui("全文索引 {0}/{1} 篇 · {2} 页", indexStats.completed, indexStats.total, indexStats.pages)}</span>
          <Mark name="details" size={13}/>
        </button>}
      </main>

      <aside className="detail" data-compact-open={compactDetail} aria-label={ui("文献详情")}>
        <button className="btn compact-detail-toggle compact-detail-close" onClick={()=>setCompactDetail(false)}>{ui("返回文献列表")}</button>
        {detail && detail.id===selectedItem ? (
          <>
            <h2 className="detail__title" title={detail.title}>{detail.title || ui("（无标题）")}</h2>
            <div className="detail__meta">{detail.creators || ui("未记录作者")}</div>
            <div className="detail__meta">
              {[detail.fields.publicationTitle, detail.year].filter(Boolean).join(' · ') || '—'}
            </div>
            {detail.fields.DOI && (
              <button className="detail__meta detail__mono doi-copy" title={ui("复制 DOI")} onClick={()=>void window.jian.clipboard.writeText(detail.fields.DOI).then(()=>{setDoiCopied(true);setTimeout(()=>setDoiCopied(false),2000)})}>{doiCopied?ui("已复制"):("DOI "+detail.fields.DOI)}</button>
            )}

            <div className="detail__actions">
              {filter==='trash'?<button className="btn btn--primary" onClick={()=>void restoreItem()}>{ui('恢复文献')}</button>:<><button className="btn btn--primary" disabled={!detail.documents.some(readablePdf)} title={ui('打开选中文献 · ⌘O')} onClick={()=>void openItem(detail.id)}>{ui('阅读')}</button>
              <Menu label={ui('文献操作')}>
               <button onClick={()=>void window.jian.m4.copyCitation([detail.id],(["gbt","apa","mla","chicago","ieee"].includes(localStorage.getItem("jian.citation-style")??"")?localStorage.getItem("jian.citation-style"):"gbt") as import("@shared/m4").CitationStyle).then(r=>setStatus(r.ok?ui('引用已复制'):r.error.message))}>{ui('复制引用')}</button>
               <button onClick={()=>setExportIds([detail.id])}>{ui('引用与导出')}</button>
               <button onClick={()=>setMetadata('edit')}>{ui('编辑信息与检索元数据')}</button><button disabled={busy} onClick={()=>void linkFile()}>{ui('关联本地附件')}</button>{!detail.documents.some(readablePdf)&&<button disabled={!!downloadFor||!detail.fields.DOI} title={!detail.fields.DOI?ui('请先补全并核对 DOI，再获取全文'):undefined} onClick={()=>void fetchFullText()}>{ui('查找并下载全文')}</button>}
               <button disabled={!detail.documents.some(d=>d.activeVersionId)} onClick={()=>{const id=detail.documents.find(d=>d.activeVersionId)?.activeVersionId;if(id)void window.jian.documents.reveal(id)}}>{ui('在访达中显示')}</button>
               <button className="danger-text" disabled={busy||!!downloadFor} onClick={()=>void trashItem()}>{ui('移入回收站')}</button>
              </Menu></>}
            </div>

            <section className="detail__section">
              <div className="detail__section-label">{ui("附件")}</div>
              {detail.documents.length === 0 && <p className="detail__empty">{ui("无附件")}</p>}
              {detail.documents.map((d) => (
                <div className="detail-file-row" key={d.id}><button type="button" className="detail__doc" disabled={!readablePdf(d)||filter==='trash'} title={!readablePdf(d)?ui('此格式可作为附件保存，暂不支持在应用内阅读。'):undefined} onClick={()=>readablePdf(d)&&d.activeVersionId&&onOpenDocument(d.activeVersionId,detail.title)}>
                  <Mark name="reader" size={18}/>
                  <span className="detail__doc-main"><span className="detail__doc-name" title={d.displayName}>{d.displayName}</span><span className="detail__doc-meta">{!readablePdf(d)?ui('仅保存附件')+' · ':''}{d.storageMode==='linked'?ui('原文件关联')+' · ':d.storageMode==='managed'?ui('文库文件')+' · ':''}{d.pageCount?ui('{0} 页',d.pageCount):ui('页数未知')}{d.byteSize?' · '+(d.byteSize/1024).toFixed(0)+' KB':''}</span></span>
                </button>{d.storageMode==='linked'&&d.activeVersionId&&<button className="icon-button relink-file" disabled={busy} title={ui('重新定位原文件')} aria-label={ui('重新定位 {0}',d.displayName)} onClick={()=>void linkFile(d.activeVersionId!)}><Mark name="refresh" size={16}/></button>}</div>
              ))}
            </section>

            {filter!=='trash' && (
              <section className="detail__section">
                <div className="detail__section-label">{ui("标签")}</div>
                <div className="tag-list"><button className="tag tag-add" aria-label={ui("编辑题签")} onClick={()=>setMetadata("edit")}>＋</button>
                  {detail.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {(outcome.excerpts>0||outcome.notes>0)&&<div className="detail-outcomes">{[['excerpts',outcome.excerpts],['notes',outcome.notes]].map(([kind,count])=><button key={kind} className="provider-text-button" disabled={!detail.documents.some(d=>d.activeVersionId)||filter==='trash'} onClick={()=>{const id=detail.documents.find(d=>d.activeVersionId)?.activeVersionId;if(id)onOpenDocument(id,detail.title,{pageIndex:0,panel:kind as 'notes'|'excerpts'})}}>{kind==='excerpts'?ui('{0} 条撷英',count):ui('{0} 条朱批',count)}</button>)}</div>}
            {detail.fields.abstractNote&&<section className="detail__section"><div className="detail__section-label">{ui('摘要')}</div><p className="detail-abstract" data-expanded={abstractExpanded}>{detail.fields.abstractNote}</p><button className="provider-text-button" onClick={()=>setAbstractExpanded(v=>!v)}>{abstractExpanded?ui('收起'):ui('展开摘要')}</button></section>}
            {detail.notes.length>0&&<details className="imported-notes"><summary>{ui('导入的札记')}</summary>{detail.notes.map(n=><ImportedNote key={n.id} html={n.importedOriginalHtml} fallback={n.body}/>)}</details>}
          </>
        ) : (
          <div className="detail__empty-state">
            <p>{ui("选择一条文献查看详情")}</p>
          </div>
        )}
      </aside>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay__box">
            <p className="drop-overlay__title">{ui("松手导入")}</p>
            <p className="drop-overlay__body">{ui("文件会复制进文库，原始文件不会被修改或移动")}</p>
          </div>
        </div>
      )}

      {indexOpen && <LibraryIndexDialog stats={indexStats} onClose={() => setIndexOpen(false)} onAction={() => void (indexStats?.running ? window.jian.m4.indexStop() : window.jian.m4.indexStart(true)).then(async r => { if (!r.ok) setStatus(r.error.message); const next = await window.jian.m4.indexStats(); if (next.ok) setIndexStats(next.data) })}/>}
      {metadata && <MetadataDialog item={metadata==='edit'?detail??undefined:undefined} onClose={()=>setMetadata(null)} onSaved={(id,message)=>{void refreshDetail(id);if(message)setStatus(message)}} onExisting={id=>void refreshDetail(id)}/>}
      {exportIds && <ExportDialog ids={exportIds} onClose={()=>setExportIds(null)}/>}
      {zoteroOpen && <ZoteroImportDialog
        onClose={() => setZoteroOpen(false)}
        onImported={() => { void Promise.all([refreshMeta(), refreshItems()]); void window.jian.m4.indexStart() }}
      />}
    </div></>
  )
}
