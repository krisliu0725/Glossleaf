import {COLOR_SCHEMES,type ColorSchemeId} from '@shared/appearance'
import {applyAppearance} from '../design/appearance'
import ProfileBar from './ProfileBar'
import {BrandMark} from '../design/Brand'
import logoPalettes from '@shared/logo-palettes.json'
import type {LogoPaletteId} from '@shared/preferences'
import {getLocale} from '../i18n'
import {PaletteSettingsPanel} from '../reader/AnnotationTools'
import LanguageSwitch from '../LanguageSwitch'
import { ui,dateLocale } from '../i18n'
import {useEffect,useState} from 'react'
import type {AppPreferences,Diagnostics,ThemePreference} from '@shared/preferences'
import type {AnalyticsSettings} from '@shared/analytics'
import type {BackupSummary} from '@shared/domain'
import {DEFAULT_READER,type ReaderPreferences} from '@shared/reader'
import {saveReader,useReaderPreferences} from '../reader/preferences'
import Dialog from '../reader/Dialog'
import TranslationSettings from '../reader/TranslationSettings'
import GlossaryDialog from '../reader/GlossaryDialog'
import {LibraryIndexDialog} from '../views/LibraryToolbar'
import type {IndexStats} from '@shared/m4'
export type SettingsSection='general'|'reading'|'translation'|'library'|'advanced'
export default function PreferencesDialog({onClose,initial='general',itemId=null,onZotero}:{onClose:()=>void;onZotero:()=>void;initial?:SettingsSection;itemId?:string|null}):React.ReactElement{
 const prefs=useReaderPreferences()
 const [section,setSection]=useState<SettingsSection>(initial),[preferences,setPreferences]=useState<AppPreferences|null>(null),[analytics,setAnalytics]=useState<AnalyticsSettings|null>(null),[diagnostics,setDiagnostics]=useState<Diagnostics|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirmClear,setConfirmClear]=useState(false),[glossary,setGlossary]=useState(false),[backups,setBackups]=useState<BackupSummary[]>([]),[restore,setRestore]=useState<string|null>(null),[index,setIndex]=useState<IndexStats|null>(null),[indexOpen,setIndexOpen]=useState(false),[confirmCache,setConfirmCache]=useState(false),[confirmReset,setConfirmReset]=useState(false)
 const changed=():void=>{window.dispatchEvent(new Event('jian:settings-changed'))}
 useEffect(()=>{let dead=false;void Promise.all([window.jian.preferences.get(),window.jian.analytics.settings(),window.jian.backup.list(),window.jian.m4.indexStats()]).then(([p,a,b,i])=>{if(dead)return;if(p.ok)setPreferences(p.data);if(a.ok)setAnalytics(a.data);if(b.ok)setBackups(b.data);if(i.ok)setIndex(i.data)});return()=>{dead=true}},[])
 async function run(fn:()=>Promise<void>):Promise<void>{setBusy(true);try{await fn()}catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 async function theme(value:ThemePreference):Promise<void>{await run(async()=>{const r=await window.jian.preferences.set({theme:value});if(r.ok)setPreferences(r.data);else setMessage(r.error.message)})}
 async function scheme(value:ColorSchemeId):Promise<void>{await run(async()=>{const r=await window.jian.preferences.set({colorScheme:value});if(!r.ok)throw Error(r.error.message);setPreferences(r.data);applyAppearance(r.data)})}
 async function reader(patch:Partial<ReaderPreferences>):Promise<void>{await run(async()=>{await saveReader(patch);changed()})}
 async function track(enabled:boolean):Promise<void>{await run(async()=>{const r=await window.jian.analytics.settings({enabled});if(r.ok){setAnalytics(r.data);setMessage(enabled?ui('已开启本地使用记录'):ui('已暂停本地使用记录；现有数据仍保留'))}else setMessage(r.error.message)})}
 async function backup():Promise<void>{await run(async()=>{const r=await window.jian.backup.create();if(r.ok){setMessage(r.data.verified?ui('完整备份已创建并校验'):ui('备份未通过文件校验，请检查原文件后重试')); const b=await window.jian.backup.list();if(b.ok)setBackups(b.data)}else setMessage(r.error.message)})}
 async function restoreBackup():Promise<void>{if(!restore)return;await run(async()=>{const r=await window.jian.backup.restore(restore);if(!r.ok){setMessage(r.error.message);return}setRestore(null);location.reload()})}
 const tabs=[['general','通用'],['reading','阅读与外观'],['translation','翻译'],['library','书府与备份'],['advanced','高级与诊断']] as const
 return <Dialog title={ui('文房')} className="settings-dialog" onClose={()=>{changed();onClose()}} closeDisabled={busy}>
  <div className="settings-layout">
   <nav aria-label={ui('设置分区')} className="settings-nav">{tabs.map(([id,label])=><button key={id} aria-current={section===id?'page':undefined} onClick={()=>{setSection(id);setMessage('')}}>{ui(label)}</button>)}</nav>
   <div className="settings-content m3-form" key={section}>
    <h3 className="settings-section-title">{ui(tabs.find(t=>t[0]===section)![1])}</h3>
    {section==='general'&&<>
     <ProfileBar fallback={ui('本地用户')} note={ui('数据只保存在这台电脑上，不上传。')} rename={ui('改名')}/>
     <section><h4>{ui('界面语言')}</h4><LanguageSwitch/><p className="m3-muted">{ui('语言仅调整界面，不改变文献、笔记或译文目标语言。')}</p></section>
     <section><label>{ui('显示主题')}<select aria-label={ui('显示主题')} disabled={busy||!preferences} value={preferences?.theme??'system'} onChange={e=>void theme(e.target.value as ThemePreference)}><option value="system">{ui('跟随系统')}</option><option value="light">{ui('浅色 · 纸墨')}</option><option value="dark">{ui('深色 · 夜读')}</option></select></label></section>
     <section className="scheme-settings"><h4>{ui('纸色与墨韵')}</h4><p className="m3-muted">{ui('全局配色同时适配浅色与夜读；原件与已有高亮保持原色。')}</p><div className="scheme-options" role="group" aria-label={ui('全局配色')}>{COLOR_SCHEMES.map(s=>{const c=preferences?.dark?s.dark:s.light;return <button type="button" key={s.id} disabled={busy||!preferences} aria-pressed={(preferences?.colorScheme??'paper')===s.id} onClick={()=>void scheme(s.id)}><span className="scheme-paper" style={{background:c.paper,color:c.ink,borderColor:c.line}} aria-hidden="true"><i style={{background:c.accent}}/><i style={{background:c.teal}}/><i style={{background:c.ochre}}/></span><span>{getLocale()==='en'?s.en:s.zh}</span><span className="scheme-check" aria-hidden="true">{(preferences?.colorScheme??'paper')===s.id?'✓':''}</span></button>})}</div></section>
     <section><h4>{ui('快捷键')}</h4><dl className="shortcut-list">{[['打开文房','⌘,'],['考索文献','⌘F'],['翻译选区或本页','⌘T'],['翻译全文','⌘⇧T'],['以最近色高亮','H'],['色槽高亮','1–6'],['写朱批','N'],['撤销 / 重做','⌘Z / ⌘⇧Z'],['切换阅读侧栏','⌘\\'],['打开选中文献','⌘O'],['缩放','⌘+ / ⌘- / ⌘0']].map(([label,key])=><div key={key}><dt>{ui(label)}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl></section>
    </>}
    {section==='reading'&&<>
     <section className="logo-settings"><h4>{ui('品牌标识配色')}</h4><div className="logo-color-options">{logoPalettes.map(p=><button type="button" key={p.id} aria-pressed={(preferences?.logoPalette??'ink-vermilion')===p.id} disabled={busy} onClick={()=>void run(async()=>{const r=await window.jian.preferences.set({logoPalette:p.id as LogoPaletteId});if(!r.ok)throw Error(r.error.message);setPreferences(r.data);window.dispatchEvent(new Event('glossleaf:brand'))})}><BrandMark palette={p.id as LogoPaletteId} dark={preferences?.dark}/><span>{getLocale()==='en'?p.en:p.zh}</span></button>)}</div><button className="provider-text-button" disabled={busy} onClick={()=>void run(async()=>{const r=await window.jian.preferences.set({logoPalette:'ink-vermilion'});if(r.ok){setPreferences(r.data);window.dispatchEvent(new Event('glossleaf:brand'))}else throw Error(r.error.message)})}>{ui('恢复默认标识')}</button><p className="m3-muted">{ui('仅改变品牌图形配色，不影响高亮、朱批或应用主题。')}</p></section>
     <PaletteSettingsPanel/>
     <label>{ui('默认阅读模式')}<select aria-label={ui('默认阅读模式')} value={prefs.defaultMode} disabled={busy} onChange={e=>void reader({defaultMode:e.target.value as ReaderPreferences['defaultMode']})}><option value="source">{ui('原文')}</option><option value="bilingual">{ui('对读')}</option></select></label>
     <label>{ui('默认缩放')}<select aria-label={ui('默认缩放')} value={prefs.defaultZoom} disabled={busy} onChange={e=>void reader({defaultZoom:Number(e.target.value)})}>{[.5,.8,1,1.2,1.5,2,3].map(n=><option key={n} value={n}>{Math.round(n*100)}%</option>)}</select></label>
     <label>{ui('译文字号')}<select aria-label={ui('译文字号')} value={prefs.glossSize} disabled={busy} onChange={e=>void reader({glossSize:Number(e.target.value)})}>{[15,16,17,18,19].map(n=><option key={n} value={n}>{n} px</option>)}</select></label>
     <label className="settings-checkbox"><input type="checkbox" checked={prefs.paperTint} disabled={busy} onChange={e=>void reader({paperTint:e.target.checked})}/>{ui('以宣米色柔化 PDF 背景')}</label><p className="m3-muted">{ui('仅调整显示，不改动 PDF 文件。默认保持原件颜色。')}</p>
     <label className="settings-checkbox"><input type="checkbox" checked={prefs.statusDots} disabled={busy} onChange={e=>void reader({statusDots:e.target.checked})}/>{ui('在列表中显示阅读成果标记')}</label>
     <label>{ui('页边段落轨道')}<select aria-label={ui('页边段落轨道')} value={prefs.track} onChange={e=>void reader({track:e.target.value as 'current'|'all'})}><option value="current">{ui('仅当前段')}</option><option value="all">{ui('显示全部序号')}</option></select></label>
    </>}
    {section==='translation'&&<>
     <TranslationSettings embedded onClose={()=>undefined} onSaved={()=>{changed()}}/>
     <section className="settings-secondary">
      <label className="settings-checkbox"><input type="checkbox" checked={prefs.autoTranslate} disabled={busy} onChange={e=>void reader({autoTranslate:e.target.checked})}/>{ui('打开对读时自动翻译当前页')}</label>
      <p className="m3-muted">{ui('默认关闭。开启后，进入对读与切换页面可能发送文字并产生服务费用。仍需服务授权。')}</p>
      <button className="btn" onClick={()=>setGlossary(true)}>{ui('释名管理')}</button>
      <label className="settings-checkbox"><input type="checkbox" checked={prefs.inlineEnabled} disabled={busy} onChange={e=>void reader({inlineEnabled:e.target.checked})}/>{ui('开启夹注实验')}</label><p className="m3-muted">{ui('开启后可在阅读选项中使用。复杂页面会保留原版。')}</p>
     </section>
    </>}
    {section==='library'&&<>
     <section><h4>{ui('留存')}</h4><p className="m3-muted">{ui('平时直接读取原文件。手动创建完整备份时，才把关联附件收进备份包，便于迁移与恢复。')}</p><button className="btn btn--primary" disabled={busy} onClick={()=>void backup()}>{ui('立即备份')}</button></section>
     <section><h4>{ui('恢复备份')}</h4>{backups.length?backups.map(b=><div className="backup-row" key={b.id}><span>{new Date(b.createdAt).toLocaleString(dateLocale())} · {(b.byteSize/1024/1024).toFixed(1)} MB</span><button className="btn" disabled={busy} onClick={()=>setRestore(b.id)}>{ui('恢复')}</button></div>):<p className="m3-muted">{ui('还没有备份。')}</p>}
     {restore&&<div className="preferences-confirm"><p>{ui('恢复会替换当前书府。请先创建当前备份；确认后重新载入应用。')}</p><button className="btn" disabled={busy} onClick={()=>setRestore(null)}>{ui('取消')}</button><button className="btn btn--danger" disabled={busy} onClick={()=>void restoreBackup()}>{ui('确认恢复备份')}</button></div>}</section>
     <section><h4>Zotero</h4><p className="m3-muted">{ui('先检查来源，再导入文献与附件。')}</p><button className="btn" onClick={onZotero}>{ui('从 Zotero 导入')}</button></section>
     <section><h4>{ui('全文索引')}</h4><button className="btn" disabled={busy} onClick={()=>setIndexOpen(true)}>{ui('管理全文索引')}</button></section>
     <section><h4>{ui('回收站')}</h4><p className="m3-muted">{ui('移入回收站的文献一直保留，可在书府侧栏中恢复。不会自动永久删除。')}</p></section>
    </>}
    {section==='advanced'&&<>
     <section><h4>{ui('本地使用记录')}</h4><label className="settings-checkbox"><input type="checkbox" disabled={busy||!analytics} checked={analytics?.enabled??false} onChange={e=>void track(e.target.checked)}/>{ui('记录有效阅读和模型用量')}</label><p className="m3-muted">{ui('仅保存在本机文库，不上传统计。关闭后不记录新活动；已有文献和统计仍可查看。模型未回传的 Token 保持未知。')}</p><div className="m3-actions"><button className="btn" disabled={busy} onClick={()=>void run(async()=>{const r=await window.jian.preferences.saveUsage();setMessage(r.ok?r.data.canceled?ui('已取消导出'):ui('完整使用数据已导出'):r.error.message)})}>{ui('导出完整使用数据')}</button><button className="btn" onClick={()=>setConfirmClear(v=>!v)}>{ui('清除使用统计')}</button></div>{confirmClear&&<div className="preferences-confirm"><p>{ui('将清除阅读活动、调用计量与操作统计。文献、摘录、分类和服务配置会保留。此操作无法撤销。')}</p><button className="btn" onClick={()=>setConfirmClear(false)}>{ui('保留统计')}</button><button className="btn btn--danger" disabled={busy} onClick={()=>void run(async()=>{const r=await window.jian.analytics.clear();if(r.ok){setAnalytics(r.data);setConfirmClear(false);setMessage(ui('统计已清除；文献、摘录、已确认分类和 API 设置均已保留。'))}else setMessage(r.error.message)})}>{ui('确认清除统计')}</button></div>}</section>
     <section><h4>{ui('应用诊断')}</h4><p className="m3-muted">{ui('摘要不包含文献正文、路径、端点或密钥。')}</p><div className="m3-actions"><button className="btn" disabled={busy} onClick={()=>void run(async()=>{const r=await window.jian.preferences.diagnostics();if(r.ok)setDiagnostics(r.data);else setMessage(r.error.message)})}>{ui('查看诊断')}</button><button className="btn" disabled={busy} onClick={()=>void run(async()=>{const r=await window.jian.preferences.saveDiagnostics();setMessage(r.ok?r.data.canceled?ui('已取消保存'):ui('诊断摘要已保存'):r.error.message)})}>{ui('保存诊断摘要')}</button><button className="btn" onClick={()=>setIndexOpen(true)}>{ui('索引诊断')}</button></div>{diagnostics&&<dl className="preferences-diagnostics"><dt>{ui('应用')}</dt><dd>{diagnostics.appVersion}</dd><dt>{ui('数据服务')}</dt><dd>{diagnostics.serviceReady?ui('正常'):ui('暂不可用')} · schema {diagnostics.schemaVersion??ui('未知')}</dd><dt>{ui('索引')}</dt><dd>{diagnostics.index?ui('{0}/{1} 个文档 · {2} 个失败',diagnostics.index.completed,diagnostics.index.total,diagnostics.index.failed):ui('暂不可用')}</dd></dl>}</section>
     <section><h4>{ui('段落诊断')}</h4><label className="settings-checkbox"><input type="checkbox" checked={prefs.showIgnored} disabled={busy} onChange={e=>void reader({showIgnored:e.target.checked})}/>{ui('显示被忽略的内容')}</label></section>
     <section><h4>{ui('缓存与偏好')}</h4><button className="btn" onClick={()=>setConfirmCache(v=>!v)}>{ui('清理机器翻译缓存')}</button>{confirmCache&&<div className="preferences-confirm"><p>{ui('仅清理可重新生成的机器译文缓存。已保存成果、手改译文和段落修正会保留。')}</p><button className="btn" onClick={()=>setConfirmCache(false)}>{ui('取消')}</button><button className="btn" disabled={busy} onClick={()=>void run(async()=>{const r=await window.jian.m3.clearCache();setMessage(r.ok?ui('机器翻译缓存已清理'):r.error.message);setConfirmCache(false);changed()})}>{ui('确认清理缓存')}</button></div>}
     <button className="btn" onClick={()=>setConfirmReset(v=>!v)}>{ui('重置阅读偏好')}</button>{confirmReset&&<div className="preferences-confirm"><p>{ui('恢复默认阅读与布局偏好。文献、内容和 API 配置保留。')}</p><button className="btn" onClick={()=>setConfirmReset(false)}>{ui('取消')}</button><button className="btn" disabled={busy} onClick={()=>void run(async()=>{await saveReader(DEFAULT_READER);changed();setConfirmReset(false);setMessage(ui('阅读偏好已恢复默认'))})}>{ui('确认重置')}</button></div>}</section>
    </>}
    {message&&<p className="provider-status" role="status">{ui(message)}</p>}
   </div>
  </div>
  {glossary&&<GlossaryDialog itemId={itemId} initial={{source:'',target:''}} onClose={()=>{setGlossary(false);changed()}}/>}
  {indexOpen&&<LibraryIndexDialog stats={index} onClose={()=>setIndexOpen(false)} onAction={()=>void run(async()=>{const r=await(index?.running?window.jian.m4.indexStop():window.jian.m4.indexStart(true));if(!r.ok)setMessage(r.error.message);const next=await window.jian.m4.indexStats();if(next.ok)setIndex(next.data)})}/>}
 </Dialog>
}
