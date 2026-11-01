import { useEffect,useState } from 'react'
import { DEFAULT_READER,type ReaderPreferences } from '@shared/reader'
let current={...DEFAULT_READER}
const listeners=new Set<()=>void>()
export function hydrateReader(value:ReaderPreferences):void {current=value;document.documentElement.style.setProperty('--jian-gloss-size',value.glossSize+'px');document.documentElement.dataset.pdfTint=String(value.paperTint);document.documentElement.dataset.paragraphTrack=value.track;for(const f of listeners)f()}
export async function saveReader(value:Partial<ReaderPreferences>):Promise<void>{const r=await window.jian.preferences.set({reader:value});if(!r.ok)throw Error(r.error.message);hydrateReader(r.data.reader)}
export function useReaderPreferences():ReaderPreferences{const [value,set]=useState(current);useEffect(()=>{const f=()=>set(current);listeners.add(f);return()=>{listeners.delete(f)}},[]);return value}
