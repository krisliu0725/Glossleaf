import {useCallback,useEffect,useRef,useState} from 'react'
import {DEFAULT_READING_TOOLS,type ReadingTools} from '@shared/reading-tools'
export function useReadingTools(version:string){
 const [tools,setTools]=useState<ReadingTools>(DEFAULT_READING_TOOLS),[ready,setReady]=useState(false),[error,setError]=useState(''),serial=useRef<Promise<unknown>>(Promise.resolve()),generation=useRef(0),latest=useRef(tools);latest.current=tools
 useEffect(()=>{const g=++generation.current;setReady(false);setTools(DEFAULT_READING_TOOLS);void window.jian.m3.readingTools(version).then(r=>{if(g!==generation.current)return;if(r.ok){setTools(r.data);latest.current=r.data;setReady(true)}else setError(r.error.message)});return()=>{generation.current++}},[version])
 const update=useCallback((patch:Partial<ReadingTools>)=>{const g=generation.current;const next=serial.current.catch(()=>undefined).then(async()=>{const r=await window.jian.m3.readingTools(version,patch);if(g!==generation.current)return false;if(!r.ok){setError(r.error.message);return false}latest.current=r.data;setTools(r.data);setError('');return true}).catch(e=>{setError(e instanceof Error?e.message:String(e));return false});serial.current=next;return next},[version])
 return {tools,ready,error,update}
}
