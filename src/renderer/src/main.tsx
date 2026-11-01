import {applyAppearance} from './design/appearance'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { getLocale, hydrateLocale } from './i18n'
import './design/global.css'
import './design/refine.css'
import './design/localized.css'
import './design/redesign.css'
import './reader/annotations.css'
import './design/comfort.css'
import './design/controls.css'
import './design/folio.css'
import './design/margins.css'
import './design/reading-room.css'
import './design/reader-fusion.css'
import './design/reading-desk.css'
import './design/interaction-audit.css'
import {hydrateReader} from './reader/preferences'

async function boot(): Promise<void> {
 const result = await window.jian.preferences.get().catch(() => null)
 if(result?.ok) {
  const locale = result.data.locale ?? getLocale()
  hydrateLocale(locale)
  hydrateReader(result.data.reader)
  applyAppearance(result.data)
  if (result.data.locale === null && new URLSearchParams(location.search).get('view') !== 'indexer') {
   await window.jian.preferences.set({locale})
  }
 }
 createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

}
void boot()
