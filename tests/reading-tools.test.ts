import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {DEFAULT_READING_TOOLS,effectivePageLabels,parsePageDestination,packMarginEntries} from '../src/shared/reading-tools'
import {readingTools} from '../src/data-service/reading-tools'
import {openLibrary} from '../src/data-service/db'
import {importPdf} from '../src/data-service/repo'
import {saveAnnotation,annotations} from '../src/data-service/annotations'
import {notesMarkdown,annotationDraft} from '../src/shared/annotations'
import {dispatchM4} from '../src/data-service/m4'
test('page navigation distinguishes unique printed labels, physical pages, relative jumps and ambiguous labels',()=>{
 const labels=effectivePageLabels({...DEFAULT_READING_TOOLS,pageLabels:['i','ii','189','190']},4)
 assert.deepEqual(labels,['i','ii','189','190']);assert.equal(parsePageDestination('II',1,4,labels),2);assert.equal(parsePageDestination('190',1,4,labels),4);assert.equal(parsePageDestination('3',1,4,labels),3);assert.equal(parsePageDestination('+3',2,4,labels),4);assert.equal(parsePageDestination('-2',4,4,labels),2);assert.equal(parsePageDestination('-99',4,4,labels),1);assert.equal(parsePageDestination('189x',1,4,labels),null);assert.equal(parsePageDestination('189',1,4,['189','189','a','b']),null);assert.equal(parsePageDestination('',1,4,labels),null);assert.equal(parsePageDestination('1',1,0,[]),null)
 assert.deepEqual(effectivePageLabels({pageLabels:labels,printedStart:301},4),['301','302','303','304'])
})
test('margin collision packing keeps stable order and leaves space between adjacent cards',()=>{
 const input=[{id:'b',top:50,height:22},{id:'a',top:50,height:200},{id:'c',top:200,height:22}],original=JSON.stringify(input),out=packMarginEntries(input,700)
 assert.deepEqual(out.map(e=>e.id),['a','b','c']);assert.equal(out[0].top,50);assert.ok(out.every((e,i)=>i===0||e.top>=out[i-1].top+out[i-1].height+10));assert.equal(JSON.stringify(input),original);assert.equal(out[1].naturalTop,50)
})
test('reading preferences merge independent patches, remain version-isolated, validate bookmarks and survive reopening',async()=>{
 const root=mkdtempSync(join(tmpdir(),'glossleaf-reading-tools-')),dir=join(root,'library'),f1=join(root,'a.pdf'),f2=join(root,'b.pdf');let db=openLibrary(dir)
 try{writeFileSync(f1,'%PDF-1.7\nfirst\n%%EOF');writeFileSync(f2,'%PDF-1.7\nsecond\n%%EOF');const docs=await importPdf(db,dir,[f1,f2]),v=docs[0].documentVersionId,v2=docs[1].documentVersionId;db.run('UPDATE document_version SET pageCount=13 WHERE id=?',[v]);const bookmark={id:randomUUID(),pageIndex:4,title:'Methods',createdAt:new Date().toISOString()};readingTools(db,v,{bookmarks:[bookmark],pageLabels:['189','190']});readingTools(db,v,{paper:'rice',noteLayout:'drawer'});assert.equal(readingTools(db,v).bookmarks[0].pageIndex,4);assert.equal(readingTools(db,v2).bookmarks.length,0);assert.throws(()=>readingTools(db,v,{bookmarks:[{...bookmark,pageIndex:13}]}),/超出/);assert.throws(()=>readingTools(db,v,{bookmarks:[bookmark,bookmark]}));assert.throws(()=>readingTools(db,v,{brightness:.2}));assert.throws(()=>readingTools(db,v,{secret:'no'}));assert.throws(()=>readingTools(db,randomUUID(),{}),/不存在/);db.close();db=openLibrary(dir);assert.equal(readingTools(db,v).paper,'rice');assert.deepEqual(readingTools(db,v).bookmarks,[bookmark]);assert.equal(readingTools(db,v).noteLayout,'drawer');assert.equal(readingTools(db,v).pageLabels[0],'189')
 }finally{db.close();rmSync(root,{recursive:true,force:true})}
})
test('underline style and printed page labels round-trip without rewriting original physical anchors',async()=>{
 const root=mkdtempSync(join(tmpdir(),'glossleaf-reading-marks-')),dir=join(root,'library'),file=join(root,'a.pdf'),db=openLibrary(dir)
 try{writeFileSync(file,'%PDF-1.7\nfixture\n%%EOF');const [doc]=await importPdf(db,dir,[file]),v=doc.documentVersionId,anchors=[{documentVersionId:v,pageIndex:0,pageLabel:'189',rects:[[10,20,90,40]as[number,number,number,number]],exact:'Evidence quote'}];saveAnnotation(db,{documentVersionId:v,type:'highlight',markStyle:'underline',anchors,quote:'Evidence quote',comment:''});saveAnnotation(db,{documentVersionId:v,type:'note',anchors,quote:'Evidence quote',comment:'？ Verify claim'});readingTools(db,v,{printedStart:301});const rows=annotations(db,v);assert.equal(rows.find(a=>a.type==='highlight')?.markStyle,'underline');assert.equal(annotationDraft(rows.find(a=>a.type==='highlight')!).markStyle,'underline');const labels=effectivePageLabels(readingTools(db,v),1),md=notesMarkdown('Title','DOI test',rows,true,{labels,includeQuotes:true}),quiet=notesMarkdown('Title','DOI test',rows,true,{labels,includeQuotes:false});assert.match(md,/301/);assert.match(md,/PDF 1/);assert.match(md,/Evidence quote/);assert.equal(quiet.includes('Evidence quote'),false);assert.match(quiet,/Verify claim/);assert.deepEqual(annotations(db,v)[0].anchors,anchors);assert.equal(db.all('PRAGMA foreign_key_check').length,0)
 const data=dispatchM4(db,'m4.exportData',{ids:[doc.itemId]}) as any
 assert.equal(JSON.parse(data[0].annotations[0].anchorsJson)[0].pageLabel,'301');assert.ok(data[0].annotations.some((a:any)=>a.markStyle==='underline'))
 }finally{db.close();rmSync(root,{recursive:true,force:true})}
})
