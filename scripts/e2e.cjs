const {app,BrowserWindow}=require('electron')
const {createServer}=require('node:http')
const {join,resolve}=require('node:path')
const fs=require('node:fs')
const assert=require('node:assert/strict')
const root=resolve(process.env.JIAN_TEST_ROOT||'../../work/m3-e2e')
fs.mkdirSync(root,{recursive:true})
app.setPath('userData',join(root,'app-data'))
process.env.JIAN_LIBRARY_DIR=join(root,'library')
process.env.JIAN_VIEW='reader'
const fixture=join(root,'fixture.pdf');require('./make-fixture.cjs')(fixture);process.env.JIAN_IMPORT=fixture
const nativeGoogle=process.env.JIAN_TEST_PROVIDER==='gemini'
let calls=0
const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
 if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(nativeGoogle?{models:[{name:'models/fixture',displayName:'Fixture',supportedGenerationMethods:['generateContent']}]}:{data:[{id:'fixture'}]}));return}
 calls++;const b=JSON.parse(body),payload=JSON.parse(nativeGoogle?b.contents.at(-1).parts[0].text:b.messages.at(-1).content)
 const originals=payload.translate
 const chinese=originals.includes('Academic Reading')?'学术阅读：一项可复现的研究。':originals.includes('Research design')?'研究设计将证据与审慎的解释联系起来。':originals.includes('river bank')?'河岸与金融机构意义上的银行并不相同。':originals.includes('Methods')?'我们将原文段落和对应译文进行比较。读者可以选取文字，并保留它在原文中的位置。':originals.includes('Results')?'稳定的锚点在重启应用后仍然准确。术语表让重要的研究概念保持一致译法。':'本段用于验证段落对应、文字选择与摘录保存。'
 const text='测试译文：'+chinese+' '+(originals.match(/⟦P\d+⟧/g)||[]).join(' ')
 if(nativeGoogle){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]})+'\n\n');return}
 res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})+'\n\n')
 res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')
})})
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function run(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port
 require('../out/main/index.js');await app.whenReady()
 let win
 for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoading()){const ready=await win.webContents.executeJavaScript('!!window.jian && !!document.querySelector(".m3-reader")').catch(()=>false);if(ready)break}await wait(150)}
 if(!win)throw Error('window not created')
 const js=source=>win.webContents.executeJavaScript(source)
 for(let i=0;i<100;i++){if(await js('document.querySelectorAll(".textLayer span").length>0 && document.querySelectorAll("[data-segment]").length>2'))break;await wait(150)}
 const evidence={}
 evidence.textSpans=await js('document.querySelectorAll(".textLayer span").length');assert.ok(evidence.textSpans>=10,'standard text layer rendered')
 // Check presets and actual editable form before exercising the reader pipeline.
 await js("[...document.querySelectorAll('header button')].find(b=>b.textContent==='译注设置').click()")
 await wait(200)
 await js("(()=>{const s=document.querySelector('.provider-fields select');s.value='gemma';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
 await wait(100)
 evidence.gemmaPreset=await js("({endpoint:document.querySelector('input[type=url]').value,model:document.querySelector('input[list=provider-models]').value})")
 assert.equal(evidence.gemmaPreset.endpoint,'https://generativelanguage.googleapis.com/v1beta')
 assert.equal(evidence.gemmaPreset.model,'gemma-4-26b-a4b-it')
 evidence.settingsAction=await js("(()=>{const button=[...document.querySelectorAll('.m3-dialog button')].find(b=>b.textContent==='保存配置'),r=button.getBoundingClientRect();return {top:r.top,bottom:r.bottom,viewport:innerHeight}})()");assert.ok(evidence.settingsAction.top>=0 && evidence.settingsAction.bottom<=evidence.settingsAction.viewport,'save action remains visible')
 fs.writeFileSync(join(root,'api-settings.png'),(await require('./native-capture.cjs')(win)).toPNG())
 await js("[...document.querySelectorAll('.m3-dialog button')].find(b=>b.textContent==='关闭').click()")
 evidence.configure=await js(`window.jian.m3.configure({kind:'${nativeGoogle?'gemini':'compatible'}',baseUrl:'http://127.0.0.1:${port}/${nativeGoogle?'v1beta':'v1'}',model:'fixture',targetLanguage:'zh-CN',consent:true})`);assert.equal(evidence.configure.ok,true)
 await js("[...document.querySelectorAll('header button')].find(b=>b.textContent==='译注设置').click()")
 await wait(150)
 await js("(()=>{const input=document.querySelector('input[list=provider-models]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'fixture-custom');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
 await wait(50)
 await js("[...document.querySelectorAll('.m3-dialog button')].find(b=>b.textContent==='获取模型列表').click()")
 await wait(150)
 evidence.modelOptions=await js("[...document.querySelectorAll('#provider-models option')].map(x=>x.value)")
 assert.ok(evidence.modelOptions.includes('fixture'))
 await js("[...document.querySelectorAll('.m3-dialog button')].find(b=>b.textContent==='测试翻译').click()")
 await wait(180)
 evidence.draftTest=await js("document.querySelector('.provider-status').textContent");assert.ok(evidence.draftTest.includes('测试成功'))
 await js("[...document.querySelectorAll('.m3-dialog button')].find(b=>b.textContent==='保存配置').click()")
 await wait(150)
 evidence.savedCustom=await js("window.jian.m3.settings()");assert.equal(evidence.savedCustom.data.model,'fixture-custom')
 await js("[...document.querySelectorAll('.m3-dialog button')].find(b=>b.textContent==='关闭').click()")

 // Trigger the same visible actions as the reader (selection uses real DOM Range).
 evidence.selectionGeometry=await js(`(()=>{const spans=[...document.querySelectorAll('.textLayer span')];const node=spans.find(x=>x.textContent.includes('river bank')).firstChild;const range=document.createRange();range.setStart(node,2);range.setEnd(node,20);const s=getSelection();s.removeAllRanges();s.addRange(range);spans.find(x=>x.textContent.includes('river bank')).dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return {text:s.toString(),rects:[...range.getClientRects()].map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}))}})()`)
 await wait(200)
 evidence.selection=await js("document.querySelector('.selection-quote')?.textContent");assert.ok(evidence.selection,'selection captured')
 await js("[...document.querySelectorAll('.selection-panel button')].find(b=>b.textContent==='翻译').click()")
 for(let i=0;i<100;i++){if(await js("!!document.querySelector('.selection-panel .translation-body')?.textContent.includes('测试译文')"))break;await wait(100)}
 evidence.translation=await js("document.querySelector('.selection-panel .translation-body')?.textContent");assert.ok(evidence.translation.includes('测试译文'))
 await js("[...document.querySelectorAll('.selection-panel button')].find(b=>b.textContent==='存为摘录').click()")
 await wait(350)
 evidence.saved=await js("document.querySelector('.m3-feedback')?.textContent || document.body.textContent.includes('已存为摘录')")
 evidence.annotations=await js("window.jian.library.list({}).then(async l=>{const d=await window.jian.library.get(l.data.items[0].id);return window.jian.m3.annotations(d.data.documents[0].activeVersionId)})");assert.equal(evidence.annotations.data.length,1)
 assert.ok(evidence.annotations.data[0].anchors[0].rects.length>0)
 evidence.highlight=await js("document.querySelector('.pdf-highlights span').getBoundingClientRect().toJSON()")
 const expected=evidence.selectionGeometry.rects[0]
 assert.ok(Math.abs(evidence.highlight.x-expected.x)<2 && Math.abs(evidence.highlight.y-expected.y)<2,'PDF anchor maps back to the selected text')
 assert.ok(Math.abs(evidence.highlight.width-expected.width)<2,'selection width preserved')
 await js("(()=>{const s=document.querySelector('select[aria-label=\"PDF 缩放\"]');s.value='2';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
 await wait(350)
 evidence.zoomHighlight=await js("document.querySelector('.pdf-highlights span').getBoundingClientRect().toJSON()")
 assert.ok(Math.abs(evidence.zoomHighlight.width-evidence.highlight.width*2)<3,'highlight scales with PDF')
 await js("(()=>{const s=document.querySelector('select[aria-label=\"PDF 缩放\"]');s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
 await wait(150)

 await js("[...document.querySelectorAll('.selection-panel button')].find(b=>b.textContent==='关闭').click();[...document.querySelectorAll('header button')].find(b=>b.textContent==='双语').click()")
 await wait(150)
 await js("[...document.querySelectorAll('.translation-tools button')].find(b=>b.textContent==='翻译本页').click()")
 await wait(1400)
 evidence.blocks=await js("document.querySelectorAll('.translation-block .translation-body').length");assert.ok(evidence.blocks>1)
 evidence.errors=await js("[...document.querySelectorAll('.reader__error')].map(x=>x.textContent)");assert.equal(evidence.errors.length,0)
 // Cache replay uses the public API with the exact same source/context request.
 evidence.cache=await js(`(async()=>{const input={mode:'selection',text:'cache fixture [12]',context:'cache context',itemId:null,sourceLanguage:'auto'};await window.jian.m3.translate({requestId:crypto.randomUUID(),generation:77,input});return window.jian.m3.translate({requestId:crypto.randomUUID(),generation:78,input})})()`)
 assert.equal(evidence.cache.ok,true);assert.equal(evidence.cache.data.cached,true)
 // Job pipeline and persisted checkpoints are exercised via the actual IPC.
 evidence.jobs=await js(`(async()=>{const list=await window.jian.library.list({}),detail=await window.jian.library.get(list.data.items[0].id),id=detail.data.documents[0].activeVersionId;const job=await window.jian.m3.startJob(id,[{id:'e2e-unit',pageIndex:0,text:'Saved job checkpoint.',rects:[[50,50,150,65]],kind:'body',confidence:1}],null);return {id,job}})()`)
 assert.equal(evidence.jobs.job.ok,true);await wait(500)
 evidence.jobState=await js(`window.jian.m3.jobs(${JSON.stringify(evidence.jobs.id)})`);assert.equal(evidence.jobState.data[0].status,'completed')
 // Reload the renderer and verify annotations remain in SQLite.
 win.webContents.reload();await wait(1600)
 evidence.afterReload=await js(`window.jian.m3.annotations(${JSON.stringify(evidence.jobs.id)})`);assert.equal(evidence.afterReload.data.length,1)
 await js("[...document.querySelectorAll('header button')].find(b=>b.textContent==='双语')?.click()")
 await wait(200);fs.writeFileSync(join(root,'reader.png'),(await require('./native-capture.cjs')(win)).toPNG())
 win.setSize(960,760);await wait(200);fs.writeFileSync(join(root,'reader-narrow.png'),(await require('./native-capture.cjs')(win)).toPNG())
 win.setSize(1280,820);win.webContents.setZoomFactor(2);await wait(250);fs.writeFileSync(join(root,'reader-200-percent.png'),(await require('./native-capture.cjs')(win)).toPNG());win.webContents.setZoomFactor(1)
 evidence.httpCalls=calls;fs.writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log('[M3 E2E PASS]',JSON.stringify({protocol:nativeGoogle?'gemini':'compatible',textSpans:evidence.textSpans,blocks:evidence.blocks,annotations:evidence.afterReload.data.length,job:evidence.jobState.data[0].status,httpCalls:calls}))
 server.close();app.quit()
}
run().catch(async e=>{console.error('[M3 E2E FAIL]',e);const win=BrowserWindow.getAllWindows()[0];if(win){console.error('[DOM]',await win.webContents.executeJavaScript('JSON.stringify({text:document.body.innerText,pages:[...document.querySelectorAll(".pdf-page-host")].map(p=>({rect:p.getBoundingClientRect().toJSON(),html:p.innerHTML.slice(0,500)}))})'));fs.writeFileSync(join(root,'failure.png'),(await require('./native-capture.cjs')(win)).toPNG())}server.close();app.exit(1)})
