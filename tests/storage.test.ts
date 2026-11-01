import test from 'node:test'
import assert from 'node:assert/strict'
import {promises as fs,mkdtempSync,rmSync,existsSync,readdirSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {openLibrary,type Db} from '../src/data-service/db'
import {importPdf,resolveDocument,relinkDocument,getItem,saveReadingState} from '../src/data-service/repo'
import {dispatchM3} from '../src/data-service/m3'
import {dispatchM4} from '../src/data-service/m4'
import {createBackup,verifyBackup,applyRestore} from '../src/data-service/backup'
import {importZotero} from '../src/adapters/zotero/importer'
import {downloadFullText,savePdf,fullTextCandidates,publicEndpoint,isPublicAddress,fetchPublic,cleanupDownloadStaging} from '../src/main/m4/fulltext'
const pdf=Buffer.from('%PDF-1.7\nA small synthetic PDF fixture.\n%%EOF\n')
const req=createRequire(join(process.cwd(),'package.json'))
function fixture(){const root=mkdtempSync(join(tmpdir(),'glossleaf-storage-')),dir=join(root,'library'),db=openLibrary(dir),file=join(root,'original.pdf');return {root,dir,db,file,close:()=>{db.close();rmSync(root,{recursive:true,force:true})}}}
const authors:never[]=[]
function reference(db:Db){return dispatchM4(db,'m4.metadataSave',{draft:{title:'Synthetic reference',type:'journalArticle',date:'2026',language:'en',creators:authors,fields:{DOI:'10.1234/example'}}})as string}
const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}})
test('local PDF import links originals, reads the same path, deduplicates concurrent imports and creates zero managed copies',async()=>{
 const l=fixture();try{await fs.writeFile(l.file,pdf);const [a,b]=await Promise.all([importPdf(l.db,l.dir,[l.file]),importPdf(l.db,l.dir,[l.file])]);assert.equal(a[0].itemId,b[0].itemId);assert.equal(b[0].duplicate,true);assert.equal(l.db.get('SELECT count(*) AS n FROM item')?.n,1);assert.equal(l.db.get('SELECT count(*) AS n FROM file_blob')?.n,0);assert.equal(existsSync(join(l.dir,'blobs')),false)
 const doc=await resolveDocument(l.db,l.dir,a[0].documentVersionId);assert.equal(doc?.absPath,await fs.realpath(l.file));assert.equal(getItem(l.db,a[0].itemId)?.documents[0].storageMode,'linked');assert.equal(getItem(l.db,a[0].itemId)?.documents[0].byteSize,pdf.length)
 }finally{l.close()}
})
test('changed originals never borrow an old annotation version; reimport creates a new version of the same item',async()=>{
 const l=fixture();try{await fs.writeFile(l.file,pdf);const [old]=await importPdf(l.db,l.dir,[l.file]);dispatchM3(l.db,'m3.annotationSave',{documentVersionId:old.documentVersionId,type:'excerpt',quote:'Original quotation',comment:'Keep this',anchors:[{documentVersionId:old.documentVersionId,pageIndex:0,rects:[[1,2,30,40]],exact:'Original quotation'}]})
 await fs.appendFile(l.file,'changed');await assert.rejects(()=>resolveDocument(l.db,l.dir,old.documentVersionId),/原文件/)
 const [next]=await importPdf(l.db,l.dir,[l.file]);assert.equal(next.itemId,old.itemId);assert.equal(next.documentId,old.documentId);assert.notEqual(next.documentVersionId,old.documentVersionId);assert.equal(l.db.get('SELECT documentVersionId FROM annotation')?.documentVersionId,old.documentVersionId);assert.equal(l.db.get('SELECT count(*) AS n FROM document_version')?.n,2);await assert.rejects(()=>resolveDocument(l.db,l.dir,old.documentVersionId));assert.ok(await resolveDocument(l.db,l.dir,next.documentVersionId))
 }finally{l.close()}
})
test('relocation accepts only identical content and retains version IDs, annotations and reading state',async()=>{
 const l=fixture();try{await fs.writeFile(l.file,pdf);const [a]=await importPdf(l.db,l.dir,[l.file]);saveReadingState(l.db,a.documentVersionId,{pageIndex:1,zoom:1.2,anchor:'saved anchor'});const moved=join(l.root,'moved.pdf'),wrong=join(l.root,'wrong.pdf');await fs.rename(l.file,moved);await fs.writeFile(wrong,'different');await assert.rejects(()=>resolveDocument(l.db,l.dir,a.documentVersionId));await assert.rejects(()=>relinkDocument(l.db,a.documentVersionId,wrong),/内容与原附件不同/);assert.equal(await relinkDocument(l.db,a.documentVersionId,moved),true);assert.equal((await resolveDocument(l.db,l.dir,a.documentVersionId))?.absPath,await fs.realpath(moved));assert.equal(l.db.get('SELECT count(*) AS n FROM document_version')?.n,1);assert.equal(l.db.get('SELECT pageIndex FROM reading_state WHERE documentVersionId=?',[a.documentVersionId])?.pageIndex,1)
 }finally{l.close()}
})
test('full backup materializes originals only in the backup and restores without access to the originals',async()=>{
 const l=fixture();let restored:Db|undefined
 try{await fs.writeFile(l.file,pdf);const [a]=await importPdf(l.db,l.dir,[l.file]);const backup=await createBackup(l.db,l.dir,{appVersion:'0.8.0',includeBlobs:true});assert.equal(backup.verified,true);assert.equal(backup.blobCount,1);assert.equal(l.db.get('SELECT count(*) AS n FROM file_blob')?.n,0);assert.equal(getItem(l.db,a.itemId)?.documents[0].storageMode,'linked');assert.equal(existsSync(join(l.dir,'blobs')),false)
 await fs.rm(l.file);const restoreRoot=join(l.root,'restored');await fs.mkdir(join(restoreRoot,'backups'),{recursive:true});await fs.cp(backup.path,join(restoreRoot,'backups',backup.id),{recursive:true});const plan=await verifyBackup(restoreRoot,backup.id);assert.deepEqual(plan.problems,[]);await applyRestore(restoreRoot,plan);restored=openLibrary(restoreRoot);assert.equal(getItem(restored,a.itemId)?.documents[0].storageMode,'managed');const doc=await resolveDocument(restored,restoreRoot,a.documentVersionId);assert.deepEqual(await fs.readFile(doc!.absPath),pdf)
 }finally{restored?.close();l.close()}
})
test('missing linked originals make full backup fail clearly without leaving a false successful backup',async()=>{
 const l=fixture();try{await fs.writeFile(l.file,pdf);await importPdf(l.db,l.dir,[l.file]);await fs.rm(l.file);await assert.rejects(()=>createBackup(l.db,l.dir,{appVersion:'0.8.0'}),/完整备份需要原文件/);assert.deepEqual(readdirSync(join(l.dir,'backups')),[])}finally{l.close()}
})
test('Zotero parent and standalone attachments remain at their source paths, with annotations and repeat-import IDs preserved',async()=>{
 const l=fixture();try{const source=join(l.root,'zotero');req('./scripts/make-zotero-fixture.cjs')(source);const before=createHash('sha256').update(readFileSync(join(source,'zotero.sqlite'))).digest('hex')
 const first=await importZotero(l.db,l.dir,source,join(l.root,'snapshots'));assert.equal(first.status,'published');assert.equal(first.counts.attachments,2);assert.equal(l.db.get('SELECT count(*) AS n FROM file_blob')?.n,0);assert.equal(existsSync(join(l.dir,'blobs')),false);assert.equal(l.db.get('SELECT count(*) AS n FROM annotation')?.n,2)
 const versions=l.db.all('SELECT id FROM document_version').map(v=>v.id);for(const id of versions)assert.ok((await resolveDocument(l.db,l.dir,String(id)))?.absPath.startsWith(await fs.realpath(source)))
 await importZotero(l.db,l.dir,source,join(l.root,'snapshots'));assert.deepEqual(l.db.all('SELECT id FROM document_version').map(v=>v.id),versions);assert.equal(createHash('sha256').update(readFileSync(join(source,'zotero.sqlite'))).digest('hex'),before);assert.deepEqual(readdirSync(join(l.root,'snapshots')),[])
 }finally{l.close()}
})
test('downloaded PDF is adopted once into managed storage, linked to the confirmed reference, and reused on retry',async()=>{
 const l=fixture();try{const id=reference(l.db),item=getItem(l.db,id)!,meta=(async()=>json({doi:'https://doi.org/10.1234/example',best_oa_location:{is_oa:true,pdf_url:'https://files.example.org/article.pdf'}}))as typeof fetch,attach=async(file:string)=>importPdf(l.db,l.dir,[file],{mode:'managed',itemId:id,adopt:true})
 const result=await downloadFullText(item,l.dir,new AbortController().signal,attach,{metadataFetcher:meta,pdfFetcher:async()=>new Response(pdf)});assert.equal(result.status,'downloaded');assert.equal(l.db.get('SELECT count(*) AS n FROM item')?.n,1);assert.equal(l.db.get('SELECT count(*) AS n FROM file_blob')?.n,1);assert.deepEqual(readdirSync(join(l.dir,'.tmp','downloads')),[]);const stored=getItem(l.db,id)!;assert.equal(stored.documents[0].storageMode,'managed');assert.equal(stored.documents[0].byteSize,pdf.length);assert.deepEqual(await fs.readFile((await resolveDocument(l.db,l.dir,stored.documents[0].activeVersionId!))!.absPath),pdf)
 const again=await downloadFullText(stored,l.dir,new AbortController().signal,attach,{metadataFetcher:async()=>{throw Error('should not fetch')}});assert.equal(again.status,'existing')
 }finally{l.close()}
})
test('full text candidates use exact DOI and OA copies, ignore closed copies and mismatches, and preserve records on failure',async()=>{
 const l=fixture();try{const id=reference(l.db),item=getItem(l.db,id)!,signal=new AbortController().signal
 assert.deepEqual(await fullTextCandidates(item,signal,(async()=>json({doi:'https://doi.org/10.1234/wrong',best_oa_location:{is_oa:true,pdf_url:'https://example.org/a.pdf'}}))as typeof fetch),[])
 const candidates=await fullTextCandidates(item,signal,(async()=>json({doi:'https://doi.org/10.1234/example',best_oa_location:{is_oa:false,pdf_url:'https://example.org/closed.pdf'},locations:[{is_oa:true,pdf_url:'https://example.org/open.pdf'},{is_oa:true,pdf_url:'http://example.org/insecure.pdf'}]}))as typeof fetch);assert.deepEqual(candidates,['https://example.org/open.pdf'])
 const result=await downloadFullText(item,l.dir,signal,async()=>{throw Error('must not attach HTML')},{metadataFetcher:(async()=>json({doi:'https://doi.org/10.1234/example',best_oa_location:{is_oa:true,pdf_url:'https://example.org/a'}}))as typeof fetch,pdfFetcher:async()=>new Response('<html>Sign in</html>')});assert.equal(result.status,'unavailable');assert.equal(l.db.get('SELECT count(*) AS n FROM item')?.n,1);assert.equal(getItem(l.db,id)?.documents.length,0);assert.deepEqual(readdirSync(join(l.dir,'.tmp','downloads')),[])
 }finally{l.close()}
})
test('PDF downloads reject incomplete files, size overflows, cancellation and redirect loops without residual files',async()=>{
 const root=mkdtempSync(join(tmpdir(),'glossleaf-download-'));try{const path=join(root,'result.pdf'),signal=new AbortController().signal
 await assert.rejects(()=>savePdf('https://example.org/a',path,signal,async()=>new Response('%PDF-1.7 incomplete')),/完整 PDF/);assert.equal(existsSync(path),false)
 await assert.rejects(()=>savePdf('https://example.org/a',path,signal,async()=>new Response(pdf,{headers:{'Content-Length':String(151*1024*1024)}})),/150 MB/);assert.equal(existsSync(path),false)
 const c=new AbortController();c.abort();await assert.rejects(()=>savePdf('https://example.org/a',path,c.signal,async()=>new Response(pdf)));assert.equal(existsSync(path),false)
 let calls=0;await assert.rejects(()=>savePdf('https://example.org/a',path,signal,async()=>{calls++;return new Response(null,{status:302,headers:{Location:'/a'}})}));assert.equal(calls,5);assert.equal(existsSync(path),false)
 }finally{rmSync(root,{recursive:true,force:true})}
})
test('full text transport rejects private addresses, credentialed URLs and private redirect destinations before HTTP',async()=>{
 for(const a of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.1.2','192.168.0.1','100.64.0.1','::1','fc00::1','::ffff:127.0.0.1'])assert.equal(isPublicAddress(a),false,a)
 assert.equal(isPublicAddress('8.8.8.8'),true);assert.equal(isPublicAddress('2606:4700::1111'),true)
 for(const u of ['http://example.org/a.pdf','https://user:secret@example.org/a.pdf','https://localhost/a','https://127.0.0.1/a','https://example.org:444/a'])await assert.rejects(()=>publicEndpoint(u))
 await assert.rejects(()=>publicEndpoint('https://example.org/a',(async()=>[{address:'10.1.1.1',family:4}])as any))
 let redirects=0;const privateTarget=join(tmpdir(),'glossleaf-private-'+Date.now()+'.pdf');await assert.rejects(()=>savePdf('https://example.org/a',privateTarget,new AbortController().signal,async(url,signal)=>{if(redirects++===0)return new Response(null,{status:302,headers:{Location:'https://127.0.0.1/secret'}});return fetchPublic(url,signal)}),/私有网络/);assert.equal(existsSync(privateTarget),false)
 const vetted=await publicEndpoint('https://example.org/a',(async()=>[{address:'8.8.8.8',family:4}])as any);assert.equal(vetted.address,'8.8.8.8')
})

test('stale download cleanup removes only old UUID staging PDFs, preserving recent files and other names',async()=>{
 const root=mkdtempSync(join(tmpdir(),'glossleaf-stale-')),dir=join(root,'.tmp','downloads');try{await fs.mkdir(dir,{recursive:true});const stale=join(dir,'11111111-1111-1111-1111-111111111111.pdf'),recent=join(dir,'22222222-2222-2222-2222-222222222222.pdf'),other=join(dir,'notes.pdf');for(const p of [stale,recent,other])await fs.writeFile(p,'partial');const old=new Date(Date.now()-48*60*60*1000);await fs.utimes(stale,old,old);await fs.utimes(other,old,old);await cleanupDownloadStaging(root);assert.equal(existsSync(stale),false);assert.equal(existsSync(recent),true);assert.equal(existsSync(other),true)}finally{rmSync(root,{recursive:true,force:true})}
})

test('publisher PDF fallback fetches fresh DOI metadata and reports total metadata service outages',async()=>{
 const item={fields:{DOI:'10.1234/example'},documents:[]}as any,signal=new AbortController().signal,requests:string[]=[]
 const urls=await fullTextCandidates(item,signal,(async(url:any)=>{requests.push(String(url));return String(url).includes('openalex')?json({doi:'https://doi.org/10.1234/example',locations:[]}):json({message:{DOI:'10.1234/example',link:[{'content-type':'application/pdf',URL:'https://publisher.example/article.pdf'}]}})})as typeof fetch)
 assert.deepEqual(urls,['https://publisher.example/article.pdf']);assert.equal(requests.length,2)
 await assert.rejects(()=>fullTextCandidates(item,signal,(async()=>{throw Error('offline')})as typeof fetch),/服务暂不可用/)
})
