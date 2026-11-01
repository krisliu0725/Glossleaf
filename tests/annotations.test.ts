import {mergeHighlightRects} from '../src/shared/highlight-geometry'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {openLibrary,Db} from '../src/data-service/db'
import {SCHEMA_SQL,MIGRATIONS} from '../src/data-service/schema'
import {importPdf} from '../src/data-service/repo'
import {saveAnnotation,annotations,paletteSettings,normalizeAnnotationComments} from '../src/data-service/annotations'
import {dispatchM3} from '../src/data-service/m3'
import {dispatchM4} from '../src/data-service/m4'
import {createBackup,verifyBackup,applyRestore} from '../src/data-service/backup'
import {annotationDraft,groupMarkers,projectAnnotations,notesMarkdown} from '../src/shared/annotations'
import {readAnchors} from '../src/shared/anchors'
async function fixture(){const root=mkdtempSync(join(tmpdir(),'glossleaf-annotation-')),dir=join(root,'library'),file=join(root,'original.pdf'),db=openLibrary(dir);writeFileSync(file,'%PDF-1.7\nsynthetic\n%%EOF');const [doc]=await importPdf(db,dir,[file]);const version=doc.documentVersionId,anchors=[{documentVersionId:version,pageIndex:0,rects:[[10,20,80,40]as [number,number,number,number]],exact:'A precise quote',prefix:'Before ',suffix:' after',orderKey:-40}];return {root,dir,file,db,version,anchors,close(){db.close();rmSync(root,{recursive:true,force:true})}}}
test('highlights and margin notes share anchors but have independent lifetimes; edits reject stale revisions',async()=>{
 const f=await fixture();try{const h=saveAnnotation(f.db,{documentVersionId:f.version,type:'highlight',anchors:f.anchors,quote:'A precise quote',comment:'',color:'#549C9A',paletteId:'porcelain',slot:1}),n=saveAnnotation(f.db,{documentVersionId:f.version,type:'note',anchors:f.anchors,quote:'A precise quote',comment:'Revisit this argument',highlightId:h});const rows=annotations(f.db,f.version),high=rows.find(a=>a.id===h)!,note=rows.find(a=>a.id===n)!;assert.deepEqual(note.anchors,high.anchors);assert.equal(projectAnnotations(rows).length,1);assert.equal(projectAnnotations(rows)[0].notes[0].id,n)
 saveAnnotation(f.db,{...annotationDraft(high),deleted:true});let left=annotations(f.db,f.version);assert.equal(left.length,1);assert.equal(left[0].id,n);saveAnnotation(f.db,{...annotationDraft(note),comment:'Independent after deletion'});left=annotations(f.db,f.version);assert.equal(left[0].comment,'Independent after deletion');assert.throws(()=>saveAnnotation(f.db,{...annotationDraft(note),comment:'Stale edit'}),/已更新/)
 const restored={...annotationDraft(high)};delete restored.revision;saveAnnotation(f.db,restored);assert.equal(annotations(f.db,f.version).length,2);const n2=annotations(f.db,f.version).find(a=>a.id===n)!;saveAnnotation(f.db,{...annotationDraft(n2),deleted:true});assert.equal(annotations(f.db,f.version)[0].id,h)
 }finally{f.close()}
})
test('point notes validate normalized coordinates, reject empty bodies at API and SQL layers, and index their text',async()=>{
 const f=await fixture();try{const point={documentVersionId:f.version,pageIndex:0,kind:'point',point:[.25,.6],rects:[],exact:''},data={documentVersionId:f.version,type:'note',anchors:[point],quote:'',comment:'Unique margin thought'};const id=saveAnnotation(f.db,data);assert.equal(annotations(f.db,f.version)[0].id,id);assert.deepEqual(readAnchors(JSON.stringify([point]),f.version)[0].point,[.25,.6]);assert.throws(()=>saveAnnotation(f.db,{...data,comment:'   '}),/不能为空/);assert.throws(()=>saveAnnotation(f.db,{...data,anchors:[{...point,point:[1.01,0]}]}));assert.throws(()=>saveAnnotation(f.db,{...data,type:'highlight'}),/高亮/);assert.throws(()=>f.db.run("UPDATE annotation SET comment=' ' WHERE id=?",[id]),/empty/)
 const hits=dispatchM4(f.db,'m4.search',{query:'Unique margin',scope:'all'})as any;assert.ok(hits.groups[0].hits.some((h:any)=>h.annotationId===id&&h.annotationType==='note'&&h.anchor.kind==='point'))
 }finally{f.close()}
})
test('palette changes preserve history colours and opacity updates never rewrite annotation records',async()=>{
 const f=await fixture();try{const id=saveAnnotation(f.db,{documentVersionId:f.version,type:'highlight',anchors:f.anchors,quote:'quote',comment:'',color:'#549C9A',paletteId:'porcelain',slot:1}),before=f.db.get('SELECT * FROM annotation WHERE id=?',[id]);paletteSettings(f.db,{paletteId:'moonlight',opacity:.55,recentSlot:3});assert.deepEqual(f.db.get('SELECT * FROM annotation WHERE id=?',[id]),before);assert.equal(paletteSettings(f.db,undefined).opacity,.55);assert.throws(()=>paletteSettings(f.db,{opacity:.1}));assert.throws(()=>paletteSettings(f.db,{paletteId:'unknown'}));const a=annotations(f.db,f.version)[0];saveAnnotation(f.db,{...annotationDraft(a),color:'#A6B192',paletteId:'moonlight',slot:3});assert.equal(annotations(f.db,f.version)[0].color,'#A6B192')
 }finally{f.close()}
})
test('schema 5 upgrades idempotently, preserves source colours and splits legacy comments without duplicate note bodies',async()=>{
 const root=mkdtempSync(join(tmpdir(),'glossleaf-migrate-')),file=join(root,'jian.sqlite');let db=new Db(file)
 try{db.exec(SCHEMA_SQL);for(let v=2;v<=5;v++)db.exec(MIGRATIONS[v]);db.run("INSERT INTO meta VALUES('schema_version','5')");const item=randomUUID(),doc=randomUUID(),version=randomUUID(),id=randomUUID(),time=new Date().toISOString();for(const [key,kind]of [[item,'item'],[doc,'document'],[version,'document'],[id,'annotation']])db.run('INSERT INTO entity(id,kind,createdAt,updatedAt) VALUES(?,?,?,?)',[key,kind,time,time]);db.run("INSERT INTO item(id,type,title) VALUES(?,'document','Fixture')",[item]);db.run("INSERT INTO document(id,itemId,displayName,contentType) VALUES(?,?,'file.pdf','application/pdf')",[doc,item]);db.run("INSERT INTO document_version(id,documentId,externalGrantId,fingerprint) VALUES(?,?,'fixture','hash')",[version,doc]);const a=[{documentVersionId:version,pageIndex:0,rects:[[1,2,30,40]],exact:'Legacy'}];db.run("INSERT INTO annotation(id,documentVersionId,type,quote,comment,color,anchorsJson) VALUES(?,?,'highlight','Legacy','Keep my thought','#ABCDEF',?)",[id,version,JSON.stringify(a)]);db.close();let noteId='';for(let i=0;i<3;i++){db=openLibrary(root);normalizeAnnotationComments(db);const list=annotations(db,version);assert.equal(list.length,2);assert.equal(list.find(a=>a.id===id)?.color,'#ABCDEF');assert.equal(list.find(a=>a.id===id)?.comment,'');const note=list.find(a=>a.type==='note')!;assert.equal(note.comment,'Keep my thought');if(noteId)assert.equal(note.id,noteId);noteId=note.id;assert.equal(db.all("SELECT * FROM annotation WHERE type='note' AND trim(comment)=''").length,0);db.close()}
 }finally{db.close();rmSync(root,{recursive:true,force:true})}
})
test('complete backup restores every annotation field, relationship and palette preference without modifying the PDF',async()=>{
 const f=await fixture();let restored:Db|undefined
 try{const before=readFileSync(f.file),high=saveAnnotation(f.db,{documentVersionId:f.version,type:'highlight',anchors:f.anchors,quote:'A precise quote',comment:'',color:'#A981AB',paletteId:'moonlight',slot:2,markStyle:'underline'});saveAnnotation(f.db,{documentVersionId:f.version,type:'note',anchors:f.anchors,quote:'A precise quote',comment:'Portable thought',highlightId:high});paletteSettings(f.db,{paletteId:'moonlight',opacity:.5});const rows=annotations(f.db,f.version),backup=await createBackup(f.db,f.dir,{appVersion:'0.9.0'}),target=join(f.root,'restored');const fs=await import('node:fs/promises');await fs.mkdir(join(target,'backups'),{recursive:true});await fs.cp(backup.path,join(target,'backups',backup.id),{recursive:true});await applyRestore(target,await verifyBackup(target,backup.id));restored=openLibrary(target);assert.deepEqual(annotations(restored,f.version),rows);assert.deepEqual(paletteSettings(restored,undefined),paletteSettings(f.db,undefined));assert.deepEqual(readFileSync(f.file),before)
 }finally{restored?.close();f.close()}
})
test('projection, Markdown and marker clusters keep linked notes accessible and avoid repeated quotes',async()=>{
 const f=await fixture();try{const h=saveAnnotation(f.db,{documentVersionId:f.version,type:'highlight',anchors:f.anchors,quote:'A precise quote',comment:'',color:'#549C9A',paletteId:'porcelain',slot:1});for(let i=0;i<5;i++)saveAnnotation(f.db,{documentVersionId:f.version,type:'note',anchors:f.anchors,quote:'A precise quote',comment:'Thought '+i,highlightId:h});const rows=annotations(f.db,f.version);assert.equal(projectAnnotations(rows).length,1);assert.equal(projectAnnotations(rows,'notes').length,5);const md=notesMarkdown('A title','DOI 10.1234/example',rows,true);assert.equal(md.match(/A precise quote/g)?.length,1);assert.match(md,/Thought 4/);assert.match(md,/Slot 1 Celadon/);assert.equal(groupMarkers([0,3,9,15,23].map(top=>({top}))).length,1);assert.equal(groupMarkers([0,23,24].map(top=>({top}))).length,2)
 }finally{f.close()}
})
test('annotation writes refuse anchors and highlight parents from another document version',async()=>{
 const f=await fixture();try{const h=saveAnnotation(f.db,{documentVersionId:f.version,type:'highlight',anchors:f.anchors,quote:'quote',comment:''});assert.throws(()=>saveAnnotation(f.db,{documentVersionId:f.version,type:'note',anchors:[{...f.anchors[0],documentVersionId:randomUUID()}],quote:'',comment:'no',highlightId:h}));assert.throws(()=>saveAnnotation(f.db,{documentVersionId:f.version,type:'note',anchors:f.anchors,quote:'',comment:'no',highlightId:randomUUID()}),/高亮不存在/)
 }finally{f.close()}
})
test('500 stored highlights retain stable ordering and load as a single reading projection',async()=>{
 const f=await fixture();try{for(let i=0;i<500;i++)saveAnnotation(f.db,{documentVersionId:f.version,type:'highlight',anchors:[{...f.anchors[0],orderKey:i}],quote:'quote '+i,comment:'',color:'#549C9A',paletteId:'porcelain',slot:1});const start=performance.now(),rows=annotations(f.db,f.version),elapsed=performance.now()-start;assert.equal(rows.length,500);assert.equal(rows[0].quote,'quote 0');assert.equal(rows.at(-1)?.quote,'quote 499');assert.ok(elapsed<150,'data-service annotation load took '+elapsed+'ms');console.log('500 annotation data-service load',elapsed.toFixed(2)+'ms');assert.equal(f.db.all('PRAGMA foreign_key_check').length,0)
 }finally{f.close()}
})

test('highlight visual union joins fragmented glyphs without bridging columns, lines or superscripts',()=>{const input:[number,number,number,number][]=[[10,20,15,30],[15.3,20.2,22,30.2],[22.4,20,30,30],[80,20,100,30],[10,5,30,15],[31,27,34,33]];const original=JSON.stringify(input),merged=mergeHighlightRects(input);assert.equal(merged.length,4);assert.ok(merged.some(r=>r[0]===10&&r[2]===30&&r[1]===20&&r[3]===30.2));assert.ok(merged.some(r=>r[0]===80));assert.ok(merged.some(r=>r[1]===5));assert.equal(JSON.stringify(input),original)})
