// Native regression of redesign v2, isolated fixtures and local mock model only.
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('node:fs'),{join,resolve}=require('node:path'),assert=require('node:assert/strict'),http=require('node:http')
const root=resolve(process.env.JIAN_TEST_ROOT||'/tmp/jian-redesign-060');fs.mkdirSync(root,{recursive:true})
app.setPath('userData',join(root,'app-data'));process.env.JIAN_LIBRARY_DIR=join(root,'library');process.env.JIAN_VIEW='library'
const fixture=join(root,'fixture.pdf');require('./make-fixture.cjs')(fixture);process.env.JIAN_IMPORT=fixture
let win,server,calls=0;const evidence={screens:[],checks:[],layouts:[],residuals:{},realCloudCalls:false}
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function run(){
 server=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;calls++;const input=JSON.parse(text),payload=JSON.parse(input.messages.find(m=>m.role==='user').content),source=payload.translate,slots=source.match(/⟦P\d+⟧/g)||[];res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'研究应将证据与审慎解释相联系。段落对应帮助读者在原文与译文之间保持连续的阅读体验。'+slots.join(' ')},finish_reason:null}]})+'\n\n');await wait(60);res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n')})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 require('../out/main/index.js');await app.whenReady()
 for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows().find(w=>w.isVisible());if(win&&!win.webContents.isLoading())break;await wait(100)}
 assert.ok(win)
 const js=s=>win.webContents.executeJavaScript(s),evalFn=(fn,...args)=>js('('+fn.toString()+')(...'+JSON.stringify(args)+')')
 const until=async(s,label)=>{for(let i=0;i<180;i++){if(await js(s))return;await wait(100)}throw Error(label)}
 const click=text=>evalFn(text=>{const b=[...document.querySelectorAll('button')].find(b=>(()=>{const clone=b.cloneNode(true);clone.querySelectorAll('.sidebar__count,kbd').forEach(n=>n.remove());return clone.textContent.trim()===text})()&&!b.closest('[inert]'));if(!b)throw Error('missing '+text);b.click()},text)
 const aria=text=>evalFn(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===text&&!b.closest('[inert]'));if(!b)throw Error('missing aria '+text);b.click()},text)
 const shot=async name=>{await wait(160);fs.writeFileSync(join(root,name+'.png'),(await require('./native-capture.cjs')(win)).toPNG());evidence.screens.push(name)}
 const layout=async name=>{const r=await js('({name:'+JSON.stringify(name)+',width:innerWidth,bodyOverflow:document.body.scrollWidth>innerWidth+1,headerOverflow:document.querySelector("header.toolbar").scrollWidth>document.querySelector("header.toolbar").clientWidth+1})');evidence.layouts.push(r);assert.equal(r.bodyOverflow,false,name+' body');assert.equal(r.headerOverflow,false,name+' header')}
 const residual=async name=>{const list=await evalFn(()=>{const root=document.querySelector('[role=dialog][aria-modal=true]')??document.querySelector('#root'),w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),a=[];while(w.nextNode()){const n=w.currentNode,p=n.parentElement;if(/[\u3400-\u9fff]/.test(n.textContent)&&(p.getClientRects().length||p.matches('option'))&&!p.closest('[inert],.translation-body,.user-note,.selection-quote,.detail__title,.row__title,.row__meta,.detail__meta,.reader-title,.tag')&&n.textContent.trim()!=='中文')a.push(n.textContent.trim())}return a});evidence.residuals[name]=list;assert.deepEqual(list,[],name+' untranslated UI')}
 await until('!!document.querySelector(".row")','library')
 const config={kind:'compatible',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',model:'local-redesign-fixture',targetLanguage:'zh-CN',consent:false}
 assert.equal((await evalFn(c=>window.jian.m3.configure(c),config)).ok,true)
 await js('(async()=>{for(let i=0;i<15;i++)await window.jian.m4.doiCommit({title:"Reading, evidence and interpretation "+String(i+1).padStart(2,"0"),type:"journalArticle",date:String(2026-i%4),language:"en",fields:{publicationTitle:"Journal of Reading Studies",abstractNote:"A synthetic abstract for verifying compact layouts and source preservation."},creators:[{nameMode:"person",familyName:"Example",givenName:"Author "+(i+1),literalName:null,role:"author",order:0}]})})()')
 win.webContents.reload();await until('document.querySelectorAll(".row").length===16','seeded library')
 await layout('library-zh-1280');await shot('library-zh')
 const row=await js('document.querySelector(".row").getBoundingClientRect().height');assert.equal(row,56)
 const listHeight=await js('document.querySelector(".list").clientHeight');assert.ok(Math.floor(listHeight/row)>=10)
 assert.equal(await js('!!document.querySelector("header .locale-switch")'),false)
 await until('window.jian.m4.indexStats().then(r=>r.ok&&!r.data.running)','index complete')
 await until('!document.querySelector(".library-index-status")','index status settles')
 await js('document.querySelector(".row").click()');await until('!!document.querySelector(".detail__title")','detail');assert.equal(await js('document.querySelectorAll(".detail__actions>.btn--primary").length'),1)
 // Soft-delete and restore the selected metadata-only document through actual UI.
 await aria('文献操作');await click('移入回收站');await until('document.querySelectorAll(".row").length===15','trashed')
 await click('回收站');await until('document.querySelectorAll(".row").length===1','trash list');await until('!!document.querySelector(".detail__actions .btn--primary")','trash detail');await click('恢复文献');await until('document.querySelectorAll(".row").length===0','restored out of trash');await click('全部文献');await until('document.querySelectorAll(".row").length===16','all restored')
 evidence.checks.push('56px rows and at least ten visible','complete index status hidden','one primary detail action','soft delete and restore actual UI')
 // Settings, five sections, language selection only in General.
 await aria('文房 · 设置 ⌘,');await until('!!document.querySelector(".settings-layout")','settings')
 await shot('settings-zh');await click('EN');await until('document.documentElement.lang==="en"','English')
 await residual('settings-general');await shot('settings-en')
 for(const tab of ['Reading & Appearance','Translation','Library & Backup','Advanced & Diagnostics']){await click(tab);await residual('settings-'+tab);await layout('settings-'+tab)}
 await click('Translation');await until('!!document.querySelector("#provider-settings")','provider loaded');await residual('provider-loaded');assert.equal(await js('window.jian.preferences.get().then(r=>r.data.reader.autoTranslate)'),false);assert.equal(calls,0)
 await click('Manage glossary');await until('document.querySelectorAll("[role=dialog]").length===2','glossary');await residual('glossary');await click('Close');await click('General');await click('中文');await click('关闭')
 // Real Dashboard route preserved, separate from list views.
 await click('小传');await until('!!document.querySelector(".dash-main")','dashboard');await shot('dashboard-zh');await click('‹ 书府');await until('!!document.querySelector(".row")','back to library')
 // Open the actual PDF fixture from its row.
 const pdfItem=await js('window.jian.library.list({limit:100}).then(r=>r.data.items.find(i=>i.hasPdf))')
 await evalFn(id=>{const row=[...document.querySelectorAll('.row')].find(r=>r.querySelector('.row__title').textContent===id);row.click()},pdfItem.title)
 await until('document.querySelector(".detail__title")?.textContent==='+JSON.stringify(pdfItem.title),'PDF detail');await click('阅读');await until('!!document.querySelector(".paragraph-markers button")','reader')
 await layout('reader-source-1280');assert.equal(await js('[...document.querySelector(".reader-toolbar").children].filter(e=>e.tagName!=="SPAN").length'),6);await shot('reader-source')
 const centered=await js('(()=>{const pane=document.querySelector(".reader__pane--source").getBoundingClientRect(),page=document.querySelector(".pdf-page-host").getBoundingClientRect();return Math.abs((page.left+page.right)/2-(pane.left+document.querySelector(".reader__pane--source").clientWidth/2))})()');assert.ok(centered<3,'source centered')
 assert.equal(await js('!!document.querySelector(".reader-side")'),false)
 assert.equal(await js('!!document.querySelector(".reader-toolbar .locale-switch")'),false)
 assert.equal(await js('!!document.querySelector(".reader-toolbar select")'),false)
 await click('对读');await until('!!document.querySelector(".gloss-block")','parallel')
 assert.equal(await js('document.querySelectorAll(".source-preview").length'),0)
 assert.equal(await js('document.querySelectorAll(".pdf-active-rect").length'),0)
 assert.equal(await js('getComputedStyle(document.querySelector(".gloss-placeholder>button")).opacity'),'0')
 await shot('reader-parallel-untranslated');await click('翻译本页');await until('document.querySelectorAll(".gloss-block .translation-body").length>=3&&!document.querySelector(".translation-progress")','translated')
 await js('document.querySelector(".paragraph-markers button").click()');await wait(250)
 await shot('reader-parallel-zh');await layout('reader-parallel-1280')
 assert.equal(await js('document.querySelector(".gloss-page-action .btn")===null'),true)
 assert.equal(await js('getComputedStyle(document.querySelector(".gloss-block.kind-body .translation-body")).fontSize'),'16px')
 assert.equal(await js('getComputedStyle(document.querySelector(".gloss-block.kind-body .translation-body")).lineHeight'),'28px')
 assert.ok(await js('!!document.querySelector(".pdf-block-active")'))
 // Edit a real translated block, preserve it after reload; manual corrections saved in library DB.
 await js('document.querySelector(".gloss-block").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:800,clientY:200}))');await click('编辑译文')
 await evalFn(text=>{const e=document.querySelector('.note-editor');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,text);e.dispatchEvent(new Event('input',{bubbles:true}))},'用户核对后的译文。')
 await click('保存');await until('!!document.querySelector(".gloss-edited")','edited saved')
 const version=await js('window.jian.library.get('+JSON.stringify(pdfItem.id)+').then(r=>r.data.documents[0].activeVersionId)')
 const rd=await evalFn(v=>window.jian.m3.readerData(v),version);assert.equal(rd.ok,true);assert.ok(Object.values(rd.data.edits).some(e=>e.text==='用户核对后的译文。'))
 evidence.checks.push('PDF centered in source mode','language and zoom removed from toolbar','translation-only flow','zero red rectangles','hover-only paragraph actions','single translation state action','16/28 gloss typography','user translation persisted in library DB')
 // Keyboard selection actions: real source range -> excerpt and note.
 await js('(()=>{const span=[...document.querySelectorAll(".textLayer span")].find(s=>s.textContent.includes("river bank")),node=span.firstChild,range=document.createRange();range.setStart(node,2);range.setEnd(node,20);getSelection().removeAllRanges();getSelection().addRange(range);span.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}))})()')
 await until('!!document.querySelector(".selection-toolbar")','selection toolbar')
 await aria('保存摘录 · ⌘E');await until('!document.querySelector(".selection-toolbar")','excerpt saved');await js('getSelection().removeAllRanges()');await click('撷英');await until('!!document.querySelector(".annotation-list article")','excerpt shown');await shot('excerpts-zh')
 // Switch via settings, preserve target language and excerpt content.
 await aria('阅读选项');await click('文房');await click('EN');await click('Close');await residual('reader-excerpts')
 await click('Gloss');await residual('reader-gloss');await shot('reader-en')
 for(const width of [900,1280]){win.setSize(width,820);await wait(200);await layout('reader-en-'+width);assert.ok(await js('document.querySelector(".reader__pane--source").scrollWidth<=document.querySelector(".reader__pane--source").clientWidth+1'));await shot('reader-en-'+width)}
 await evalFn(()=>window.jian.preferences.set({theme:'dark'}));await wait(250);await shot('reader-en-dark')
 await aria('Reading options');await click('Settings');await click('Reading & Appearance');await residual('reading-dark')
 await click('Translation');await evalFn(()=>{const input=[...document.querySelectorAll('.settings-checkbox input')].find(e=>e.parentElement.textContent.includes('Enable experimental'));input.click()});await until('window.jian.preferences.get().then(r=>r.data.reader.inlineEnabled)','inline enabled saved');await until('![...document.querySelectorAll("button")].find(b=>b.textContent==="Close").disabled','settings ready to close');await click('Close');await until('!document.querySelector("[role=dialog][aria-modal=true]")','settings closed')
 await aria('Reading options');await click('Interlinear · Experimental');await until('!!document.querySelector(".inline-page")','interlinear retained');await shot('interlinear-en')
 await click('Original');await click('‹ Library');await until('!!document.querySelector(".row")','English library');await residual('library-en');await shot('library-en-dark')
 await evalFn(()=>window.jian.preferences.set({theme:'light'}));await wait(200);await shot('library-en')
 win.setSize(900,720);await wait(100);await layout('library-en-900');await shot('library-en-900')
 await click('Memoir');await until('!!document.querySelector(".dash-main")','English dashboard');await residual('dashboard-en');await shot('dashboard-en')
 assert.equal((await js('window.jian.m3.settings()')).data.targetLanguage,'zh-CN')
 win.webContents.reload();await until('document.documentElement.lang==="en"&&!!document.querySelector(".library-topbar")','reload language')
 const edits=await evalFn(v=>window.jian.m3.readerData(v),version);assert.deepEqual(edits.data,rd.data)
 evidence.calls=calls;evidence.checks.push('selection excerpt actual anchors','five settings sections localized','Dashboard preserved','interlinear gated in Settings','locale survives reload','edited translation survives reload','target language unchanged')
 fs.writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log('[REDESIGN PASS]',JSON.stringify(evidence));server.close();app.quit()
}
run().catch(async e=>{console.error('[REDESIGN FAIL]',e);if(win){try{console.error(await win.webContents.executeJavaScript('document.body.innerText'));fs.writeFileSync(join(root,'failure.png'),(await require('./native-capture.cjs')(win)).toPNG())}catch{}}server?.close();app.exit(1)})
