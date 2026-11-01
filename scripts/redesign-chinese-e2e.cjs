const {app,BrowserWindow}=require('electron'),{buildSync}=require('../node_modules/.pnpm/node_modules/esbuild'),fs=require('node:fs'),{join,resolve}=require('node:path'),assert=require('node:assert/strict')
const root=resolve(process.env.JIAN_TEST_ROOT||'/tmp/jian-chinese-060');fs.mkdirSync(root,{recursive:true});app.setPath('userData',join(root,'app-data'));process.env.JIAN_LIBRARY_DIR=join(root,'library');process.env.JIAN_VIEW='reader'
const pdf=join(root,'chinese-fixture.pdf');require('./make-chinese-fixture.cjs')(pdf);process.env.JIAN_IMPORT=pdf
const helpers=join(root,'layout.cjs');buildSync({stdin:{contents:"export {analyzePage} from './src/renderer/src/reader/layout/analyze';export {documentBlocks,detectLanguage} from './src/renderer/src/reader/layout/document';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',outfile:helpers,tsconfig:'tsconfig.json'})
const {analyzePage,documentBlocks,detectLanguage}=require(helpers),wait=ms=>new Promise(r=>setTimeout(r,ms));let win
async function run(){
 require('../out/main/index.js');await app.whenReady();for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows().find(w=>w.isVisible());if(win&&!win.webContents.isLoading())break;await wait(100)}
 const js=s=>win.webContents.executeJavaScript(s),until=async(s,label)=>{for(let i=0;i<220;i++){if(await js(s))return;await wait(100)}throw Error(label)}
 await until('document.querySelectorAll(".pdf-page-host").length===3&&[...document.querySelectorAll(".pdf-page-host")].every(p=>p.pdfPage)','CJK pages')
 const glyphPages=await js('(async()=>{const out=[];for(const h of document.querySelectorAll(".pdf-page-host")){const p=h.pdfPage,vp=p.getViewport({scale:1,rotation:0}),c=await p.getTextContent(),glyphs=[];for(let i=0;i<c.items.length;i++){const g=c.items[i];if(!("str" in g)||!g.str.trim())continue;const m=g.transform,size=Math.hypot(m[2],m[3]),a=vp.convertToViewportPoint(m[4],m[5]+size),b=vp.convertToViewportPoint(m[4]+g.width,m[5]);glyphs.push({index:i,text:g.str,x0:Math.min(a[0],b[0]),y0:Math.min(a[1],b[1]),x1:Math.max(a[0],b[0]),y1:Math.max(a[1],b[1]),rect:[m[4],m[5],m[4]+g.width,m[5]+size]})}out.push({width:vp.width,height:vp.height,glyphs})}return out})()')
 const pages=Object.fromEntries(glyphPages.map((p,i)=>[i,analyzePage(p.glyphs,p.width,p.height,i)])),blocks=documentBlocks(pages,{overrides:[],edits:{}},{authors:['李明']})
 const abstracts=blocks.filter(s=>s.kind==='abstract');assert.equal(abstracts.length,3);assert.ok(abstracts.every(s=>s.text.includes('不确定性与不可预测性增强')))
 assert.ok(blocks.filter(s=>/DOI:|^李明$|人工智能与数字社会/.test(s.text)).every(s=>s.kind==='margin'))
 assert.equal(detectLanguage(blocks),'zh')
 await until('[...document.querySelectorAll(".reader-toolbar button")].find(b=>b.textContent==="对读")?.disabled','same-language guard')
 fs.writeFileSync(join(root,'reader-chinese-source.png'),(await require('./native-capture.cjs')(win)).toPNG())
 const config={kind:'compatible',baseUrl:'http://127.0.0.1:1/v1',model:'not-called',targetLanguage:'en',consent:false}
 const result=await js('window.jian.m3.configure('+JSON.stringify(config)+')');assert.equal(result.ok,true);await js('window.dispatchEvent(new Event("jian:settings-changed"))')
 await until('![...document.querySelectorAll(".reader-toolbar button")].find(b=>b.textContent==="对读").disabled','different target enables parallel')
 await js('[...document.querySelectorAll(".reader-toolbar button")].find(b=>b.textContent==="对读").click()');await until('!!document.querySelector(".reader-side")','CJK parallel')
 fs.writeFileSync(join(root,'reader-chinese-parallel.png'),(await require('./native-capture.cjs')(win)).toPNG())
 const evidence={fixture:'synthetic three-page Chinese PDF using standard CJK font',pages:3,abstracts:abstracts.map(s=>s.text),ignored:blocks.filter(s=>s.kind==='margin').map(s=>s.text),sameLanguageGuard:'PASS',targetLanguageChange:'PASS',cloudCalls:0}
 fs.writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log('[CJK PASS]',JSON.stringify(evidence));app.quit()
}
run().catch(async e=>{console.error('[CJK FAIL]',e);if(win){fs.writeFileSync(join(root,'failure.png'),(await require('./native-capture.cjs')(win)).toPNG());console.error(await win.webContents.executeJavaScript('document.body.innerText'))}app.exit(1)})
