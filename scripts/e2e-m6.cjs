const {app,BrowserWindow}=require('electron')
const {createServer}=require('node:http')
const {join,resolve}=require('node:path')
const fs=require('node:fs')
const assert=require('node:assert/strict')
const root=resolve(process.env.JIAN_TEST_ROOT||'../../work/m6-e2e')
fs.mkdirSync(root,{recursive:true});app.setPath('userData',join(root,'app-data'))
process.env.JIAN_LIBRARY_DIR=join(root,'library');process.env.JIAN_VIEW='reader'
const fixture=join(root,'fixture.pdf');require('./make-fixture.cjs')(fixture);process.env.JIAN_IMPORT=fixture
const rotated=process.env.JIAN_TEST_VARIANT==='rotate'
const cropOnly=process.env.JIAN_TEST_VARIANT==='crop'
if(cropOnly){const raw=fs.readFileSync(fixture,'utf8'),objects=[...raw.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)],offsets=[0];let out='%PDF-1.4\n';for(const match of objects){const id=Number(match[1]);offsets[id]=Buffer.byteLength(out);out+=`${id} 0 obj\n${match[2].replace('/MediaBox [0 0 612 792]','/MediaBox [0 0 612 792] /CropBox [10 15 602 782]')}\nendobj\n`}const pos=Buffer.byteLength(out);out+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`;for(let i=1;i<offsets.length;i++)out+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';out+=`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;fs.writeFileSync(fixture,out)}
let longResponse=true
const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
 if(req.method==='GET'){res.end(JSON.stringify({data:[{id:'fixture'}]}));return}
 const b=JSON.parse(body),payload=JSON.parse(b.messages.at(-1).content),slots=(payload.translate.match(/⟦P\d+⟧/g)||[]).join(' ')
 const first=longResponse?'测试译文：一段较长的中文译文，用于检查原段落之后的行间布局以及滚动锚点稳定性。'.repeat(32):'学术阅读：一项可复现的研究。研究设计将证据与审慎的解释联系起来。逐段阅读时，原文与译文保持各自的版面和选区，并共享同一个原文锚点。'
 res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:first.slice(0,400)},finish_reason:null}]})+'\n\n')
 setTimeout(()=>res.end('data: '+JSON.stringify({choices:[{delta:{content:first.slice(400)+' '+slots},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'),100)
})})
const wait=ms=>new Promise(r=>setTimeout(r,ms))

function layoutSnapshot(){
 const box=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}
 const luminance=rgb=>{const v=rgb.slice(0,3).map(n=>{const c=n/255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4)});return v[0]*.2126+v[1]*.7152+v[2]*.0722}
 const rgb=value=>(value.match(/[\d.]+/g)||[]).map(Number)
 const contrast=(color,background)=>{const a=luminance(rgb(color)),b=luminance(rgb(background));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
 const tools=document.querySelector('.inline-mode-tools'),status=tools.querySelector('[role=status]'),description=tools.querySelector('span:first-child'),range=document.createRange();range.selectNodeContents(status)
 const controls=[...document.querySelectorAll('.reader-toolbar button,.reader-toolbar select,.reader-toolbar input,.inline-mode-tools button')].map(el=>({text:el.textContent||el.getAttribute('aria-label'),...box(el)})).filter(r=>r.width&&r.height)
 const overlaps=[];for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push([a.text,b.text])}
 const insertion=document.querySelector('.inline-insertion'),body=insertion.querySelector('.translation-body'),marker=document.querySelector('.inline-paragraph-marker'),style=getComputedStyle(insertion),m=getComputedStyle(marker)
 return {viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme,documentWidth:document.documentElement.scrollWidth,tools:{...box(tools),scrollWidth:tools.scrollWidth,clientWidth:tools.clientWidth,scrollHeight:tools.scrollHeight,clientHeight:tools.clientHeight},status:{...box(status),scrollWidth:status.scrollWidth,clientWidth:status.clientWidth,textRects:[...range.getClientRects()].map(r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}))},description:box(description),controls,overlaps,marker:{...box(marker),color:m.color,background:m.backgroundColor,contrast:contrast(m.color,m.backgroundColor)},translation:{color:getComputedStyle(body).color,background:style.backgroundColor,surface:getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),contrast:contrast(getComputedStyle(body).color,style.backgroundColor)}}
}
async function checkLayout(js,label){
 const x=await js('('+layoutSnapshot.toString()+')()')
 assert.ok(x.documentWidth<=x.viewport.width+1,label+' application width stays within viewport')
 assert.ok(x.tools.scrollWidth<=x.tools.clientWidth+1,label+' inline tools have no horizontal overflow')
 assert.ok(x.tools.scrollHeight<=x.tools.clientHeight+1,label+' inline tools do not crop rows')
 for(const r of [...x.controls,x.status,x.description])assert.ok(r.left>=-1&&r.right<=x.viewport.width+1&&r.top>=-1&&r.bottom<=x.viewport.height+1,label+' control/status within viewport: '+r.text)
 for(const r of x.status.textRects)assert.ok(r.left>=x.status.left-1&&r.right<=x.status.right+1&&r.top>=x.tools.top-1&&r.bottom<=x.tools.bottom+1,label+' status text is fully painted')
 assert.equal(x.overlaps.length,0,label+' controls do not overlap')
 assert.ok(x.marker.left>=0&&x.marker.right<=x.viewport.width,label+' page margin translate control remains accessible')
 assert.ok(x.translation.contrast>=4.5,label+' translation text contrast')
 assert.ok(x.marker.contrast>=4.5,label+' page margin translate control contrast')
 return x
}

async function run(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port
 require('../out/main/index.js');await app.whenReady();let win
 for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript('!!document.querySelector(".m3-reader")').catch(()=>false))break;await wait(150)}
 if(!win)throw Error('window not created')
 const js=s=>win.webContents.executeJavaScript(s)
 for(let i=0;i<100;i++){if(await js('document.querySelectorAll(".textLayer span").length>10'))break;await wait(100)}
 const evidence={rotated,cropOnly}
 const config=await js(`window.jian.m3.configure({kind:'compatible',baseUrl:'http://127.0.0.1:${port}/v1',model:'fixture',targetLanguage:'zh-CN',consent:true})`);assert.equal(config.ok,true)
 await js("[...document.querySelectorAll('header button')].find(b=>b.textContent==='行间 · 实验').click()")
 for(let i=0;i<100;i++){if(await js(rotated?'document.querySelectorAll(".inline-fallback").length===2':'document.querySelectorAll(".inline-page[data-text-ready=true]").length===2'))break;await wait(100)}
 evidence.fallbackReasons=await js('[...document.querySelectorAll(".inline-fallback__reason")].map(x=>x.textContent)')
 if(rotated){assert.equal(evidence.fallbackReasons.length,2);assert.ok(evidence.fallbackReasons.every(s=>s.includes('旋转')));assert.ok(await js('document.querySelectorAll(".textLayer span").length>10'));fs.writeFileSync(join(root,'m6-rotation-fallback.png'),(await win.webContents.capturePage()).toPNG());fs.writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log('[M6 ROTATION FALLBACK PASS]');server.close();app.quit();return}
 assert.equal(evidence.fallbackReasons.length,0)
 evidence.inlinePages=await js('document.querySelectorAll(".inline-page[data-text-ready=true]").length');assert.equal(evidence.inlinePages,2)
 evidence.zeroTranslationPixels=await js(`(async()=>{const p=document.querySelector('.inline-page'),tiles=[...p.querySelectorAll('.inline-band>canvas')],width=tiles[0].width,height=tiles.reduce((n,c)=>n+c.height,0),c=document.createElement('canvas');c.width=width;c.height=height;const vp=p.pdfPage.getViewport({scale:1});await p.pdfPage.render({canvasContext:c.getContext('2d'),viewport:vp,transform:[width/vp.width,0,0,height/vp.height,0,0]}).promise;const expected=c.getContext('2d').getImageData(0,0,width,height).data;let y=0,differences=0;for(const tile of tiles){const pixels=tile.getContext('2d').getImageData(0,0,tile.width,tile.height).data;for(let i=0;i<pixels.length;i++)if(pixels[i]!==expected[y*width*4+i])differences++;y+=tile.height}return {differences,width,height,bytes:Number(p.dataset.rasterBytes)}})()`)
 assert.equal(evidence.zeroTranslationPixels.differences,0,'real PDF.js band source buffers recompose byte-exactly');assert.ok(evidence.zeroTranslationPixels.bytes<=48*1024*1024)
 // A source point below the first insertion must remain at the same screen position during streaming growth.
 evidence.beforeAnchor=await js(`(()=>{const pane=document.querySelector('.reader__pane--source');pane.scrollTop=200;const p=document.querySelector('.inline-page'),point=[60,300],mapped=p.pdfGeometry.fromSourcePoint(point);return {point,offset:p.getBoundingClientRect().top+mapped[1]-pane.getBoundingClientRect().top}})()`)
 await js("document.querySelector('.inline-paragraph-marker').click()")
 for(let i=0;i<100;i++){if(await js("document.querySelector('.inline-insertion .translation-body')?.textContent.length>1000"))break;await wait(100)}
 await wait(200)
 evidence.afterAnchor=await js(`(()=>{const pane=document.querySelector('.reader__pane--source'),p=document.querySelector('.inline-page'),mapped=p.pdfGeometry.fromSourcePoint([60,300]);return {offset:p.getBoundingClientRect().top+mapped[1]-pane.getBoundingClientRect().top,height:p.getBoundingClientRect().height,text:document.querySelector('.inline-insertion .translation-body').textContent.length,scrollTop:pane.scrollTop}})()`)
 assert.ok(evidence.afterAnchor.text>1000);assert.ok(Math.abs(evidence.afterAnchor.offset-evidence.beforeAnchor.offset)<2,'streaming translations preserve source point viewport offset')
 // Select a partial actual source span after insertion. Preserve exactly the selected text and the source rectangle.
 evidence.selection=await js(`(()=>{const span=[...document.querySelectorAll('.inline-page .textLayer span')].find(x=>x.textContent.includes('river bank')),node=span.firstChild,range=document.createRange();range.setStart(node,2);range.setEnd(node,20);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);span.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return {text:selection.toString(),rect:range.getBoundingClientRect().toJSON()}})()`)
 await wait(100);assert.equal(await js("document.querySelector('.selection-quote').textContent"),evidence.selection.text)
 await js("[...document.querySelectorAll('.selection-panel button')].find(b=>b.textContent==='高亮').click()")
 await wait(150)
 evidence.highlight=await js("document.querySelector('.inline-page .pdf-highlights span').getBoundingClientRect().toJSON()")
 assert.ok(Math.abs(evidence.highlight.y-evidence.selection.rect.y)<2&&Math.abs(evidence.highlight.x-evidence.selection.rect.x)<2,'inline selection inverse and highlight forward map agree')
 assert.ok(Math.abs(evidence.highlight.width-evidence.selection.rect.width)<2)
 await js("[...document.querySelectorAll('.selection-panel button')].find(b=>b.textContent==='关闭').click();getSelection().removeAllRanges()")
 // Cross-band partial selection must not inflate either end to a full paragraph.
 evidence.crossBand=await js(`(()=>{const spans=[...document.querySelectorAll('.inline-page:first-child .textLayer span')],first=spans.find(x=>x.textContent.includes('Academic Reading')),last=spans.find(x=>x.textContent.includes('river bank')),r=document.createRange();r.setStart(first.firstChild,9);r.setEnd(last.firstChild,20);const s=getSelection();s.removeAllRanges();s.addRange(r);last.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return {selected:s.toString(),source:document.querySelector('.selection-quote')?.textContent}})()`)
 await wait(100);evidence.crossBand.source=await js("document.querySelector('.selection-quote').textContent")
 assert.ok(evidence.crossBand.source.startsWith('Reading:'));assert.ok(!evidence.crossBand.source.startsWith('Academic'));assert.ok(evidence.crossBand.source.endsWith('A river bank is diff'),'partial endpoint retained')
 await js("[...document.querySelectorAll('.selection-panel button')].find(b=>b.textContent==='关闭').click();getSelection().removeAllRanges()")
 evidence.link=await js(`(()=>{const p=document.querySelectorAll('.inline-page')[1],link=p.querySelector('.pdf-link');const pdfRect=[50,520,220,545],vp=p.pdfPage.getViewport({scale:1}),a=vp.convertToViewportPoint(pdfRect[0],pdfRect[1]),b=vp.convertToViewportPoint(pdfRect[2],pdfRect[3]),rect=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])],mapped=p.pdfGeometry.fromSourceRect(rect)[0],actual=link.getBoundingClientRect(),host=p.getBoundingClientRect();return {href:link.href,delta:Math.abs(actual.left-host.left-mapped[0])+Math.abs(actual.top-host.top-mapped[1])}})()`)
 assert.equal(evidence.link.href,'https://example.org/');assert.ok(evidence.link.delta<2)
 // Real document search uses the same forward geometry as saved highlights and links.
 await js("[...document.querySelectorAll('header button')].find(b=>b.textContent==='查找').click()")
 await js("(()=>{const input=document.querySelector('input[aria-label=\"查找本文\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'river');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
 for(let i=0;i<80;i++){if(await js('!!document.querySelector(".reader-find .search-hit")'))break;await wait(100)}
 await js("document.querySelector('.reader-find .search-hit').click()")
 await wait(120)
 evidence.search=await js(`(async()=>{const list=await window.jian.library.list({}),detail=await window.jian.library.get(list.data.items[0].id),result=await window.jian.m4.search({query:'river',scope:'body',documentVersionId:detail.data.documents[0].activeVersionId}),hit=result.data.groups[0].hits[0],p=document.querySelector('[data-page="'+(hit.pageIndex+1)+'"]'),r=hit.anchor.rects[0],vp=p.pdfPage.getViewport({scale:1}),a=vp.convertToViewportPoint(r[0],r[1]),b=vp.convertToViewportPoint(r[2],r[3]),mapped=p.pdfGeometry.fromSourceRect([Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])])[0],actual=p.querySelector('.pdf-search-highlights span').getBoundingClientRect(),host=p.getBoundingClientRect();return{page:hit.pageIndex,delta:Math.abs(actual.left-host.left-mapped[0])+Math.abs(actual.top-host.top-mapped[1])}})()`)
 assert.ok(evidence.search.delta<2,'document search rectangles share inline mapping')
 await js("[...document.querySelectorAll('.reader-find button')].find(b=>b.textContent==='关闭查找').click()")
 // A cross-page source range retains two independent PDF anchors.
 evidence.crossPage=await js(`(()=>{const first=document.querySelectorAll('.inline-page')[0],second=document.querySelectorAll('.inline-page')[1],a=[...first.querySelectorAll('.textLayer span')].find(x=>x.textContent.includes('glossary')),b=[...second.querySelectorAll('.textLayer span')].find(x=>x.textContent.includes('Evidence should')),r=document.createRange();r.setStart(a.firstChild,4);r.setEnd(b.firstChild,18);const s=getSelection();s.removeAllRanges();s.addRange(r);b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return s.toString()})()`)
 await wait(80);await js("[...document.querySelectorAll('.selection-panel button')].find(b=>b.textContent==='高亮').click()")
 await wait(120);evidence.crossPageAnchors=await js("window.jian.library.list({}).then(async l=>{const d=await window.jian.library.get(l.data.items[0].id);const a=await window.jian.m3.annotations(d.data.documents[0].activeVersionId);return a.data.find(x=>x.anchors.length===2)?.anchors})")
 assert.equal(evidence.crossPageAnchors.length,2);assert.equal(evidence.crossPageAnchors[0].pageIndex,0);assert.equal(evidence.crossPageAnchors[1].pageIndex,1)
 await js("[...document.querySelectorAll('.selection-panel button')].find(b=>b.textContent==='关闭').click();getSelection().removeAllRanges()")
 // Existing excerpt anchor navigation goes through the same band transform.
 await js("[...document.querySelectorAll('header button')].find(b=>b.textContent.startsWith('札记')).click()")
 await wait(100);assert.ok(await js('!!document.querySelector(".annotation-list article")'))
 await js("[...document.querySelectorAll('header button')].find(b=>b.textContent==='行间 · 实验').click()")
 await wait(300)
 for(const zoom of [.8,2]){
  await js(`(()=>{const el=document.querySelector('select[aria-label="PDF 缩放"]');el.value='${zoom}';el.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait(350)
  const width=await js("document.querySelector('.inline-page .pdf-highlights span')?.getBoundingClientRect().width");assert.ok(Math.abs(width-evidence.highlight.width*zoom)<3)
 }
 await js("(()=>{const el=document.querySelector('select[aria-label=\"PDF 缩放\"]');el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.reader__pane--source').scrollTop=0})()")
 await wait(200);longResponse=false;await js("document.querySelector('.inline-paragraph-marker').click()");await wait(350);await js("document.querySelector('.reader__pane--source').scrollTop=0");await wait(100);evidence.layout1280Light=await checkLayout(js,'1280 light');fs.writeFileSync(join(root,'m6-inline.png'),(await win.webContents.capturePage()).toPNG())
 win.setSize(960,760);await wait(200);evidence.layout960Light=await checkLayout(js,'960 light');fs.writeFileSync(join(root,'m6-inline-narrow.png'),(await win.webContents.capturePage()).toPNG());
 await js("window.jian.preferences.set({theme:'dark'})");await wait(150);evidence.layout960Dark=await checkLayout(js,'960 dark');assert.equal(evidence.layout960Dark.theme,'dark');fs.writeFileSync(join(root,'m6-inline-dark-narrow.png'),(await win.webContents.capturePage()).toPNG());
 win.setSize(1280,820);await wait(150);evidence.layout1280Dark=await checkLayout(js,'1280 dark');fs.writeFileSync(join(root,'m6-inline-dark.png'),(await win.webContents.capturePage()).toPNG());
 await js("window.jian.preferences.set({theme:'light'})");win.setSize(960,760);await wait(150)
 // Persist source position, not expanded flow offset, then reopen the stable bilingual mode.
 evidence.beforeReload=await js(`(()=>{const pane=document.querySelector('.reader__pane--source'),p=document.querySelector('.inline-page'),mapped=p.pdfGeometry.fromSourcePoint([60,300]);pane.scrollTop+=p.getBoundingClientRect().top+mapped[1]-pane.getBoundingClientRect().top-80;return {offset:p.getBoundingClientRect().top+mapped[1]-pane.getBoundingClientRect().top}})()`)
 await wait(1000)
 evidence.savedPosition=await js("window.jian.library.list({}).then(async l=>{const detail=await window.jian.library.get(l.data.items[0].id);return window.jian.reading.get(detail.data.documents[0].activeVersionId)})")
 assert.equal(evidence.savedPosition.data.mode,'bilingual')
 assert.ok(JSON.parse(evidence.savedPosition.data.anchor).viewportOffset>=0)
 win.webContents.reload()
 for(let i=0;i<80;i++){if(await js('document.querySelectorAll(".textLayer span").length>10'))break;await wait(100)}
 await wait(450)
 evidence.afterReload=await js(`(()=>{const pane=document.querySelector('.reader__pane--source'),p=document.querySelector('.pdf-page-host');return {offset:p.getBoundingClientRect().top+300-pane.getBoundingClientRect().top,inline:document.querySelectorAll('.inline-page').length,bilingual:[...document.querySelectorAll('header button')].find(b=>b.textContent==='双语').getAttribute('aria-pressed')}})()`)
 assert.equal(evidence.afterReload.inline,0);assert.equal(evidence.afterReload.bilingual,'true');assert.ok(Math.abs(evidence.afterReload.offset-evidence.beforeReload.offset)<3,'reopen preserves original source point rather than translation-expanded offset')
 // Stable mode still mounts its untouched renderer, and repeated mode switches keep one source text copy.
 await js("[...document.querySelectorAll('header button')].find(b=>b.textContent==='原文').click()")
 await wait(200);assert.equal(await js('document.querySelectorAll(".inline-page").length'),0);assert.ok(await js('document.querySelectorAll(".textLayer span").length>10'))
 fs.writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log('[M6 E2E PASS]',JSON.stringify({pages:evidence.inlinePages,pixelDifferences:evidence.zeroTranslationPixels.differences,scrollDelta:evidence.afterAnchor.offset-evidence.beforeAnchor.offset,highlight:true,link:true,zoom:true}))
 server.close();app.quit()
}
run().catch(async e=>{console.error('[M6 E2E FAIL]',e);const win=BrowserWindow.getAllWindows()[0];if(win){console.error('[DOM]',await win.webContents.executeJavaScript('document.body.innerText'));fs.writeFileSync(join(root,'failure.png'),(await win.webContents.capturePage()).toPNG())}server.close();app.exit(1)})
