const {app,BrowserWindow}=require('electron'),path=require('path'),assert=require('assert/strict'),fs=require('fs')
const root=process.env.JIAN_TEST_ROOT;if(!root)throw Error('Specify the isolated i18n fixture root')
app.setPath('userData',path.join(root,'app-data'));process.env.JIAN_LIBRARY_DIR=path.join(root,'library')
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function run(){require('../out/main/index.js');await app.whenReady();let win;for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows().find(w=>w.isVisible());if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript('!!document.querySelector(".workspace")').catch(()=>false))break;await wait(100)}
 assert.equal(await win.webContents.executeJavaScript('document.documentElement.lang'),'en');assert.ok((await win.webContents.executeJavaScript('document.title')).startsWith('Jian'));assert.equal((await win.webContents.executeJavaScript('window.jian.preferences.get()')).data.locale,'en');fs.writeFileSync(path.join(root,'restart-evidence.json'),JSON.stringify({locale:'en',coldRestart:'PASS',windowTitle:'Jian'},null,2));console.log('[EN RESTART PASS]');app.quit()
}run().catch(e=>{console.error(e);app.exit(1)})
