import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {analyzePage,normalizeBlockText,type Glyph} from '../src/renderer/src/reader/layout/analyze'
import {documentBlocks,detectLanguage} from '../src/renderer/src/reader/layout/document'
import {segmentAnchors,EMPTY_READER_DATA} from '../src/shared/reader'
import type {Segment} from '../src/shared/m3'
import {openLibrary} from '../src/data-service/db'
import {dispatchM3} from '../src/data-service/m3'
import {dispatchM4} from '../src/data-service/m4'
import {listItems,softDeleteItem,restoreItem,getItem} from '../src/data-service/repo'
function glyph(text:string,y:number,index:number,x=50,w=500,size=12):Glyph{return {text,x0:x,y0:y,x1:x+w,y1:y+size,index,rect:[x,792-y-size,x+w,792-y]}}
const block=(id:string,pageIndex=0,text='A continuous body'):Segment=>({id,pageIndex,text,kind:'body',rects:[[50,100,550,120]],confidence:.9})
test('paragraph normalization joins Chinese extraction gaps and soft wraps without collapsing English words',()=>{
 assert.equal(normalizeBlockText('风 险叠加 、 不确定性\n增强。'),'风险叠加、不确定性增强。')
 assert.equal(normalizeBlockText('inter-\nnational evidence\nis clear'),'international evidence is clear')
 assert.equal(normalizeBlockText('Café models and 2026 methods'),'Café models and 2026 methods')
})
test('real line geometry groups an abstract paragraph, isolates DOI and margin noise, and preserves body text',()=>{
 const gs=[glyph('Journal 2026 No. 2',15,0),glyph('A study',80,1,50,200,22),glyph('DOI: 10.1234/example',125,2),
 glyph('摘要：风 险叠加 、 不确定性',180,3),glyph('增强，治理需要更可靠的证据。',198,4),glyph('第二段研究讨论如何维持稳定。',240,5,74,476),glyph('1',770,6,300,10)]
 const ss=analyzePage(gs,612,792,0)
 const abstract=ss.filter(s=>s.kind==='abstract');assert.equal(abstract.length,1);assert.ok(abstract[0].text.includes('不确定性增强'))
 assert.equal(ss.find(s=>s.text.startsWith('DOI'))?.kind,'margin');assert.ok(ss.some(s=>s.kind==='body'&&s.text.startsWith('第二段')))
 assert.equal(ss.find(s=>s.text==='1')?.kind,'margin')
})
test('repeated headers need three distinct pages; reference sections stay out of automatic translation',()=>{
 const header=(p:number):Segment=>({...block('h'+p,p,'Journal 2026 No. 2'),bounds:[50,60,550,72],pageHeight:792})
 assert.equal(documentBlocks({0:[header(0)],1:[header(1)]},EMPTY_READER_DATA).filter(s=>s.kind==='margin').length,0)
 const rows=documentBlocks({0:[header(0),block('b',0,'Research evidence.')],1:[header(1)],2:[header(2),{...block('r',2,'References'),kind:'reference'},block('ref',2,'Author 2026.')]},EMPTY_READER_DATA)
 assert.equal(rows.filter(s=>s.id.startsWith('h')&&s.kind==='margin').length,3)
 assert.equal(rows.find(s=>s.id==='ref')?.kind,'reference')
})
test('cross-page paragraph merging preserves both page anchors and stops at real paragraph boundaries',()=>{
 const a={...block('a',0,'An inter-'),endsContinuation:true},b={...block('b',1,'national approach'),startsContinuation:true},c={...block('c',2,'A new paragraph.'),startsContinuation:false}
 const rows=documentBlocks({0:[a],1:[b],2:[c]},EMPTY_READER_DATA)
 assert.equal(rows.length,2);assert.equal(rows[0].text,'An international approach')
 assert.deepEqual(segmentAnchors(rows[0],'doc').map(a=>a.pageIndex),[0,1])
})
test('manual block edits are reversible and unknown or mixed-language documents are not disabled',()=>{
 const rows=[block('a',0,'First paragraph.'),block('b',0,'Second paragraph.')]
 assert.equal(documentBlocks({0:rows},{overrides:[{id:'b',action:'merge'}],edits:{}}).length,1)
 assert.equal(documentBlocks({0:rows},{overrides:[{id:'a',action:'ignore'}],edits:{}})[0].kind,'margin')
 assert.equal(documentBlocks({0:rows},EMPTY_READER_DATA).length,2)
 assert.equal(detectLanguage([block('x',0,'Short title')]),null)
 assert.equal(detectLanguage([block('x',0,'这是一份讨论研究方法的中文材料。'.repeat(20))]),'zh')
 assert.equal(detectLanguage([block('x',0,'The evidence is clear and the study is reproducible. '.repeat(10))]),'en')
})
test('reader corrections and user translations persist across restart and machine cache cleanup',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jian-reader-data-'));let db=openLibrary(dir)
 try{
  const item=randomUUID(),doc=randomUUID(),version=randomUUID(),now=new Date().toISOString()
  for(const [id,kind]of [[item,'item'],[doc,'document'],[version,'document']])db.run('INSERT INTO entity(id,kind,createdAt,updatedAt) VALUES(?,?,?,?)',[id,kind,now,now])
  db.run("INSERT INTO item(id,type,title) VALUES(?,'book','Synthetic')",[item]);db.run("INSERT INTO document(id,itemId,displayName,contentType,activeVersionId) VALUES(?,?,'fixture.pdf','application/pdf',?)",[doc,item,version]);db.run("INSERT INTO document_version(id,documentId,externalGrantId,fingerprint) VALUES(?,?,'fixture','fixture')",[version,doc])
  const data={overrides:[{id:'a',action:'ignore'}],edits:{'zh-CN:a':{source:'Source',text:'用户译文'}}}
  assert.equal(dispatchM3(db,'m3.readerDataSave',{documentVersionId:version,data}),true)
  dispatchM3(db,'m3.cacheClear',{});db.close();db=openLibrary(dir)
  assert.deepEqual(dispatchM3(db,'m3.readerData',{documentVersionId:version}),data)
  assert.throws(()=>dispatchM3(db,'m3.readerDataSave',{documentVersionId:randomUUID(),data}))
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
test('unfiled and trash are real filters and soft deletion can be restored without losing metadata',()=>{
 const dir=mkdtempSync(join(tmpdir(),'jian-trash-')),db=openLibrary(dir)
 try{
  const id=dispatchM4(db,'m4.metadataSave',{draft:{title:'Preserved source title',type:'book',date:'2026',language:'en',fields:{publicationTitle:'Source'},creators:[]}})as string
  assert.equal(listItems(db,{unfiled:true}).total,1);softDeleteItem(db,id)
  assert.equal(listItems(db).total,0);assert.equal(listItems(db,{trash:true}).items[0].id,id);assert.equal(getItem(db,id),null)
  assert.equal(getItem(db,id,true)?.title,'Preserved source title');assert.equal(restoreItem(db,id),true);assert.equal(listItems(db).total,1)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
test('known metadata author lines are hidden conservatively; similar body prose is retained',()=>{
 const rows=[block('author',0,'Example Author'),block('body',0,'An Example Author proposed this method.')]
 const result=documentBlocks({0:rows},EMPTY_READER_DATA,{authors:['Example Author']})
 assert.equal(result[0].kind,'margin');assert.equal(result[1].kind,'body')
})
test('anchored notes are counted as notes rather than excerpts in the list and Dashboard',async()=>{
 const {snapshot}=await import('../src/data-service/analytics')
 const dir=mkdtempSync(join(tmpdir(),'jian-note-count-')),db=openLibrary(dir)
 try{
  const item=dispatchM4(db,'m4.metadataSave',{draft:{title:'Note count fixture',type:'book',date:'2026',language:'en',fields:{},creators:[]}})as string
  const doc=randomUUID(),version=randomUUID(),now=new Date().toISOString()
  for(const id of [doc,version])db.run("INSERT INTO entity(id,kind,createdAt,updatedAt) VALUES(?,'document',?,?)",[id,now,now])
  db.run("INSERT INTO document(id,itemId,displayName,contentType,activeVersionId) VALUES(?,?,'fixture.pdf','application/pdf',?)",[doc,item,version]);db.run("INSERT INTO document_version(id,documentId,externalGrantId,fingerprint) VALUES(?,?,'fixture','fixture')",[version,doc])
  dispatchM3(db,'m3.annotationSave',{documentVersionId:version,type:'note',quote:'Source',comment:'My note',anchors:[{documentVersionId:version,pageIndex:0,rects:[[1,1,10,10]],exact:'Source'}]})
  const row=listItems(db).items[0];assert.equal(row.noteCount,1);assert.equal(row.annotationCount,0)
  const dash=snapshot(db,{range:'all',timezone:'Asia/Shanghai'});assert.equal(dash.library.notes,1);assert.equal(dash.library.annotations,0)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
