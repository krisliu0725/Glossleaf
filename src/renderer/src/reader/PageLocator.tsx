import {useCallback,useRef,useState} from 'react'
import {ui} from '../i18n'
import ReaderPopover from './ReaderPopover'
/** One page system in the reader: PDF page number, without a second label or navigator. */
export default function PageLocator({page,pages,onJump,disabled=false}:{page:number;pages:number;disabled?:boolean;onJump:(n:number)=>void}){
 const button=useRef<HTMLButtonElement>(null),[open,setOpen]=useState(false),[value,setValue]=useState(''),[error,setError]=useState(''),close=useCallback(()=>setOpen(false),[])
 const commit=()=>{const n=/^\d+$/.test(value.trim())?Number(value):NaN;if(!Number.isInteger(n)||n<1||n>pages){setError(ui('请输入 1–{0} 的页码。',pages));return}onJump(n);close()}
 return <><button ref={button} className="page-jump page-capsule" aria-label={ui('页码浏览')} aria-expanded={open} disabled={disabled||pages<1} onClick={()=>{setValue(String(page));setError('');setOpen(v=>!v)}}><span>{page}</span><span className="page-separator" aria-hidden="true">/</span><span>{pages>0?pages:'—'}</span></button>{open&&<ReaderPopover anchor={button.current} label={ui('跳转页码')} className="page-locator-popover" onClose={close}><form className="locator-input" onSubmit={e=>{e.preventDefault();commit()}}><label>{ui('跳转到')}<input data-autofocus aria-label={ui('跳转页码')} type="text" inputMode="numeric" pattern="[0-9]*" value={value} onFocus={e=>e.currentTarget.select()} onChange={e=>{setValue(e.target.value);setError('')}}/></label><span>/ {pages}</span><button type="submit">{ui('前往')}</button></form>{error&&<p className="locator-error" role="alert">{error}</p>}</ReaderPopover>}</>
}
