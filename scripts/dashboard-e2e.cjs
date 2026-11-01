const {app,BrowserWindow,dialog}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),{join,resolve}=require('node:path')
const root=resolve(process.env.JIAN_TEST_ROOT||'/tmp/jian-dashboard');fs.mkdirSync(root,{recursive:true});app.setPath('userData',join(root,'app-data'));process.env.JIAN_LIBRARY_DIR=join(root,'library');process.env.JIAN_VIEW='dashboard'
let output=join(root,'usage-export.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:output})
let win;const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function run(){
 require('../out/main/index.js');await app.whenReady()
 for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows().find(w=>w.isVisible());if(win&&!win.webContents.isLoading())break;await wait(100)}assert.ok(win)
 const js=s=>win.webContents.executeJavaScript(s),until=async(s,label)=>{for(let i=0;i<150;i++){if(await js(s))return;await wait(100)}throw Error(label)}
 const click=text=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.closest('[inert]'));if(!b)throw Error('missing button '+${JSON.stringify(text)});b.click()})()`)
 await until('!!document.querySelector(".dash-metrics")','dashboard ready')
 const evidence={snapshot:await js("window.jian.analytics.snapshot({range:'30',timezone:'Asia/Shanghai'})")};assert.equal(evidence.snapshot.ok,true)
 const seeded=process.env.JIAN_DASHBOARD_SEEDED==='1'
 if(seeded){assert.ok(evidence.snapshot.data.reading.activeMs>0);assert.ok(evidence.snapshot.data.tokens.unknownAttempts>0);assert.ok(evidence.snapshot.data.tokens.totalTokens>0);assert.ok(evidence.snapshot.data.topics.some(t=>t.basis==='confirmed'))}
 else {assert.equal(evidence.snapshot.data.reading.activeMs,0);assert.equal(evidence.snapshot.data.tokens.totalTokens,null);assert.ok(await js('document.body.innerText.includes("还没有研究方向")'))}
 await until('!!document.querySelector(".heatmap__cell")','heatmap ready');assert.ok(await js('document.querySelectorAll(".heatmap__cell[data-state=outside]").length>0'));await wait(180);fs.writeFileSync(join(root,'dashboard-light.png'),(await require('./native-capture.cjs')(win)).toPNG())
 await click('日课');if(!seeded)assert.ok(await js('document.body.innerText.includes("从一篇文献开始")'));await js("(()=>{const e=document.querySelector('select[aria-label=统计时间范围]');e.value='7';e.dispatchEvent(new Event('change',{bubbles:true}))})()");await until('!!document.querySelector(".heatmap__cell")&&!document.querySelector(".dash-main").matches("[aria-busy=true]")','7-day reading ready');evidence.readingWeeks=await js('getComputedStyle(document.querySelector(".heatmap__grid")).gridTemplateColumns.split(" ").length');assert.ok(evidence.readingWeeks<=2);await js("(()=>{const e=document.querySelector('select[aria-label=统计时间范围]');e.value='30';e.dispatchEvent(new Event('change',{bubbles:true}))})()");await until('!!document.querySelector(".heatmap__cell")&&!document.querySelector(".dash-main").matches("[aria-busy=true]")','30-day reading ready');await click('用度');await until('!!document.querySelector(".dash-usage-summary")','model detail')
 evidence.modelText=await js('document.querySelector(".dash-main").innerText');assert.ok(evidence.modelText.includes('未回传请求'));assert.ok(evidence.modelText.includes('暂无账单数据'))
 fs.writeFileSync(join(root,'dashboard-models.png'),(await require('./native-capture.cjs')(win)).toPNG())
 await click('志趣');if(seeded)assert.ok(await js('document.body.innerText.includes("所属领域")&&document.body.innerText.includes("政治学")'));await wait(100);fs.writeFileSync(join(root,'dashboard-research.png'),(await require('./native-capture.cjs')(win)).toPNG());await click('编辑分类');await until('!!document.querySelector("[role=dialog]")','classification dialog')
 evidence.modalInert=await js('document.querySelector("#root").inert');assert.equal(evidence.modalInert,true)
 if(seeded){await until(`!!document.querySelector('.m3-form input[placeholder^=例如]')?.value`,'classification loaded');const value=await js('document.querySelector("select[aria-label=分类文献]").value');await click('保存分类');await until('!document.querySelector("[role=dialog]")','classification saved');evidence.classification=await js(`window.jian.analytics.classifications(${JSON.stringify(value)})`);assert.equal(evidence.classification.ok,true);assert.ok(evidence.classification.data.topics.length>0)}else await click('关闭');if(seeded){const label=await js('document.querySelector(".dash-topic__name").childNodes[0].textContent');await js('document.querySelector(".dash-topic .topic-open").click()');await until('!!document.querySelector(".search-hit[data-kind=metadata]")','confirmed topic resolves to actual library item');evidence.topicSearch=await js('document.querySelector("input[aria-label=搜索文集]").value');assert.equal(evidence.topicSearch,label);await click('小传')}await click('卷首')
 await until('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="导出完整数据"&&!b.disabled)','export enabled');await click('导出完整数据');for(let i=0;i<50&&!fs.existsSync(output);i++)await wait(100);assert.ok(fs.existsSync(output));const exported=JSON.parse(fs.readFileSync(output,'utf8'));assert.ok(Array.isArray(exported.attempts));evidence.exportRows=exported.attempts.length
 await click('文房');await until('!!document.querySelector("[role=dialog]")','preferences')
 await js("(()=>{const s=document.querySelector('select[aria-label=显示主题]');s.value='dark';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
 await until('document.documentElement.dataset.theme==="dark"','dark theme')
 await click('关闭');await js("document.querySelector('button[aria-label=关闭提示]')?.click()");await wait(180);fs.writeFileSync(join(root,'dashboard-dark.png'),(await require('./native-capture.cjs')(win)).toPNG())
 win.setMinimumSize(560,500);win.setSize(760,800);await wait(180);fs.writeFileSync(join(root,'dashboard-narrow.png'),(await require('./native-capture.cjs')(win)).toPNG())
 evidence.navigation=await js('({nav:document.querySelector(".dash-sidebar").getBoundingClientRect().width,viewport:innerWidth,buttons:[...document.querySelectorAll(".dash-sidebar>.sidebar__row")].map(b=>({right:b.getBoundingClientRect().right,text:b.innerText}))})');assert.ok(Math.abs(evidence.navigation.nav-evidence.navigation.viewport)<2);assert.ok(evidence.navigation.buttons.every(b=>b.right<=evidence.navigation.viewport));
 evidence.overflow=await js('({page:document.querySelector(".dash-main").scrollWidth>document.querySelector(".dash-main").clientWidth+1,body:document.body.scrollWidth>innerWidth+1})');assert.equal(evidence.overflow.body,false);assert.equal(evidence.overflow.page,false)
 win.setSize(1280,820);await click('文房');await click('查看诊断');await until('!!document.querySelector(".preferences-diagnostics")','diagnostics')
 evidence.diagnostics=await js('window.jian.preferences.diagnostics()');assert.equal(evidence.diagnostics.data.schemaVersion,4);assert.ok(!JSON.stringify(evidence.diagnostics).includes('api.deepseek.com'))
 const original=(await js('window.jian.analytics.settings()')).data.enabled
 await js("document.querySelector('.provider-consent input').click()")
 await until(`window.jian.analytics.settings().then(r=>r.data.enabled===${!original})`,'toggle usage')
 await js("document.querySelector('.provider-consent input').click()")
 await until(`window.jian.analytics.settings().then(r=>r.data.enabled===${original})`,'restore usage toggle')
 await click('清除使用统计');assert.ok(await js('document.body.innerText.includes("确认清除统计")'));await click('保留统计')
 await click('关闭')
 evidence.preferences=await js('window.jian.preferences.get()');assert.equal(evidence.preferences.data.theme,'dark')
 fs.writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log('[DASHBOARD PASS]',JSON.stringify({seeded,readMs:evidence.snapshot.data.reading.activeMs,tokens:evidence.snapshot.data.tokens.totalTokens,unknown:evidence.snapshot.data.tokens.unknownAttempts,overflow:evidence.overflow}));app.quit()
}
run().catch(async e=>{console.error('[DASHBOARD FAIL]',e);if(win){console.error('[DOM]',await win.webContents.executeJavaScript('document.body.innerText'));fs.writeFileSync(join(root,'failure.png'),(await require('./native-capture.cjs')(win)).toPNG())}app.exit(1)})
