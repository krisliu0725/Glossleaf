import {applyAppearance} from './design/appearance'
import Brand from './design/Brand'
import {useStrings} from './i18n'
import HomeActions, {type ImportChoice} from './design/HomeActions'
import { ui } from './i18n'
import { useEffect, useRef, useState } from 'react'
import Dashboard from './analytics/Dashboard'
import PreferencesDialog from './analytics/PreferencesDialog'
import type {SettingsSection} from './analytics/PreferencesDialog'
import IndexWorker from './m4/IndexWorker'
import type { ReaderLocation } from '@shared/m4'
import ProbeView from './views/ProbeView'
import LibraryView from './views/LibraryView'
import ReaderView from './views/ReaderView'
import ReaderTabs from './reader/ReaderTabs'
import type {ReaderController,ReaderSession} from './reader/session'
import { type View } from './views/view'

import type { ProbeReport } from '@shared/types'

interface OpenDoc {
  documentVersionId: string
  title: string
  location?: ReaderLocation
}

export default function App(): React.ReactElement {
  return new URLSearchParams(window.location.search).get('view') === 'indexer' ? <IndexWorker/> : <Workspace/>
}
function Workspace(): React.ReactElement {
  useStrings()
  const initial = new URLSearchParams(window.location.search).get('view')
  const [view, setView] = useState<View>(
    initial === 'probe' || initial === 'reader' || initial === 'dashboard' ? initial : 'library'
  )
  const [openDoc,setOpenDoc]=useState<OpenDoc|null>(null),[documents,setDocuments]=useState<OpenDoc[]>([]),[switchBusy,setSwitchBusy]=useState(false)
  const controller=useRef<ReaderController|null>(null),sessions=useRef(new Map<string,ReaderSession>())
  const workspace=useRef({view,openDoc,documents});workspace.current={view,openDoc,documents}
  const navigation=useRef(Promise.resolve()),queued=useRef(0),activation=useRef(0),failedEpoch=useRef(0),requestedDoc=useRef<string|null>(null)
  const [navigationError,setNavigationError]=useState('')
  function commit(next:typeof workspace.current):void{workspace.current=next;setView(next.view);setOpenDoc(next.openDoc);setDocuments(next.documents)}
  function enqueue(action:()=>Promise<boolean>):Promise<boolean>{const epoch=failedEpoch.current;queued.current++;setSwitchBusy(true);const task=navigation.current.then(async()=>{if(epoch!==failedEpoch.current)return false;try{const ok=await action();if(!ok){failedEpoch.current++;requestedDoc.current=workspace.current.openDoc?.documentVersionId??null}return ok}catch(e){failedEpoch.current++;requestedDoc.current=workspace.current.openDoc?.documentVersionId??null;setNavigationError(e instanceof Error?e.message:String(e));return false}});navigation.current=task.then(()=>undefined,()=>undefined);return task.finally(()=>{queued.current--;if(!queued.current)setSwitchBusy(false)})}
  async function leaveReader():Promise<boolean>{const current=workspace.current;if(current.view!=='reader'||!current.openDoc||!controller.current||controller.current.documentVersionId!==current.openDoc.documentVersionId)return true;const snapshot=await controller.current.leave();if(snapshot===null)return false;if(snapshot)sessions.current.set(current.openDoc.documentVersionId,snapshot);return true}
  function openReading(next:OpenDoc):Promise<boolean>{requestedDoc.current=next.documentVersionId;const ticket=++activation.current;return enqueue(async()=>{if(ticket!==activation.current)return true;const current=workspace.current;if(current.view==='reader'&&current.openDoc?.documentVersionId===next.documentVersionId){if(next.location)commit({...current,openDoc:{...next,location:{...next.location}}});return true}if(!await leaveReader())return false;if(ticket!==activation.current)return true;const latest=workspace.current,docs=latest.documents.some(t=>t.documentVersionId===next.documentVersionId)?latest.documents.map(t=>t.documentVersionId===next.documentVersionId?next:t):[...latest.documents,next];commit({view:'reader',openDoc:next,documents:docs});return true})}
  function showHome(next:'library'|'dashboard'):Promise<boolean>{requestedDoc.current=null;const ticket=++activation.current;return enqueue(async()=>{if(ticket!==activation.current)return true;if(!await leaveReader())return false;if(ticket!==activation.current)return true;commit({...workspace.current,view:next});return true})}
  function closeReading(id:string):Promise<boolean>{return enqueue(async()=>{const current=workspace.current;if(!current.documents.some(t=>t.documentVersionId===id))return true;if(current.openDoc?.documentVersionId===id&&current.view==='reader'&&!await leaveReader())return false;const latest=workspace.current,remaining=latest.documents.filter(t=>t.documentVersionId!==id);sessions.current.delete(id);const isCurrent=latest.openDoc?.documentVersionId===id,index=latest.documents.findIndex(t=>t.documentVersionId===id),next=isCurrent?(remaining[Math.min(index,remaining.length-1)]??null):latest.openDoc;if(!remaining.some(t=>t.documentVersionId===requestedDoc.current))requestedDoc.current=next?.documentVersionId??null;commit({documents:remaining,openDoc:next,view:!next&&latest.view==='reader'?'library':latest.view});return true})}
  const tabstrip=(compact=false)=><ReaderTabs tabs={documents} active={compact?null:openDoc?.documentVersionId??null} compact={compact} busy={switchBusy} onSelect={id=>{const t=workspace.current.documents.find(t=>t.documentVersionId===id);return t?openReading({...t,location:undefined}):Promise.resolve(false)}} onClose={id=>void closeReading(id)}/>

  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [settingsSection,setSettingsSection]=useState<SettingsSection>('general'),[settingsItem,setSettingsItem]=useState<string|null>(null)
  const openSettings=(section:SettingsSection='general',itemId:string|null=null):void=>{setSettingsSection(section);setSettingsItem(itemId);setPreferencesOpen(true)}
  const [report, setReport] = useState<ProbeReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 从「志趣」点一个话题 → 跳到文库并按该词检索
  const [pendingImport,setPendingImport]=useState<ImportChoice|null>(null)
  const [pendingZotero,setPendingZotero]=useState(false)
  const [pendingSearch, setPendingSearch] = useState<string | null>(null)

  useEffect(() => {
    let live=true,revision=0
    const refresh=():void=>{const current=++revision;void window.jian.preferences.get().then(r=>{if(live&&current===revision&&r.ok)applyAppearance(r.data)})}
    refresh();const off=window.jian.theme.onChange(refresh)
    return()=>{live=false;off()}
  }, [])

  useEffect(()=>{const apply=(state:{fullScreen:boolean;platform:string})=>{document.documentElement.dataset.fullscreen=String(state.fullScreen);document.documentElement.dataset.platform=state.platform};void window.jian.windowState.get().then(r=>{if(r.ok)apply(r.data)});return window.jian.windowState.onChange(apply)},[])

  // 探针只在需要时跑，不再每次启动都做完整扫描
  useEffect(() => {
    if (view !== 'probe' || report) return
    let cancelled = false
    void window.jian.probe.run().then((res) => {
      if (cancelled) return
      if (res.ok) setReport(res.data)
      else setError(`${res.error.code}: ${res.error.message}`)
    })
    return () => {
      cancelled = true
    }
  }, [view, report])

  // 直接以 reader 视图启动时（开发自检或恢复上次阅读），自动打开最近一篇有附件的文献
  useEffect(() => {
    if (view !== 'reader' || openDoc) return
    let cancelled = false
    void (async () => {
      const list = await window.jian.library.list({ limit: 50 })
      if (cancelled) return
      if (!list.ok) {
        console.warn('[auto-open] 读取列表失败', list.error.code, list.error.message)
        setView('library')
        return
      }
      for (const item of list.data.items) {
        if (!item.hasPdf) continue
        const detail = await window.jian.library.get(item.id)
        if (cancelled) return
        if (!detail.ok || !detail.data) {
          console.warn(
            '[auto-open] 读取详情失败',
            item.id,
            detail.ok ? 'data=null' : `${detail.error.code} ${detail.error.message}`
          )
          continue
        }
        const doc = detail.data.documents.find((d) => d.activeVersionId)
        if (doc?.activeVersionId) {
          const next={documentVersionId:doc.activeVersionId,title:detail.data.title};setDocuments(tabs=>tabs.some(t=>t.documentVersionId===next.documentVersionId)?tabs:[...tabs,next]);setOpenDoc(next)
          return
        }
      }
      // 没有任何可读附件时退回文库，不要停在等待态
      if (!cancelled) setView('library')
    })()
    return () => {
      cancelled = true
    }
  }, [view, openDoc])

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault();event.stopPropagation();openSettings();return }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();event.stopPropagation();void showHome('library').then(ok=>{if(ok)requestAnimationFrame(()=>window.dispatchEvent(new Event('jian:search-focus')))})
      }
    }
    window.addEventListener('keydown', key,true); return () => window.removeEventListener('keydown', key,true)
  }, [])
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(!e.ctrlKey||e.altKey||!documents.length||document.querySelector('[aria-modal=true]'))return;if(e.key!=='Tab'&&e.key!=='PageUp'&&e.key!=='PageDown')return;e.preventDefault();e.stopPropagation();const i=documents.findIndex(t=>t.documentVersionId===(requestedDoc.current??openDoc?.documentVersionId)),back=e.key==='PageUp'||e.shiftKey,next=documents[(i+(back?documents.length-1:1))%documents.length];void openReading({...next,location:undefined})};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[documents,openDoc,view]);
  const goLibrary=():void=>{void showHome('library')}


  return (
    <>
      {navigationError&&<div className="workspace-navigation-error" role="alert">{ui(navigationError)}<button aria-label={ui('关闭提示')} onClick={()=>setNavigationError('')}>×</button></div>}
      {(view==='dashboard'||view==='probe')&&<header className="toolbar dashboard-toolbar"><span className="toolbar__title"><Brand/></span><span className="toolbar__spacer"/><HomeActions active="dashboard" onLibrary={goLibrary} onMemoir={()=>void showHome('dashboard')} onImport={kind=>{setPendingImport(kind);goLibrary()}} onSettings={()=>openSettings()}/></header>}


      {view === 'dashboard' && (
        <Dashboard
          onLibrary={goLibrary}
          onOpenDocument={(documentVersionId, title) => {
            void openReading({documentVersionId,title})
          }}
          onSettings={() => openSettings()}
          onSearchTopic={(topic) => {
            setPendingSearch(topic)
            void showHome('library')
          }}
        />
      )}
      {preferencesOpen && <PreferencesDialog onZotero={()=>{void showHome('library').then(ok=>{if(ok){setPreferencesOpen(false);setPendingZotero(true)}})}} initial={settingsSection} itemId={settingsItem} onClose={() => setPreferencesOpen(false)}/>}
      {view === 'probe' && <ProbeView report={report} error={error} />}
      {(view === 'library'||view === 'reader') && (
        <div className="library-session" hidden={view!=='library'} inert={view!=='library'}><LibraryView readingTabs={documents.length?tabstrip(true):undefined} initialImport={pendingImport} onConsumeImport={()=>setPendingImport(null)} initialZotero={pendingZotero} onConsumeZotero={()=>setPendingZotero(false)} onDashboard={()=>void showHome('dashboard')} onSettings={()=>openSettings()}
          initialQuery={pendingSearch}
          onConsumeInitialQuery={() => setPendingSearch(null)}
          onOpenDocument={(documentVersionId, title, location) => {
            void openReading({documentVersionId,title,location})
          }}
        /></div>
      )}
      {view === 'reader' && openDoc && (
        <ReaderView
          key={openDoc.documentVersionId}
          documentVersionId={openDoc.documentVersionId}
          title={openDoc.title}
          ref={controller}
          initialSession={sessions.current.get(openDoc.documentVersionId)}
          documentTabs={tabstrip()}
          location={openDoc.location}
          onBack={goLibrary}
          onDashboard={()=>void showHome('dashboard')}
          onSettings={openSettings}
        />
      )}
      {view === 'reader' && !openDoc && (
        <div className="boot">
          <p className="boot__text">{ui("正在打开文献…")}</p>
          <button type="button" className="btn" onClick={goLibrary}>
            {ui("返回文库")}</button>
        </div>
      )}
    </>
  )
}
