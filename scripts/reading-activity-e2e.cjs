// Synthetic PDF + controlled focus/idle sensors for unattended CI; real renderer hook, dialogs, native minimize and IPC.
const {app,BrowserWindow,powerMonitor}=require('electron'),fs=require('node:fs'),{join,resolve}=require('node:path'),assert=require('node:assert/strict')
const root=resolve(process.env.JIAN_TEST_ROOT||'/tmp/jian-reading-activity');fs.mkdirSync(root,{recursive:true});app.setPath('userData',join(root,'app-data'));process.env.JIAN_LIBRARY_DIR=join(root,'library');process.env.JIAN_VIEW='reader';const file=join(root,'fixture.pdf');require('./make-fixture.cjs')(file);process.env.JIAN_IMPORT=file
powerMonitor.getSystemIdleTime=()=>0
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win
async function run(){require('../out/main/index.js');await app.whenReady();for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows().find(w=>w.isVisible());if(win&&!win.webContents.isLoading())break;await wait(100)}assert.ok(win)
 const js=s=>win.webContents.executeJavaScript(s),until=async s=>{for(let i=0;i<100;i++){if(await js(s))return;await wait(100)}throw Error(s)},snap=async()=>{const r=await js("window.jian.analytics.snapshot({range:'all',timezone:'Asia/Shanghai'})");assert.equal(r.ok,true);return r.data.reading.activeMs},click=text=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.closest('[inert]'));if(!b)throw Error('missing '+${JSON.stringify(text)});b.click()})()`)
 await until('!!document.querySelector(".pdf-page-host .textLayer span")');win.isFocused=()=>true;await js("document.hasFocus=()=>true;window.dispatchEvent(new Event('focus'))")
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'ArrowDown'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'ArrowDown'});await wait(11000)
 const evidence={sensors:'focus and idle controlled for unattended CI; native visibility/minimize and application modal remain real',activeMs:await snap()};assert.ok(evidence.activeMs>=4000&&evidence.activeMs<15000)
 win.webContents.sendInputEvent({type:'keyDown',keyCode:',',modifiers:['meta']});win.webContents.sendInputEvent({type:'keyUp',keyCode:',',modifiers:['meta']});await until('!!document.querySelector("[role=dialog]")');const modalStart=await snap();await wait(6100);evidence.modalDelta=await snap()-modalStart;assert.equal(evidence.modalDelta,0);await click('关闭')
 win.minimize();await wait(6100);evidence.minimizedDelta=await snap()-modalStart;assert.equal(evidence.minimizedDelta,0);win.restore();win.focus();await click('‹ 文集');await until('!!document.querySelector(".workspace")');const libraryStart=await snap();await wait(6100);evidence.libraryDelta=await snap()-libraryStart;assert.equal(evidence.libraryDelta,0)
 fs.writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log('[READING ACTIVITY PASS]',JSON.stringify(evidence));app.quit()
}
run().catch(e=>{console.error('[READING ACTIVITY FAIL]',e);app.exit(1)})
