import HomeSwitch from './HomeSwitch'
import Menu from './Menu'
import Mark from './Mark'
import {ui} from '../i18n'
export type ImportChoice='local'|'zotero'|'reference'
export default function HomeActions({active,onLibrary,onMemoir,onImport,onSettings,busy=false}:{active:'library'|'dashboard';onLibrary:()=>void;onMemoir:()=>void;onImport:(kind:ImportChoice)=>void;onSettings:()=>void;busy?:boolean}){
 return <div className="topbar-actions">{active==='library'&&<Menu label={ui('导入文献')} text={ui('导入')}><button disabled={busy} onClick={()=>onImport('local')}>{ui('关联本地文件')}</button><button disabled={busy} onClick={()=>onImport('zotero')}>{ui('从 Zotero 导入')}</button><button disabled={busy} onClick={()=>onImport('reference')}>{ui('按题名或 DOI 查找')}</button></Menu>}<HomeSwitch active={active} onLibrary={onLibrary} onMemoir={onMemoir}/><button className="icon-button app-settings" title={ui('文房 · 设置 ⌘,')} aria-label={ui('文房 · 设置 ⌘,')} onClick={onSettings}><Mark name="settings"/></button></div>
}
