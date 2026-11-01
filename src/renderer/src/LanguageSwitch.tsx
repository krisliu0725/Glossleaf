import { ui, useLocale } from './i18n'
export default function LanguageSwitch(): React.ReactElement {
 const [locale,setLocale]=useLocale()
 return <div className="locale-switch" role="group" aria-label={ui('语言')}>
  <button type="button" lang="zh-CN" aria-label={locale === 'en' ? 'Switch to Chinese' : '使用中文界面'} aria-pressed={locale==='zh'} onClick={()=>setLocale('zh')}>中文</button>
  <button type="button" lang="en" aria-label="Use English interface" aria-pressed={locale==='en'} onClick={()=>setLocale('en')}>EN</button>
 </div>
}
