import {colorScheme} from '@shared/appearance'
import type {AppPreferences} from '@shared/preferences'
export function applyAppearance(pick:Pick<AppPreferences,'dark'|'colorScheme'>):void {
 const root=document.documentElement,scheme=colorScheme(pick.colorScheme),c=pick.dark?scheme.dark:scheme.light
 root.dataset.theme=pick.dark?'dark':'light';root.dataset.colorScheme=scheme.id
 const tokens:Record<string,string>={
  surface:c.paper,'surface-sunken':c.inset,'surface-raised':c.raised,'text-primary':c.ink,'text-secondary':c.secondary,'text-muted':c.muted,line:c.line,'control-line':c.control,accent:c.accent,ink:c.ink,vermilion:c.accent,azure:c.teal,ochre:c.ochre,rice:c.inset,'rice-deep':c.line,hover:`color-mix(in srgb, ${c.ink} 4%, ${c.paper})`,selected:`color-mix(in srgb, ${c.teal} 10%, ${c.paper})`,selection:`color-mix(in srgb, ${c.teal} 18%, transparent)`,focus:c.teal,
  'jian-paper':c.paper,'jian-paper-inset':c.inset,'jian-paper-raised':c.raised,'jian-ink':c.ink,'jian-ink-secondary':c.secondary,'jian-ink-muted':c.muted,'jian-rule':c.line,'jian-control-line':c.control,'jian-vermilion':c.accent,'jian-teal':c.teal,'jian-ochre':c.ochre,'jian-ochre-ink':c.ochre,'jian-selection':`color-mix(in srgb, ${c.teal} 18%, transparent)`
 }
 for(const [name,value]of Object.entries(tokens))root.style.setProperty('--'+name,value)
 for(const [name,value]of Object.entries({vermilion:c.accent,teal:c.teal,ochre:c.ochre})){root.style.setProperty('--jian-'+name+'-soft',`color-mix(in srgb, ${value} 10%, ${c.paper})`);if(name!=='teal')root.style.setProperty('--'+name+'-soft',`color-mix(in srgb, ${value} 12%, transparent)`)}
 root.style.setProperty('--azure-soft',`color-mix(in srgb, ${c.teal} 12%, transparent)`)
}
