import {useStrings} from '../i18n'
export default function HomeSwitch({active,onLibrary,onMemoir}:{active:'library'|'dashboard';onLibrary:()=>void;onMemoir:()=>void}):React.ReactElement{
 const s=useStrings()
 return <nav className="home-switch" aria-label={document.documentElement.dataset.locale==='zh'?'主页':'Home'}><button aria-current={active==='library'?'page':undefined} onClick={onLibrary}>{s.nav.library}</button><button aria-current={active==='dashboard'?'page':undefined} onClick={onMemoir}>{s.nav.dashboard}</button></nav>
}
