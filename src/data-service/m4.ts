import {readingTools} from './reading-tools'
import {effectivePageLabels} from '../shared/reading-tools'
import {doiHints} from '../shared/metadata-match'
import { readAnchors } from '../shared/anchors'
import { randomUUID } from 'node:crypto'
import type { Db, Row } from './db'
import { getItem } from './repo'
import { ftsQuery, matches, normalizeText, queryTokens, snippet } from '../shared/search-text'
import { metadataSchema, normalizeDoi } from '../shared/metadata'
import type { IndexPage, SearchQuery, SearchResponse, SearchHit, TextRun, MetadataDraft } from '../shared/m4'
import type { PdfAnchor, Rect } from '../shared/m3'
const parserVersion = 'pdfjs-6.4.299/search-1'
function putSource(db: Db, value: { key: string; itemId: string; kind: string; version?: string; page?: number; annotation?: string; text: string; runs?: TextRun[] }): void {
 const normalized = normalizeText(value.text)
 db.run(`INSERT INTO search_source(sourceKey,itemId,kind,documentVersionId,pageIndex,annotationId,rawText,normalizedText,offsetsJson,runsJson)
 VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sourceKey) DO UPDATE SET itemId=excluded.itemId,kind=excluded.kind,documentVersionId=excluded.documentVersionId,pageIndex=excluded.pageIndex,annotationId=excluded.annotationId,rawText=excluded.rawText,normalizedText=excluded.normalizedText,offsetsJson=excluded.offsetsJson,runsJson=excluded.runsJson`,
 [value.key,value.itemId,value.kind,value.version??null,value.page??null,value.annotation??null,value.text,normalized.text,JSON.stringify(normalized.offsets),JSON.stringify(value.runs??[])])
}
function syncDirty(db: Db): number {
 if (!db.get("SELECT value FROM meta WHERE key='search_classification_version'")) db.transaction(() => {
  db.run("INSERT OR IGNORE INTO search_dirty SELECT 'item:'||itemId,'metadata',itemId FROM analytics_classification");
  db.run("INSERT INTO meta VALUES('search_classification_version','1')");
 });
 const dirty = db.all('SELECT * FROM search_dirty LIMIT 200')
 db.transaction(() => {
  for (const row of dirty) {
   const key=String(row.sourceKey), id=String(row.entityId)
   if (row.kind==='metadata') {
    const item=getItem(db,id)
    const classification=db.get('SELECT topicsJson,field FROM analytics_classification WHERE itemId=?',[id])
    if (item) putSource(db,{key,itemId:id,kind:'metadata',text:[item.title,item.creators,item.date,item.language,...item.tags,...(classification ? JSON.parse(String(classification.topicsJson)) as string[] : []),classification?.field,...Object.entries(item.fields).filter(([k])=>!['metadataSourceJson'].includes(k)).map(([,v])=>v)].filter(Boolean).join('\n')})
    else db.run('DELETE FROM search_source WHERE sourceKey=?',[key])
   } else {
    const a=db.get(`SELECT a.*,d.itemId,t.output FROM annotation a JOIN document_version v ON v.id=a.documentVersionId JOIN document d ON d.id=v.documentId LEFT JOIN translation_record t ON t.id=a.translationRecordId JOIN entity e ON e.id=a.id WHERE a.id=? AND e.deletedAt IS NULL`,[id])
    if (a?.itemId) {
     const anchors=readAnchors(String(a.anchorsJson),String(a.documentVersionId),String(a.quote))
     putSource(db,{key,itemId:String(a.itemId),kind:'excerpts',version:String(a.documentVersionId),page:anchors[0]?.pageIndex??0,annotation:id,text:[a.quote,a.output,a.comment].filter(Boolean).join('\n')})
    } else db.run('DELETE FROM search_source WHERE sourceKey=?',[key])
   }
   db.run('DELETE FROM search_dirty WHERE sourceKey=?',[key])
  }
 })
 return Number(db.get('SELECT count(*) AS n FROM search_dirty')?.n??0)
}
export function search(db: Db, q: SearchQuery): SearchResponse {
 const pendingMetadata=syncDirty(db), tokens=queryTokens(q.query), fts=ftsQuery(tokens), cursor=q.cursor??0
 if (!tokens.length) return {groups:[],nextCursor:null,scanned:0,limitedScan:false,pendingMetadata}
 const limit=fts?300:800
 const rows=db.all(`SELECT s.*,i.title,a.anchorsJson,a.type AS annotationType FROM search_source s
 JOIN item i ON i.id=s.itemId JOIN entity e ON e.id=i.id
 LEFT JOIN document_version v ON v.id=s.documentVersionId LEFT JOIN document d ON d.id=v.documentId
 LEFT JOIN annotation a ON a.id=s.annotationId LEFT JOIN entity ae ON ae.id=s.annotationId
 WHERE e.deletedAt IS NULL AND (?='all' OR s.kind=?)
 AND (? IS NULL OR EXISTS(SELECT 1 FROM collection_item ci WHERE ci.itemId=i.id AND ci.collectionId=?))
 AND (? IS NULL OR s.documentVersionId=?)
 AND (s.kind!='body' OR (d.activeVersionId=s.documentVersionId AND d.availability='managed'))
 AND (s.kind!='excerpts' OR (a.id IS NOT NULL AND ae.deletedAt IS NULL))
 ${fts ? 'AND s.rowid IN (SELECT rowid FROM search_content_fts WHERE search_content_fts MATCH ?)' : ''}
 ORDER BY CASE WHEN s.kind='metadata' AND lower(i.title)=lower(?) THEN -1 WHEN s.kind='metadata' THEN 0 WHEN s.kind='excerpts' THEN 1 ELSE 2 END,s.itemId,s.documentVersionId,s.pageIndex,s.rowid LIMIT ? OFFSET ?`,
 [q.scope,q.scope,q.collectionId??null,q.collectionId??null,q.documentVersionId??null,q.documentVersionId??null,...(fts?[fts]:[]),q.query,limit+1,cursor])
 const groups=new Map<string,{itemId:string;title:string;hits:SearchHit[]}>()
 let consumed=0
 for (const r of rows.slice(0,limit)) {
  consumed++
  const normalized={text:String(r.normalizedText),offsets:JSON.parse(String(r.offsetsJson)) as Array<[number,number]>}, ranges=matches(normalized.text,tokens)
  if (!ranges) continue
  const sn=snippet(String(r.rawText),normalized,ranges), version=r.documentVersionId?String(r.documentVersionId):null
  let anchor:PdfAnchor|null=null
  if (r.kind==='excerpts') anchor=readAnchors(String(r.anchorsJson),version??'',String(r.rawText))[0]??null
  if (r.kind==='body' && version) {
   const runs=JSON.parse(String(r.runsJson)) as TextRun[], rects=runs.filter(run=>sn.rawRanges.some(([a,b])=>run.end>a&&run.start<b)).map(run=>run.rect)
   anchor={documentVersionId:version,pageIndex:Number(r.pageIndex),rects:rects.slice(0,100),exact:sn.rawRanges.map(([a,b])=>String(r.rawText).slice(a,b)).join(' ')}
  }
  const hit:SearchHit={annotationType:r.annotationType?String(r.annotationType):undefined,id:String(r.sourceKey),kind:r.kind as SearchHit['kind'],itemId:String(r.itemId),title:String(r.title),documentVersionId:version,pageIndex:r.pageIndex===null?null:Number(r.pageIndex),annotationId:r.annotationId?String(r.annotationId):null,snippet:sn.snippet,marks:sn.marks,anchor}
  const group=groups.get(hit.itemId)??{itemId:hit.itemId,title:hit.title,hits:[]};group.hits.push(hit);groups.set(hit.itemId,group)
  if ([...groups.values()].reduce((n,g)=>n+g.hits.length,0)>=80) break
 }
 return {groups:[...groups.values()].sort((a,b)=>Number(normalizeText(b.title).text===normalizeText(q.query).text)-Number(normalizeText(a.title).text===normalizeText(q.query).text)),nextCursor:consumed<rows.length?cursor+consumed:null,scanned:consumed,limitedScan:!fts,pendingMetadata}
}
function seedIndex(db: Db): void {
 db.run(`INSERT OR IGNORE INTO document_index(documentVersionId,fingerprint,parserVersion,status,updatedAt)
 SELECT v.id,v.fingerprint,?,'pending',? FROM document_version v JOIN document d ON d.activeVersionId=v.id JOIN entity e ON e.id=d.itemId WHERE d.contentType='application/pdf' AND d.availability='managed' AND e.deletedAt IS NULL`,[parserVersion,new Date().toISOString()])
 // A version's fingerprint is immutable in normal use; mismatches invalidate derived pages.
 const stale=db.all('SELECT x.documentVersionId FROM document_index x JOIN document_version v ON v.id=x.documentVersionId WHERE x.fingerprint!=v.fingerprint OR x.parserVersion!=?',[parserVersion])
 for (const r of stale) {
  db.run("DELETE FROM search_source WHERE kind='body' AND documentVersionId=?",[r.documentVersionId])
  db.run("UPDATE document_index SET fingerprint=(SELECT fingerprint FROM document_version WHERE id=?),parserVersion=?,status='pending',pageCount=NULL,error=NULL WHERE documentVersionId=?",[r.documentVersionId,parserVersion,r.documentVersionId])
 }
}
export function dispatchM4(db: Db, method: string, p: Record<string,unknown>): unknown {
 switch(method) {
  case 'm4.syncMetadata': return syncDirty(db)
  case 'm4.search': return search(db,p as unknown as SearchQuery)
  case 'm4.indexStats': {
   seedIndex(db)
   const rows=db.all(`SELECT x.*,i.title FROM document_index x JOIN document_version v ON v.id=x.documentVersionId JOIN document d ON d.activeVersionId=v.id JOIN item i ON i.id=d.itemId JOIN entity e ON e.id=i.id WHERE e.deletedAt IS NULL AND d.availability='managed'`)
   return {total:rows.length,completed:rows.filter(r=>r.status==='completed').length,failed:rows.filter(r=>r.status==='failed').length,pages:Number(db.get("SELECT count(*) AS n FROM search_source WHERE kind='body'")?.n??0),errors:rows.filter(r=>r.status==='failed').slice(0,8).map(r=>({title:r.title,error:r.error}))}
  }
  case 'm4.indexReset': {seedIndex(db); db.run("UPDATE document_index SET status='pending' WHERE status='indexing' OR (? AND status='failed')",[p.retry?1:0]);return true}
  case 'm4.indexNext': {
   seedIndex(db)
   const r=db.get(`SELECT x.*,i.title FROM document_index x JOIN document_version v ON v.id=x.documentVersionId JOIN document d ON d.activeVersionId=v.id JOIN item i ON i.id=d.itemId JOIN entity e ON e.id=i.id WHERE x.status='pending' AND e.deletedAt IS NULL AND d.availability='managed' ORDER BY x.documentVersionId LIMIT 1`)
   if(!r)return null
   db.run("UPDATE document_index SET status='indexing',error=NULL WHERE documentVersionId=?",[r.documentVersionId])
   return {...r,completedPages:db.all("SELECT pageIndex FROM search_source WHERE kind='body' AND documentVersionId=?",[r.documentVersionId]).map(r=>Number(r.pageIndex))}
  }
  case 'm4.indexPage': {
   const v=p as unknown as IndexPage
   const doc=db.get(`SELECT d.itemId FROM document d JOIN document_version v ON d.activeVersionId=v.id JOIN document_index x ON x.documentVersionId=v.id WHERE v.id=? AND x.status='indexing' AND x.fingerprint=v.fingerprint`,[v.documentVersionId])
   if(!doc?.itemId)throw new Error('索引版本已变化或任务已暂停')
   putSource(db,{key:`page:${v.documentVersionId}:${v.pageIndex}`,itemId:String(doc.itemId),kind:'body',version:v.documentVersionId,page:v.pageIndex,text:v.text,runs:v.runs})
   return true
  }
  case 'm4.indexFinish': {
   if(!p.error) {
    const count=Number(db.get("SELECT count(*) AS n FROM search_source WHERE documentVersionId=? AND kind='body' AND pageIndex>=0 AND pageIndex<?",[p.id,p.pageCount])?.n??0)
    if(count!==p.pageCount)throw new Error('文档页级索引不完整，将保留检查点')
   }
   if(!p.error)db.run('UPDATE document_version SET pageCount=? WHERE id=?',[p.pageCount,p.id])
   db.run('UPDATE document_index SET status=?,pageCount=?,error=?,updatedAt=? WHERE documentVersionId=?',[p.error?'failed':'completed',p.pageCount,p.error??null,new Date().toISOString(),p.id])
   return true
  }
  case 'm4.metadataHints': {
   const item=getItem(db,String(p.id));if(!item)throw new Error('文献不存在')
   const pages=db.all("SELECT s.rawText FROM search_source s JOIN document d ON d.activeVersionId=s.documentVersionId WHERE d.itemId=? AND s.kind='body' AND s.pageIndex<2 ORDER BY s.pageIndex LIMIT 2",[p.id])
   return {dois:doiHints([item.fields.DOI??'',...pages.map(r=>String(r.rawText).slice(0,30000))].join('\n')),indexedPages:pages.length}
  }
  case 'm4.duplicates': return duplicates(db,String(p.doi))
  case 'm4.metadataSave': return saveMetadata(db,p.id?String(p.id):null,metadataSchema.parse(p.draft),!!p.allowDuplicate)
  case 'm4.exportData': {
   return (p.ids as string[]).map(id=>{
    const item=getItem(db,id);if(!item)throw new Error('部分文献不存在或已删除')
    const annotations=db.all(`SELECT a.*,t.output,e.createdAt FROM annotation a JOIN entity e ON e.id=a.id JOIN document_version v ON v.id=a.documentVersionId JOIN document d ON d.id=v.documentId LEFT JOIN translation_record t ON t.id=a.translationRecordId WHERE d.itemId=? AND e.deletedAt IS NULL ORDER BY a.documentVersionId,a.id`,[id])
    const labelsByVersion=new Map<string,string[]>();for(const a of annotations){const version=String(a.documentVersionId),anchors=readAnchors(String(a.anchorsJson),version,String(a.quote));let labels=labelsByVersion.get(version);if(!labels){const count=Number(db.get('SELECT pageCount FROM document_version WHERE id=?',[version])?.pageCount??0);labels=effectivePageLabels(readingTools(db,version),Math.max(count,...anchors.map(x=>x.pageIndex+1),0));labelsByVersion.set(version,labels)}a.anchorsJson=JSON.stringify(anchors.map(x=>({...x,pageLabel:labels![x.pageIndex]??String(x.pageIndex+1)})))}
    return {item,annotations}
   })
  }
  default:throw new Error('未知 M4 方法')
 }
}
function duplicates(db: Db, doi: string): Array<{id:string;title:string}> {
 return db.all('SELECT i.id,i.title,i.fieldsJson FROM item i JOIN entity e ON e.id=i.id WHERE e.deletedAt IS NULL').filter(r=>{try{return normalizeDoi(String(JSON.parse(String(r.fieldsJson)).DOI??''))===doi}catch{return false}}).map(r=>({id:String(r.id),title:String(r.title)}))
}
function saveMetadata(db: Db,id: string|null,draft: MetadataDraft,allowDuplicate: boolean): string {
 const doi=draft.fields.DOI?normalizeDoi(draft.fields.DOI):null
 if(doi&&!allowDuplicate&&duplicates(db,doi).some(r=>r.id!==id))throw new Error('文库中已有相同 DOI；请打开已有文献，或明确选择保留独立条目')
 if(id&&!getItem(db,id))throw new Error('文献不存在')
 return db.transaction(()=>{
  const itemId=id??randomUUID(),now=new Date().toISOString()
  if(!id)db.run("INSERT INTO entity(id,kind,createdAt,updatedAt) VALUES(?,'item',?,?)",[itemId,now,now])
  else db.run('UPDATE entity SET updatedAt=?,revision=revision+1 WHERE id=?',[now,itemId])
  const fields={...draft.fields,...(doi?{DOI:doi}:{})}
  const precision=draft.date?/^\d{4}-\d{2}-\d{2}/.test(draft.date)?'day':/^\d{4}-\d{2}/.test(draft.date)?'month':/^\d{4}$/.test(draft.date)?'year':'literal':null
  db.run(`INSERT INTO item(id,type,title,fieldsJson,language,date,datePrecision) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,title=excluded.title,fieldsJson=excluded.fieldsJson,language=excluded.language,date=excluded.date,datePrecision=excluded.datePrecision`,[itemId,draft.type,draft.title,JSON.stringify(fields),draft.language,draft.date,precision])
  db.run('DELETE FROM item_creator WHERE itemId=?',[itemId])
  for(const [order,c] of draft.creators.entries())db.run('INSERT INTO item_creator(itemId,orderIndex,role,nameMode,givenName,familyName,literalName) VALUES(?,?,?,?,?,?,?)',[itemId,order,c.role,c.nameMode,c.givenName,c.familyName,c.literalName])
  return itemId
 })
}
export type ExportRow = { item: NonNullable<ReturnType<typeof getItem>>; annotations: Row[] }
export type { Rect }
