import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Cite } from '@citation-js/core'
import '@citation-js/plugin-bibtex'
import { Db, openLibrary } from '../src/data-service/db'
import { SCHEMA_SQL, MIGRATIONS, SCHEMA_VERSION } from '../src/data-service/schema'
import { dispatchM4, search, type ExportRow } from '../src/data-service/m4'
import { dispatchM3 } from '../src/data-service/m3'
import { normalizeText, queryTokens, matches, snippet, ftsQuery } from '../src/shared/search-text'
import { pageText } from '../src/shared/page-text'
import { normalizeDoi } from '../src/shared/metadata'
import { fromCrossref, lookupDoi } from '../src/main/m4/doi'
import { buildExport, formatCitations, toCsl } from '../src/main/m4/exports'
import { getItem } from '../src/data-service/repo'
import type { IndexPage, MetadataDraft, SearchResponse } from '../src/shared/m4'
const blank:MetadataDraft={title:'测试文献',type:'journalArticle',date:'2026-10-29',language:null,fields:{},creators:[]}
function library(){const dir=mkdtempSync(join(tmpdir(),'jian-m4-'));const db=openLibrary(dir);return {db,dir,close:()=>{db.close();rmSync(dir,{recursive:true,force:true})}}}
function item(db:Db,draft:Partial<MetadataDraft>={}):string{return dispatchM4(db,'m4.metadataSave',{draft:{...blank,...draft}}) as string}
function document(db:Db,itemId:string):string {
 const doc=randomUUID(),version=randomUUID(),now=new Date().toISOString()
 for(const id of [doc,version])db.run("INSERT INTO entity(id,kind,createdAt,updatedAt) VALUES(?,'document',?,?)",[id,now,now])
 db.run("INSERT INTO document(id,itemId,displayName,contentType,activeVersionId) VALUES(?,?,'fixture.pdf','application/pdf',?)",[doc,itemId,version])
 db.run("INSERT INTO document_version(id,documentId,externalGrantId,fingerprint) VALUES(?,?,'fixture','hash-a')",[version,doc])
 dispatchM4(db,'m4.indexReset',{});dispatchM4(db,'m4.indexNext',{});return version
}
function page(db:Db,version:string,text:string,pageIndex=0):void {
 dispatchM4(db,'m4.indexPage',{documentVersionId:version,pageIndex,text,runs:[{start:0,end:text.length,rect:[10,20,200,40]}]} satisfies IndexPage)
}
test('normalization preserves source UTF-16 positions across accents, ligatures and astral CJK',()=>{
 const raw='外交 Café 𠮷野 ﬃ energies',normalized=normalizeText(raw)
 assert.ok(normalized.text.includes('cafe'));assert.ok(normalized.text.includes('ffi'))
 for(const q of ['café','Café','𠮷野','ffi','energy']) {
  const ranges=matches(normalized.text,queryTokens(q));assert.ok(ranges)
  const result=snippet(raw,normalized,ranges)
  assert.equal(result.snippet.includes(raw.slice(...result.rawRanges[0])),true)
 }
 assert.deepEqual(queryTokens('energies / energy'),['energ'])
 assert.equal(matches('emergency',queryTokens('energy')),null)
 assert.equal(ftsQuery(queryTokens('"(外交) OR * energy"'))?.includes('*'),false)
})
test('multilingual page/metadata search uses safe queries and excludes deleted or inactive content',()=>{
 const l=library();try{
  const id=item(l.db,{title:'Café 外交',fields:{DOI:'10.1234/example'}}),v=document(l.db,id)
  page(l.db,v,'外交与能源。GDP 增长。Россия。経済。Energies and energy. Café. 𠮷野。')
  for(const query of ['外交','能源','GDP 增长','Россия','経済','energy','energies','cafe','𠮷野','外']) {
   const result=search(l.db,{query,scope:'body'});assert.equal(result.groups.length,1,query);assert.ok(result.groups[0].hits[0].marks.length);assert.equal(result.groups[0].hits[0].anchor?.pageIndex,0)
  }
  for(const query of ['"外交"','(外交)','外交*','OR "'])assert.doesNotThrow(()=>search(l.db,{query,scope:'all'}))
  assert.equal(search(l.db,{query:'cafe',scope:'metadata'}).groups[0].itemId,id)
  l.db.run("UPDATE document SET activeVersionId=NULL WHERE activeVersionId=?",[v]);assert.equal(search(l.db,{query:'能源',scope:'body'}).groups.length,0)
  l.db.run('UPDATE entity SET deletedAt=? WHERE id=?',[new Date().toISOString(),id]);assert.equal(search(l.db,{query:'cafe',scope:'all'}).groups.length,0)
 }finally{l.close()}
})
test('saved translation and comment are searchable; translation cache is excluded; excerpt delete updates index',()=>{
 const l=library();try{
  const id=item(l.db),v=document(l.db,id)
  const annotation=dispatchM3(l.db,'m3.annotationSave',{documentVersionId:v,type:'excerpt',quote:'source phrase',comment:'评论外交',anchors:[{documentVersionId:v,pageIndex:0,rects:[[0,0,40,10]],exact:'source phrase'}],translation:{text:'保存的能源译文',status:'completed',cached:false,inputHash:'saved',providerFingerprint:'fixture',inputSnapshot:'{}'}}) as string
  for(const query of ['能源','外交']){const hit=search(l.db,{query,scope:'excerpts'}).groups[0].hits[0];assert.equal(hit.annotationId,annotation);assert.equal(hit.anchor?.rects.length,1)}
  l.db.run("INSERT INTO translation_cache VALUES('cache-only','completed','invisiblemachine','p',NULL,'now','now')")
  assert.equal(search(l.db,{query:'invisiblemachine',scope:'all'}).groups.length,0)
  l.db.run('UPDATE translation_record SET output=? WHERE id=?',['改写后的新译文',annotation]);assert.equal(search(l.db,{query:'新译文',scope:'excerpts'}).groups.length,1)
  dispatchM3(l.db,'m3.annotationDelete',{id:annotation});assert.equal(search(l.db,{query:'外交',scope:'excerpts'}).groups.length,0)
 }finally{l.close()}
})
test('short-query scanning is bounded and continues from an explicit cursor',()=>{
 const l=library();try{
  const id=item(l.db),v=document(l.db,id)
  l.db.transaction(()=>{for(let n=0;n<805;n++)page(l.db,v,n===804?'外交目标':'No match here.',n)})
  const first=search(l.db,{query:'外',scope:'body'});assert.equal(first.scanned,800);assert.equal(first.groups.length,0);assert.equal(first.limitedScan,true);assert.ok(first.nextCursor!==null)
  const next=search(l.db,{query:'外',scope:'body',cursor:first.nextCursor!});assert.equal(next.groups[0].hits[0].pageIndex,804);assert.equal(next.nextCursor,null)
 }finally{l.close()}
})
test('index checkpoints survive reopen, paused work resumes, and changed fingerprints invalidate pages',()=>{
 const l=library();try{
  const id=item(l.db),v=document(l.db,id);page(l.db,v,'checkpoint')
  dispatchM4(l.db,'m4.indexReset',{});const next=dispatchM4(l.db,'m4.indexNext',{}) as {completedPages:number[]};assert.deepEqual(next.completedPages,[0])
  assert.throws(()=>dispatchM4(l.db,'m4.indexFinish',{id:v,pageCount:2}),/不完整/)
  page(l.db,v,'second',1);dispatchM4(l.db,'m4.indexFinish',{id:v,pageCount:2})
  l.db.close();const reopened=openLibrary(l.dir)
  assert.equal(search(reopened,{query:'checkpoint',scope:'body'}).groups.length,1)
  reopened.run("UPDATE document_version SET fingerprint='hash-b' WHERE id=?",[v]);dispatchM4(reopened,'m4.indexStats',{})
  assert.equal(search(reopened,{query:'checkpoint',scope:'body'}).groups.length,0);reopened.close()
 }finally{l.close()}
})
test('DOI parsing and Crossref mapping preserve institutions, partial dates, unknown fields and duplicate decisions',async()=>{
 const doi='10.1234/example'
 assert.equal(normalizeDoi('https://doi.org/10.1234/EXAMPLE'),doi);assert.equal(normalizeDoi('DOI: '+doi),doi)
 for(const raw of ['https://evil.example/10.1234/test','not-a-doi','10.1234/has space'])assert.throws(()=>normalizeDoi(raw))
 const response={DOI:doi,title:['A study'],type:'journal-article',author:[{name:'Research Institute'},{family:'Lovelace',given:'Ada'}],issued:{'date-parts':[[2026,10]]},customField:{keep:true}}
 const draft=fromCrossref(response,doi);assert.equal(draft.creators[0].nameMode,'literal');assert.equal(draft.language,null);assert.equal(draft.date,'2026-10');assert.ok(draft.fields.metadataSourceJson.includes('customField'))
 let called='';const fetcher=(async(url:unknown)=>{called=String(url);return new Response(JSON.stringify({status:'ok',message:response}))}) as typeof fetch
 const preview=await lookupDoi(doi,new AbortController().signal,fetcher);assert.ok(called.startsWith('https://api.crossref.org/works/10.1234%2F'));assert.equal(preview.draft.title,'A study')
 assert.throws(()=>fromCrossref({...response,DOI:'10.1234/other'},doi),/不一致/)
 const l=library();try{const id=item(l.db,draft);assert.equal((dispatchM4(l.db,'m4.duplicates',{doi}) as unknown[]).length,1);assert.throws(()=>item(l.db,draft),/已有相同/);assert.ok(dispatchM4(l.db,'m4.metadataSave',{draft,allowDuplicate:true}));dispatchM4(l.db,'m4.metadataSave',{id,draft:{...draft,title:'Edited'},allowDuplicate:true});assert.equal(getItem(l.db,id)?.title,'Edited')}finally{l.close()}
})
test('CSL and BibTeX exports round-trip through an independent parser and include corporate/multiple authors',()=>{
 const l=library();try{
  const id=item(l.db,{title:'Diplomacy & 50% {Growth} #1',fields:{DOI:'10.1234/energy',publicationTitle:'Journal of Evidence',volume:'12',issue:'2',pages:'10-20',url:'https://example.org/a_b'},creators:[{order:0,role:'author',nameMode:'literal',literalName:'World Evidence Institute',givenName:null,familyName:null},{order:1,role:'author',nameMode:'person',familyName:'García',givenName:'Ana',literalName:null}]})
  const rows=dispatchM4(l.db,'m4.exportData',{ids:[id]}) as ExportRow[]
  const json=buildExport(rows,'csl-json'),bib=buildExport(rows,'bibtex')
  const parsedJson=new Cite(JSON.parse(json.content)).data;assert.equal(parsedJson[0].DOI,'10.1234/energy')
  const parsedBib=new Cite(bib.content).data;assert.equal(parsedBib.length,1);assert.ok(String(parsedBib[0].title).includes('Growth'));assert.equal(parsedBib[0].author?.length,2);assert.equal(parsedBib[0].author?.[0].literal??parsedBib[0].author?.[0].family,'World Evidence Institute');assert.equal(parsedBib[0].author?.[0].given,undefined);assert.equal(parsedJson[0].author?.[0].literal,'World Evidence Institute');assert.equal(parsedBib[0].DOI,'10.1234/energy')
  const citation=formatCitations([rows[0].item]);assert.ok(citation.includes('Diplomacy'));assert.ok(citation.includes('2026'));assert.ok(citation.includes('World')||citation.includes('WORLD'));assert.match(citation,/\[J(?:\/OL)?\]/)
  assert.equal(toCsl({...rows[0].item,date:'Spring 2020',language:null}).language,undefined)
  assert.deepEqual(toCsl({...rows[0].item,date:'Spring 2020'}).issued,{literal:'Spring 2020'})
 }finally{l.close()}
})
test('reading exports preserve page anchors and saved material, including older imported anchor objects',()=>{
 const l=library();try{
  const id=item(l.db),v=document(l.db,id),a=dispatchM3(l.db,'m3.annotationSave',{documentVersionId:v,type:'excerpt',quote:'Quoted [text]',comment:'My # note',anchors:[{documentVersionId:v,pageIndex:1,rects:[[1,2,30,40]],exact:'Quoted [text]'}]}) as string
  l.db.run('UPDATE annotation SET anchorsJson=? WHERE id=?',[JSON.stringify({pageIndex:1,rects:[[1,2,30,40]]}),a])
  const rows=dispatchM4(l.db,'m4.exportData',{ids:[id]}) as ExportRow[]
  const json=JSON.parse(buildExport(rows,'excerpts-json').content);assert.equal(json.items[0].annotations[0].anchors[0].pageIndex,1)
  const md=buildExport(rows,'markdown').content;assert.ok(md.includes('第 2 页'));assert.ok(md.includes('My \\# note'));assert.ok(md.includes(v));assert.equal(search(l.db,{query:'Quoted',scope:'excerpts'}).groups[0].hits[0].anchor?.pageIndex,1)
 }finally{l.close()}
})
test('v2 migration creates a consistent pre-upgrade snapshot and preserves existing user data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jian-migrate-'))
 try{
  const old=new Db(join(dir,'jian.sqlite'));old.exec(SCHEMA_SQL);old.exec(MIGRATIONS[2]);old.run("INSERT INTO meta VALUES('schema_version','2')");old.run("INSERT INTO glossary_entry VALUES('fixture','library',NULL,'state','国家','exact',1)");old.close()
  const current=openLibrary(dir);assert.equal(current.get("SELECT value FROM meta WHERE key='schema_version'")?.value,String(SCHEMA_VERSION));assert.equal(current.get('SELECT target FROM glossary_entry')?.target,'国家');current.close()
  const snapshots=readdirSync(join(dir,'migration-snapshots'));assert.equal(snapshots.length,SCHEMA_VERSION-2)
  const snapshot=new DatabaseSync(join(dir,'migration-snapshots',snapshots.find(n=>n.startsWith('schema-v2-before-v3'))!),{readOnly:true});assert.equal(snapshot.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value,'2');snapshot.close()
 }finally{rmSync(dir,{recursive:true,force:true})}
})


test('PDF fragment joining preserves CJK queries and split Latin words with real spacing',()=>{
 const fragment=(str:string,x:number,width:number,hasEOL=false)=>({str,transform:[10,0,0,10,x,100],width,hasEOL})
 const result=pageText([fragment('外',0,10),fragment('交',10,10,true),fragment('Ener',0,20),fragment('gy',20,10),fragment('production',40,50)])
 assert.equal(result.text,'外交\nEnergy production')
 assert.equal(result.text.slice(result.runs[1].start,result.runs[1].end),'交')
 assert.equal(result.runs.length,5)
})

test('full backup restores M4 metadata, saved excerpts and searchable PDF checkpoints',async()=>{
 const { createBackup, verifyBackup, applyRestore }=await import('../src/data-service/backup')
 const l=library();let restored:Db|null=null
 try{
  const id=item(l.db,{fields:{DOI:'10.1234/backup'}}),v=document(l.db,id);page(l.db,v,'Recoverable full text')
  dispatchM3(l.db,'m3.annotationSave',{documentVersionId:v,type:'excerpt',quote:'Recovered quote',comment:'Restored comment',anchors:[{documentVersionId:v,pageIndex:0,rects:[[1,2,30,40]],exact:'Recovered quote'}]})
  assert.equal(search(l.db,{query:'Recovered',scope:'excerpts'}).groups.length,1)
  const backup=await createBackup(l.db,l.dir,{appVersion:'0.4.0',includeBlobs:true}),plan=await verifyBackup(l.dir,backup.id);assert.deepEqual(plan.problems,[])
  l.db.run("DELETE FROM search_source");l.db.run("DELETE FROM annotation");l.db.close()
  await applyRestore(l.dir,plan);restored=openLibrary(l.dir)
  assert.equal(search(restored,{query:'Recoverable',scope:'body'}).groups.length,1)
  assert.equal(search(restored,{query:'Recovered',scope:'excerpts'}).groups.length,1)
  const rows=dispatchM4(restored,'m4.exportData',{ids:[id]}) as ExportRow[];assert.ok(buildExport(rows,'markdown').content.includes('Restored comment'))
  assert.equal(getItem(restored,id)?.fields.DOI,'10.1234/backup')
 }finally{restored?.close();l.close()}
})
