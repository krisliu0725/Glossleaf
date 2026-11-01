// UI evidence uses only a synthetic PDF and explicitly isolated metadata fixtures.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),{join,resolve}=require('node:path'),assert=require('node:assert/strict')
const root=resolve(process.env.JIAN_TEST_ROOT||'/tmp/jian-library-layout');fs.mkdirSync(root,{recursive:true});app.setPath('userData',join(root,'app-data'));process.env.JIAN_LIBRARY_DIR=join(root,'library');process.env.JIAN_VIEW='library'
const fixture=join(root,'fixture.pdf');require('./make-fixture.cjs')(fixture);process.env.JIAN_IMPORT=fixture
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win
async function run(){require('../out/main/index.js');await app.whenReady();for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows().find(w=>w.isVisible());if(win&&!win.webContents.isLoading())break;await wait(100)}assert.ok(win)
 const js=s=>win.webContents.executeJavaScript(s),until=async(s,label)=>{for(let i=0;i<150;i++){if(await js(s))return;await wait(100)}throw Error(label)}
 const click=text=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.closest('[inert]'));if(!b)throw Error('missing '+${JSON.stringify(text)});b.click()})()`)
 const input=value=>js(`(()=>{const e=document.querySelector('input[aria-label=搜索文集]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 const press=key=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:key});win.webContents.sendInputEvent({type:'keyUp',keyCode:key})}
 await until('!!document.querySelector(".row")','library ready');await until('window.jian.m4.indexStats().then(r=>r.ok&&r.data.completed===1)','index ready')
 await js(`(async()=>{const titles=['制度变迁与政治秩序：比较研究的证据','能源转型中的治理与协作','历史制度主义：研究路径与方法','全球气候治理中的集体行动','公共政策过程中的知识与解释','城市更新与地方治理','数字时代的社会关系','国际关系中的规范与实践','比较政治学中的因果机制','学术研究的设计与论证','国家能力与制度选择','组织学习和政策扩散'];for(let i=0;i<titles.length;i++)await window.jian.m4.doiCommit({title:titles[i],type:'journalArticle',date:String(2025-i%4),language:'zh',fields:{publicationTitle:'研究札记 · 界面测试'},creators:[{nameMode:'person',familyName:'测试作者',givenName:String(i+1),literalName:null,role:'author',order:0}]})})()`)
 win.webContents.reload();await until('document.querySelectorAll(".row").length===13','fixtures refreshed');await click('最近添加');await until('document.querySelectorAll(".row").length===13','fixtures visible');await js("[...document.querySelectorAll('.row')].find(r=>r.querySelector('.row__title').textContent==='fixture').click()");await until('document.querySelector(".detail__title")?.textContent==="fixture"','fixture detail');await wait(1600)
 const evidence={kind:'synthetic UI fixtures',layout:{}}
 for(const [name,width,height,theme]of [['light',1280,820,'light'],['dark',1280,820,'dark'],['narrow',900,720,'light']]){
  win.setSize(width,height);win.webContents.sendInputEvent({type:'mouseMove',x:10,y:10});await js(`window.jian.preferences.set({theme:${JSON.stringify(theme)}})`);await wait(180)
  evidence.layout[name]=await js(`(()=>{const p=document.querySelector('.list-pane').getBoundingClientRect(),l=document.querySelector('.list').getBoundingClientRect();return {paneWidth:p.width,topSpace:l.top-p.top,listHeight:l.height,overflow:document.body.scrollWidth>innerWidth+1,headerOverflow:document.querySelector('.list-pane__header').scrollWidth>document.querySelector('.list-pane__header').clientWidth+1}})()`)
  fs.writeFileSync(join(root,'library-'+name+'.png'),(await require('./native-capture.cjs')(win)).toPNG())
 }
 if(process.env.JIAN_LAYOUT_BEFORE!=='1'){
  for(const x of Object.values(evidence.layout)){assert.ok(x.topSpace<=105,'compact header');assert.equal(x.overflow,false);assert.equal(x.headerOverflow,false)}
  win.setSize(1280,820);await js("document.querySelector('button[aria-label=更多文集操作]').click()");await until('!!document.querySelector(".library-menu")','actions open');await click('通过 DOI 添加');await until('!!document.querySelector("[role=dialog]")','DOI opens');assert.equal(await js('document.querySelector("#root").inert'),true);await click('关闭');await until('!document.querySelector("[role=dialog]")','closed');assert.equal(await js('document.activeElement.getAttribute("aria-label")'), '更多文集操作')
  await input('river');await until('!!document.querySelector(".search-hit")','search source text');await js("(()=>{document.querySelector('button[aria-label=搜索范围]').click();[...document.querySelectorAll('.floating-menu button')].find(b=>b.textContent.trim()==='正文').click()})()");await until('!!document.querySelector(".search-hit[data-kind=body]")','body scope');fs.writeFileSync(join(root,'library-search.png'),(await require('./native-capture.cjs')(win)).toPNG())
  await js("document.querySelector('button[aria-label=清空搜索]').click()");await until('document.querySelectorAll(".row").length===13','clear returns list');assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'搜索文集')
  await js("document.querySelector('button[aria-label=全文索引状态]').click()");await until('!!document.querySelector("[role=dialog]")','index dialog');assert.ok(await js('document.querySelector("[role=dialog]").innerText.includes("2 页")'));await click('关闭')
  await js("document.querySelector('button[aria-label=更多文集操作]').focus();document.querySelector('button[aria-label=更多文集操作]').click()");press('Escape');await until('!document.querySelector(".library-menu")','menu escape');assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'更多文集操作')
  evidence.interactions='PASS: DOI/focus, scope search, clear/focus, index dialog, menu Escape'
 }
 fs.writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log('[LIBRARY LAYOUT PASS]',JSON.stringify(evidence));app.quit()
}
run().catch(async e=>{console.error('[LIBRARY LAYOUT FAIL]',e);if(win){console.error(await win.webContents.executeJavaScript('document.body.innerText'));fs.writeFileSync(join(root,'failure.png'),(await require('./native-capture.cjs')(win)).toPNG())}app.exit(1)})
