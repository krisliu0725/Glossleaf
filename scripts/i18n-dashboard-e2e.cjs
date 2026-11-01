const {app,BrowserWindow}=require('electron'),fs=require('fs'),{join}=require('path'),assert=require('assert/strict')
const root=process.env.JIAN_TEST_ROOT||'/tmp/jian-053-dashboard-en',data=join(root,'app-data');fs.mkdirSync(data,{recursive:true})
if(!fs.existsSync(join(data,'preferences.json')))fs.writeFileSync(join(data,'preferences.json'),JSON.stringify({theme:'light',locale:'en'}))
app.setPath('userData',data);process.env.JIAN_LIBRARY_DIR=join(root,'library');process.env.JIAN_VIEW='dashboard'
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win
async function run(){require('../out/main/index.js');await app.whenReady();for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows().find(w=>w.isVisible());if(win&&!win.webContents.isLoading())break;await wait(100)}
 const js=s=>win.webContents.executeJavaScript(s),until=async s=>{for(let i=0;i<150;i++){if(await js(s))return;await wait(100)}throw Error(s)}
 await until('!!document.querySelector(".dash-metrics")');assert.equal(await js('document.documentElement.lang'),'en')
 const snapshot=await js("window.jian.analytics.snapshot({range:'30',timezone:'Asia/Shanghai'})");assert.ok(snapshot.data.reading.activeMs>0);assert.ok(snapshot.data.tokens.totalTokens>0);assert.ok(snapshot.data.tokens.unknownAttempts>0)
 const layouts=[]
 for(const [width,height,theme]of [[1280,820,'light'],[900,820,'light'],[760,820,'light'],[1280,820,'dark']]){
  win.setMinimumSize(560,500);win.setSize(width,height);await js('window.jian.preferences.set('+JSON.stringify({theme})+')');await wait(180)
  const layout=await js('({body:document.body.scrollWidth>innerWidth+1,main:document.querySelector(".dash-main").scrollWidth>document.querySelector(".dash-main").clientWidth+1})');assert.equal(layout.body,false);assert.equal(layout.main,false);layouts.push({width,theme,...layout});fs.writeFileSync(join(root,'dashboard-en-'+width+'-'+theme+'.png'),(await require('./native-capture.cjs')(win)).toPNG())
 }
 await js("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Ledger').click()");await wait(200);assert.ok(await js('document.querySelector(".dash-main").innerText.includes("Billing data unavailable")'));fs.writeFileSync(join(root,'ledger-en.png'),(await require('./native-capture.cjs')(win)).toPNG())
 fs.writeFileSync(join(root,'evidence.json'),JSON.stringify({kind:'synthetic demo data',readingMs:snapshot.data.reading.activeMs,tokens:snapshot.data.tokens.totalTokens,unknown:snapshot.data.tokens.unknownAttempts,layouts},null,2));console.log('[EN DASHBOARD PASS]',JSON.stringify(layouts));app.quit()
}run().catch(e=>{console.error(e);app.exit(1)})
