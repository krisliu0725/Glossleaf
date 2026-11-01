import { ui } from '../i18n'
import { useEffect } from 'react'
import { getPdfjs } from '../lib/pdf'
import { pageText } from '@shared/page-text'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
export default function IndexWorker(): null {
 useEffect(()=>{
  let stopped=false
  const run=async():Promise<void>=>{
   while(!stopped) {
    const next=await window.jian.m4.indexNext()
    if(!next.ok||!next.data)return
    const task=next.data
    const loading=getPdfjs().getDocument({url:`jian://doc/${task.token}`,cMapUrl:new URL('./pdfjs/cmaps/',document.baseURI).href,cMapPacked:true,standardFontDataUrl:new URL('./pdfjs/standard_fonts/',document.baseURI).href,wasmUrl:new URL('./pdfjs/wasm/',document.baseURI).href})
    try {
     const pdf=await loading.promise
     if(pdf.numPages>10000)throw new Error(ui("页数超过本轮索引上限 10000 页"))
     const completed=new Set(task.completedPages)
     for(let i=0;i<pdf.numPages&&!stopped;i++) {
      if(completed.has(i))continue
      const page=await pdf.getPage(i+1), content=await page.getTextContent()
      const {text,runs}=pageText(content.items.filter((v):v is TextItem=>'str'in v))
      if(text.length>150000)throw new Error(ui("第 {0} 页文字过多，请在阅读器中手动查找", i+1))
      const saved=await window.jian.m4.indexPage({documentVersionId:task.documentVersionId,pageIndex:i,text,runs})
      if(!saved.ok)throw new Error(saved.error.message)
      page.cleanup()
      await new Promise(r=>setTimeout(r,8))
     }
     if(!stopped)await window.jian.m4.indexFinish(task.documentVersionId,pdf.numPages)
    } catch(e) {
     if(!stopped)await window.jian.m4.indexFinish(task.documentVersionId,0,e instanceof Error && e.name==='PasswordException'?ui("PDF 受密码保护，本轮后台索引未包含此文件"):e instanceof Error?e.message:String(e))
    } finally {await loading.destroy()}
   }
  }
  const timer=setTimeout(()=>void run(),0)
  return ()=>{stopped=true;clearTimeout(timer)}
 },[])
 return null
}
