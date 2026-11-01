const {app,BrowserWindow,dialog,clipboard}=require('electron')
const {join,resolve}=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict')
const root=resolve(process.env.JIAN_TEST_ROOT||'/tmp/jian-m4-e2e');fs.mkdirSync(root,{recursive:true})
app.setPath('userData',join(root,'app-data'));process.env.JIAN_LIBRARY_DIR=join(root,'library');process.env.JIAN_VIEW='library'
const fixture=join(root,'fixture.pdf');require('./make-fixture.cjs')(fixture);process.env.JIAN_IMPORT=fixture
let exportPath=join(root,'result.txt'),doiCalls=0
const crossref={DOI:'10.1234/jian-fixture',title:['外交与能源：An Evidence-Based Study'],type:'journal-article',author:[{family:'张',given:'明'},{name:'Institute for Evidence'}],published:{'date-parts':[[2026,10,29]]},'container-title':['研究方法'],volume:'8',issue:'2',page:'10-20',language:'zh-CN',URL:'https://doi.org/10.1234/jian-fixture'}
const nativeFetch=global.fetch;global.fetch=(url,options)=>{if(String(url).startsWith('https://api.crossref.org/works/')){doiCalls++;return Promise.resolve(new Response(JSON.stringify({status:'ok',message:crossref}),{headers:{'Content-Type':'application/json'}}))}return nativeFetch(url,options)}
dialog.showSaveDialog=async()=>({canceled:false,filePath:exportPath})
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function run(){require('../out/main/index.js');await app.whenReady();let win
 for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows().find(w=>w.isVisible());if(win&&!win.webContents.isLoading())break;await wait(100)}
 assert.ok(win);const js=s=>win.webContents.executeJavaScript(s),until=async(condition,description)=>{for(let i=0;i<150;i++){if(await js(condition))return;await wait(100)}throw Error(description)}
 await until('!!window.jian && !!document.querySelector(".workspace")','library ready')
 const evidence={}
 await until('window.jian.m4.indexStats().then(r=>r.ok&&r.data.completed===1)','background PDF indexing')
 evidence.index=await js('window.jian.m4.indexStats()');assert.equal(evidence.index.data.pages,2)
 evidence.body=await js("window.jian.m4.search({query:'river bank',scope:'body'})");assert.ok(evidence.body.data.groups[0].hits[0].anchor.rects.length)
 evidence.fixture=await js('window.jian.library.list({}).then(r=>r.data.items[0])')
 const id=evidence.fixture.id
 // React-controlled search input and scope controls.
 const inputValue=(selector,value)=>js(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 await inputValue('input[aria-label="搜索文集"]','same phrase')
 await until('document.querySelectorAll(".search-hit").length>0','global body search visible')
 await wait(1550)
 fs.writeFileSync(join(root,'search.png'),(await require('./native-capture.cjs')(win)).toPNG())
 await js("document.querySelector('.search-hit').click()")
 await until('!!document.querySelector(".m3-reader") && !!document.querySelector(".pdf-search-highlights span")','search opens anchored PDF')
 await until('document.querySelector("input[aria-label=跳转页码]").value==="2"','search page jump')
 evidence.page=await js('document.querySelector("input[aria-label=跳转页码]").value');assert.equal(evidence.page,'2')
 fs.writeFileSync(join(root,'search-location.png'),(await require('./native-capture.cjs')(win)).toPNG())
 await js("[...document.querySelectorAll('header button')].find(b=>b.textContent==='查找').click()")
 await inputValue('input[aria-label="查找本文"]','river bank')
 await until('document.querySelectorAll(".reader-find .search-hit").length>0','document find')
 await js("document.querySelector('.reader-find .search-hit').click()")
 await until('document.querySelector("input[aria-label=跳转页码]").value==="1"','document find anchor')
 // Create a saved excerpt with comment + persisted translation, then verify they are searchable/exported.
 evidence.annotation=await js(`(async()=>{const d=await window.jian.library.get(${JSON.stringify(id)}),v=d.data.documents[0].activeVersionId;return window.jian.m3.saveAnnotation({documentVersionId:v,type:'excerpt',quote:'river bank',comment:'外交与能源 reading note',anchors:[{documentVersionId:v,pageIndex:0,rects:[[50,580,300,600]],exact:'river bank'}],translation:{text:'河岸与能源',status:'completed',cached:false,inputHash:'fixture-hash',providerFingerprint:'fixture-provider',inputSnapshot:'{}'}})})()`);assert.equal(evidence.annotation.ok,true)
 evidence.excerpt=await js("window.jian.m4.search({query:'能源',scope:'excerpts'})");assert.ok(evidence.excerpt.data.groups[0].hits[0].annotationId)
 await js("[...document.querySelectorAll('header button')].find(b=>b.textContent==='‹ 文集').click()")
 await until('!!document.querySelector(".workspace")','back to library')
 await js("document.querySelector('button[aria-label=更多文集操作]').click()");await wait(50)
 await js("[...document.querySelectorAll('button')].find(b=>b.textContent==='通过 DOI 添加').click()")
 await inputValue('input[aria-label="DOI"]','https://doi.org/10.1234/JIAN-fixture')
 await js("[...document.querySelectorAll('.m3-dialog button')].find(b=>b.textContent==='查询元数据').click()")
 await until('!!document.querySelector("#metadata-form")','DOI preview')
 evidence.beforeConfirm=await js('window.jian.library.stats()');assert.equal(evidence.beforeConfirm.data.items,1)
 fs.writeFileSync(join(root,'doi-preview.png'),(await require('./native-capture.cjs')(win)).toPNG())
 await js("[...document.querySelectorAll('.m3-dialog button')].find(b=>b.textContent==='确认入库').click()")
 await until('!document.querySelector(".m3-dialog")','DOI confirmed')
 evidence.afterConfirm=await js('window.jian.library.list({})');assert.equal(evidence.afterConfirm.data.total,2)
 const doiItem=evidence.afterConfirm.data.items.find(i=>i.id!==id);assert.ok(doiItem)
 evidence.duplicate=await js("window.jian.m4.doiPreview('10.1234/jian-fixture')");assert.equal(evidence.duplicate.data.duplicates.length,1)
 evidence.duplicateDenied=await js(`window.jian.m4.doiCommit(${JSON.stringify(evidence.duplicate.data.draft)})`);assert.equal(evidence.duplicateDenied.ok,false)
 const formats=['csl-json','bibtex','markdown','excerpts-json','citation']
 evidence.exports={}
 for(const format of formats){const preview=await js(`window.jian.m4.exportPreview([${JSON.stringify(id)},${JSON.stringify(doiItem.id)}],${JSON.stringify(format)})`);assert.equal(preview.ok,true);evidence.exports[format]={bytes:Buffer.byteLength(preview.data.content),warnings:preview.data.warnings};exportPath=join(root,'result-'+format+'.'+preview.data.extension);const saved=await js(`window.jian.m4.exportSave([${JSON.stringify(id)},${JSON.stringify(doiItem.id)}],${JSON.stringify(format)})`);assert.equal(saved.ok,true);assert.equal(fs.readFileSync(exportPath,'utf8'),preview.data.content)}
 assert.equal(JSON.parse(fs.readFileSync(join(root,'result-csl-json.json'),'utf8')).length,2)
 assert.ok(fs.readFileSync(join(root,'result-markdown.md'),'utf8').includes('外交与能源 reading note'))
 assert.ok(fs.readFileSync(join(root,'result-excerpts-json.json'),'utf8').includes('河岸与能源'))
 await js(`window.jian.m4.copyCitation([${JSON.stringify(doiItem.id)}])`);evidence.clipboard=await clipboard.readText();assert.ok(evidence.clipboard.includes('外交与能源'))
 await js("[...document.querySelectorAll('.detail button')].find(b=>b.textContent==='引用与导出').click()")
 await until('!!document.querySelector(".export-preview")','export preview visible')
 fs.writeFileSync(join(root,'export-preview.png'),(await require('./native-capture.cjs')(win)).toPNG())
 await js("[...document.querySelectorAll('.m3-dialog button')].find(b=>b.textContent==='关闭').click()")
 win.setSize(960,760);await wait(100);fs.writeFileSync(join(root,'library-narrow.png'),(await require('./native-capture.cjs')(win)).toPNG())
 win.setSize(1280,820);win.webContents.setZoomFactor(2);await wait(150);fs.writeFileSync(join(root,'library-200-percent.png'),(await require('./native-capture.cjs')(win)).toPNG());win.webContents.setZoomFactor(1)
 evidence.doiCalls=doiCalls;fs.writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log('[M4 E2E PASS]',JSON.stringify({pages:evidence.index.data.pages,doiItems:evidence.afterConfirm.data.total,exports:formats.length,locationPage:evidence.page}))
 app.quit()
}
run().catch(async e=>{console.error('[M4 E2E FAIL]',e);const win=BrowserWindow.getAllWindows().find(w=>w.isVisible());if(win){console.error('[DOM]',await win.webContents.executeJavaScript('document.body.innerText'));fs.writeFileSync(join(root,'failure.png'),(await require('./native-capture.cjs')(win)).toPNG())}app.exit(1)})
