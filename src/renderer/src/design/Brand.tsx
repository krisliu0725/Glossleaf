import {useEffect,useState} from 'react'
import {useStrings} from '../i18n'
import type {LogoPaletteId} from '@shared/preferences'
import logoPalettes from '@shared/logo-palettes.json'
export function BrandMark({palette='ink-vermilion',dark=false,size=20}:{palette?:LogoPaletteId;dark?:boolean;size?:number}){
 const colors=logoPalettes.find(p=>p.id===palette)??logoPalettes[0]
 return <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className="glossleaf-brand-mark"><path fill={dark?colors.darkMain:colors.main} d="M 6.9,41.3 C 9.4,30.2 14.4,21.0 22.2,15.0 C 29.0,9.8 36.2,7.0 42.0,6.0 C 39.8,14.4 35.6,22.4 29.2,29.6 C 22.8,36.5 14.8,40.6 6.9,41.3 Z"/><path fill={dark?colors.darkAccent:colors.accent} d="M 10.6,43.0 C 24.7,39.6 38.5,29.1 42.0,6.0 C 46.2,19.7 41.9,34.7 28.6,40.2 C 22.5,42.6 16.8,43.0 10.6,43.0 Z"/></svg>
}
export default function Brand():React.ReactElement{
 const s=useStrings(),[selected,setSelected]=useState<LogoPaletteId>('ink-vermilion'),[dark,setDark]=useState(document.documentElement.dataset.theme==='dark')
 useEffect(()=>{const read=()=>void window.jian.preferences.get().then(r=>{if(r.ok)setSelected(r.data.logoPalette)});read();const observer=new MutationObserver(()=>setDark(document.documentElement.dataset.theme==='dark'));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});window.addEventListener('glossleaf:brand',read);return()=>{observer.disconnect();window.removeEventListener('glossleaf:brand',read)}},[])
 return <span className={'brand-lockup'+(s.app==='Glossleaf'?' brand-lockup--en':'')} aria-label={s.app}><span className="brand-emblem"><BrandMark palette={selected} dark={dark}/></span><span className="brand-wordmark"><span>{s.app}</span></span></span>
}
