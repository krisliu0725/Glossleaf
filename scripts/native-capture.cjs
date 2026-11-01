// macOS compositor can briefly reject capture during resize/raster publication.
// Retry screenshots only; functional assertions are never retried or skipped here.
module.exports=async function capture(win){for(let attempt=0;attempt<4;attempt++){try{const image=await win.webContents.capturePage();if(!image.isEmpty())return image}catch(error){if(attempt===3)throw error}await new Promise(r=>setTimeout(r,150))}throw Error('Native capture remained empty')}
