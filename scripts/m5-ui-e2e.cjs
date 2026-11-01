// Isolated UI regressions: synthetic PDF + temporary library; no personal Zotero reads.
const {app,BrowserWindow,ipcMain}=require('electron')
const fs=require('node:fs'),{join,resolve}=require('node:path'),assert=require('node:assert/strict')
const root=resolve(process.env.JIAN_TEST_ROOT||'/tmp/jian-m5-ui');fs.mkdirSync(root,{recursive:true})
app.setPath('userData',join(root,'app-data'));process.env.JIAN_LIBRARY_DIR=join(root,'library');process.env.JIAN_VIEW='library'
const fixture=join(root,'fixture.pdf');require('./make-fixture.cjs')(fixture);process.env.JIAN_IMPORT=fixture
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win
async function run(){
 require('../out/main/index.js');await app.whenReady()
 for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows().find(w=>w.isVisible());if(win&&!win.webContents.isLoading())break;await wait(100)}
 assert.ok(win)
 const js=s=>win.webContents.executeJavaScript(s),until=async(s,description)=>{for(let i=0;i<100;i++){if(await js(s))return;await wait(100)}throw Error(description)}
 const click=text=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.closest('[inert]'));if(!b)throw Error('missing button '+${JSON.stringify(text)});b.focus();b.click()})()`)
 const input=(selector,value)=>js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 const press=(keyCode,modifiers=[])=>{win.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Return'||keyCode==='Space')win.webContents.sendInputEvent({type:'char',keyCode:keyCode==='Return'?'\r':' ',modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers})}
 await until('!!document.querySelector(".row") && !!document.querySelector(".detail__title")','fixture library ready')
 await until('window.jian.m4.indexStats().then(r=>r.ok&&r.data.completed===1)','index complete')
 const evidence={}
 await js("document.querySelector('button[aria-label=更多文集操作]').click()");await click('通过 DOI 添加');await until('!!document.querySelector("[role=dialog]")','metadata dialog')
 evidence.isolated=await js('({inert:document.querySelector("#root").inert,focused:document.querySelector("[role=dialog]").contains(document.activeElement),dialogs:document.querySelectorAll("[role=dialog]").length})')
 assert.equal(evidence.isolated.inert,true);assert.equal(evidence.isolated.focused,true)
 press('F',['meta','shift']);await wait(100)
 assert.equal(await js('document.querySelector("[role=dialog]").contains(document.activeElement)'),true)
 await js("[...document.querySelectorAll('[role=dialog] button')].at(-1).focus()")
 press('Tab');await wait(60);assert.equal(await js('document.querySelector("[role=dialog]").contains(document.activeElement)'),true)
 press('Escape');await until('!document.querySelector("[role=dialog]")','escape closes dialog')
 evidence.focusRestored=await js('!document.querySelector("#root").inert&&document.activeElement.getAttribute("aria-label")==="更多文集操作"');assert.equal(evidence.focusRestored,true)
 // Enter submits once; changing focus afterward cannot create a second collection.
 await js('document.querySelector("button[aria-label=新建集合]").click()')
 await input('input[aria-label="集合名称"]','M5 fixture collection');await js('document.querySelector("input[aria-label=集合名称]").focus()');press('Return')
 await until('!document.querySelector(".collection-form")','collection committed')
 await js('document.querySelector("input[aria-label=搜索文集]").focus()');await wait(100)
 evidence.collections=await js('window.jian.collections.list()');assert.equal(evidence.collections.data.filter(c=>c.name==='M5 fixture collection').length,1)
 // Checkbox space does not select a different row or scroll the list.
 const created=await js(`window.jian.m4.doiCommit({title:'Another fixture',type:'journalArticle',date:null,language:null,fields:{},creators:[]})`);assert.equal(created.ok,true)
 // Refresh through an existing navigation control.
 await click('最近添加');await until('document.querySelectorAll(".row").length===2','second fixture visible')
 await js('(()=>{const r=[...document.querySelectorAll(".row")];r[0].click();r[1].querySelector("input").focus()})()');press('Space');await wait(100)
 evidence.selection=await js('({current:[...document.querySelectorAll(".row")].findIndex(r=>r.getAttribute("aria-current")==="true"),checked:document.querySelectorAll(".row-check:checked").length})');assert.deepEqual(evidence.selection,{current:0,checked:1})
 await click('清空选择');assert.equal(await js('document.querySelectorAll(".row-check:checked").length'),0)
 // Delay first search to prove stale responses cannot overwrite the second query.
 const item=await js('window.jian.library.list({}).then(r=>r.data.items[0])')
 ipcMain.removeHandler('m4:search');ipcMain.handle('m4:search',async(_event,p)=>{await wait(p.query==='slow'?700:20);return {ok:true,data:{groups:[{itemId:item.id,title:p.query,hits:[{id:p.query,itemId:item.id,title:p.query,kind:'metadata',snippet:p.query,marks:[],pageIndex:null,documentVersionId:null,annotationId:null,anchor:null}]}],nextCursor:null,pendingMetadata:0,limitedScan:false}}})
 await input('input[aria-label="搜索文集"]','slow');await wait(300)
 await input('input[aria-label="搜索文集"]','fast');assert.equal(await js('document.querySelectorAll(".search-hit").length'),0)
 await until('document.querySelector(".search-hit")?.textContent.includes("fast")','new query result')
 await wait(700);evidence.latestQuery=await js('document.querySelector(".search-group h3").textContent');assert.equal(evidence.latestQuery,'fast')
 await input('input[aria-label="搜索文集"]','');await until('!!document.querySelector(".row")','clear search')
 // Export failure should leave an actionable error, never an endless loading label.
 ipcMain.removeHandler('m4:exportPreview');ipcMain.handle('m4:exportPreview',()=>({ok:false,error:{code:'FIXTURE',message:'M5 fixture preview failure',retryable:true}}))
 await click('引用与导出');await until('document.querySelector("[role=dialog]")?.textContent.includes("M5 fixture preview failure")','visible export error')
 assert.equal(await js('document.querySelector("[role=dialog]").textContent.includes("正在生成预览…")'),false)
 assert.equal(await js('[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent==="保存文件").disabled'),true)
 press('Escape');await until('!document.querySelector("[role=dialog]")','export closes')
 // Zotero dialog uses the same focus isolation; detection is mocked before it opens.
 ipcMain.removeHandler('zotero:detect');ipcMain.handle('zotero:detect',()=>({ok:true,data:{exists:false,dbPath:join(root,'not-present.sqlite'),running:false}}))
 await click('从 Zotero 导入');await until('document.querySelector("[role=dialog]")?.textContent.includes("未找到 Zotero 文集")','mocked Zotero blocked state')
 assert.equal(await js('document.querySelector("#root").inert'),true);press('Escape');await until('!document.querySelector("[role=dialog]")','Zotero closes')
 // Capture actual light/dark and narrow layout evidence, not static mockups.
 for(const theme of ['light','dark']){await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await wait(80);fs.writeFileSync(join(root,'library-'+theme+'.png'),(await require('./native-capture.cjs')(win)).toPNG())}
 win.setMinimumSize(520,400);win.setSize(700,760);await wait(100);await click('查看详情');await until('document.querySelector(".detail").getAttribute("data-compact-open")==="true"&&getComputedStyle(document.querySelector(".detail")).display!=="none"','compact detail open')
 evidence.compact=await js('(()=>{const d=document.querySelector(".detail").getBoundingClientRect();return {left:d.left,right:d.right,width:innerWidth}})()');assert.ok(evidence.compact.left>=0&&evidence.compact.right<=evidence.compact.width)
 await wait(180);fs.writeFileSync(join(root,'library-compact.png'),(await require('./native-capture.cjs')(win)).toPNG());await click('返回文献列表');await wait(120);fs.writeFileSync(join(root,'library-compact-list.png'),(await require('./native-capture.cjs')(win)).toPNG())
 fs.writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log('[M5 UI PASS]',JSON.stringify({modalIsolation:true,focusRestored:true,collectionCount:1,checkboxIsolated:true,latestQuery:evidence.latestQuery,exportFailureVisible:true,compactBounds:true}));app.quit()
}
run().catch(async e=>{console.error('[M5 UI FAIL]',e);if(win){console.error(await win.webContents.executeJavaScript('document.body.innerText'));fs.writeFileSync(join(root,'failure.png'),(await require('./native-capture.cjs')(win)).toPNG())}app.exit(1)})
