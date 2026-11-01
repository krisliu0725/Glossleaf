import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {Db} from './db'
import {DEFAULT_PALETTE,PALETTES,orderAnnotations} from '../shared/annotations'
import type {Annotation} from '../shared/m3'
const rect=z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()])
export const anchorSchema=z.object({documentVersionId:z.string().uuid(),pageLabel:z.string().max(100).optional(),pageIndex:z.number().int().min(0).max(100000),rects:z.array(rect).max(2000),exact:z.string().max(50000),kind:z.enum(['text','point']).optional(),point:z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)]).optional(),prefix:z.string().max(500).optional(),suffix:z.string().max(500).optional(),orderKey:z.number().finite().optional()}).superRefine((a,c)=>{if(a.kind==='point'?!a.point:!a.rects.length)c.addIssue({code:'custom',message:'无效选区坐标'});if(a.rects.some(r=>r[2]<=r[0]||r[3]<=r[1]))c.addIssue({code:'custom',message:'无效选区坐标'})})
const schema=z.object({markStyle:z.enum(['highlight','underline']).optional(),id:z.string().uuid().optional(),revision:z.number().int().min(0).optional(),deleted:z.boolean().optional(),documentVersionId:z.string().uuid(),anchors:z.array(anchorSchema).min(1).max(100),quote:z.string().max(50000),comment:z.string().max(50000),type:z.enum(['highlight','excerpt','note']),color:z.string().regex(/^#[0-9a-f]{6}$/i).optional(),paletteId:z.enum(['zotero','legacy',...PALETTES.map(p=>p.id)]as [string,...string[]]).optional(),slot:z.number().int().min(1).max(6).nullable().optional(),highlightId:z.string().uuid().nullable().optional(),translation:z.object({text:z.string().max(100000),status:z.enum(['completed','needs_review']),providerFingerprint:z.string(),inputSnapshot:z.string()}).optional()})
export function normalizeAnnotationComments(db:Db,withinTransaction=false):void{
 const work=()=>{for(const a of db.all("SELECT a.* FROM annotation a JOIN entity e ON e.id=a.id WHERE a.type IN ('highlight','excerpt') AND trim(coalesce(a.comment,''))!='' AND e.deletedAt IS NULL")){
 const existing=db.get("SELECT id FROM annotation WHERE highlightId=? AND type='note'",[a.id]),id=existing?.id??randomUUID(),now=new Date().toISOString()
 if(!existing)db.run("INSERT INTO entity(id,kind,createdAt,updatedAt) VALUES(?,'annotation',?,?)",[id,now,now])
 db.run("INSERT INTO annotation(id,documentVersionId,type,quote,comment,color,anchorsJson,highlightId,paletteId) VALUES(?,?,'note',?,?,?, ?,?,'legacy') ON CONFLICT(id) DO UPDATE SET comment=excluded.comment,quote=excluded.quote,anchorsJson=excluded.anchorsJson",[id,a.documentVersionId,a.quote,a.comment,'#913E32',a.anchorsJson,a.id])
 db.run("UPDATE annotation SET comment='' WHERE id=?",[a.id])
 }};if(withinTransaction)work();else db.transaction(work)
}
export function saveAnnotation(db:Db,raw:unknown):string{
 const p=schema.parse(raw),version=db.get('SELECT pageCount FROM document_version WHERE id=?',[p.documentVersionId]);if(!version)throw Error('文档版本不存在')
 if(p.type==='note'&&!p.comment.trim())throw Error('朱批不能为空')
 if(p.type!=='note'&&(!p.quote.trim()||p.anchors.some(a=>a.kind==='point')))throw Error('高亮需要文字选区')
 for(const a of p.anchors)if(a.documentVersionId!==p.documentVersionId||version.pageCount&&a.pageIndex>=Number(version.pageCount))throw Error('锚点不属于当前文档')
 return db.transaction(()=>{
 const old=p.id?db.get('SELECT a.documentVersionId,e.revision FROM annotation a JOIN entity e ON e.id=a.id WHERE a.id=?',[p.id]):null
 if(p.id&&!old)throw Error('批注不存在');if(old&&old.documentVersionId!==p.documentVersionId)throw Error('锚点不属于当前文档');if(old&&p.revision!==undefined&&Number(old.revision)!==p.revision)throw Error('批注已更新，请重新打开后再试')
 let anchors=p.anchors
 if(p.highlightId){const parent=db.get("SELECT a.* FROM annotation a JOIN entity e ON e.id=a.id WHERE a.id=?",[p.highlightId]);if(!parent||parent.documentVersionId!==p.documentVersionId||parent.type==='note')throw Error('关联高亮不存在');anchors=JSON.parse(String(parent.anchorsJson))}
 const id=p.id??randomUUID(),time=new Date().toISOString();if(!p.id)db.run("INSERT INTO entity(id,kind,createdAt,updatedAt) VALUES(?,'annotation',?,?)",[id,time,time])
 let record:null|string=null
 if(p.translation&&!p.id){record=id;db.run('INSERT INTO translation_record(id,inputSnapshot,output,providerFingerprint,status,createdAt) VALUES(?,?,?,?,?,?)',[record,p.translation.inputSnapshot,p.translation.text,p.translation.providerFingerprint,p.translation.status,time])}
 const color=p.color??(p.type==='note'?'#913E32':'#549C9A')
 if(p.id)db.run('UPDATE annotation SET type=?,quote=?,comment=?,color=?,anchorsJson=?,paletteId=?,slot=?,highlightId=? WHERE id=?',[p.type,p.quote,p.comment,color,JSON.stringify(anchors),p.paletteId??'legacy',p.slot??null,p.highlightId??null,id])
 else db.run('INSERT INTO annotation(id,documentVersionId,type,quote,comment,color,anchorsJson,translationRecordId,paletteId,slot,highlightId) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id,p.documentVersionId,p.type,p.quote,p.comment,color,JSON.stringify(anchors),record,p.paletteId??'legacy',p.slot??null,p.highlightId??null])
 db.run('UPDATE annotation SET markStyle=? WHERE id=?',[p.markStyle??'highlight',id])
 db.run('UPDATE entity SET deletedAt=?,updatedAt=?,revision=revision+1 WHERE id=?',[p.deleted?time:null,time,id])
 return id
 })
}
export function annotations(db:Db,documentVersionId:string):Annotation[]{
 normalizeAnnotationComments(db)
 return db.all('SELECT a.*,r.output AS translation,r.status FROM reading_items a LEFT JOIN translation_record r ON r.id=a.translationRecordId WHERE a.documentVersionId=?',[documentVersionId]).map(r=>{
 const raw=JSON.parse(String(r.anchorsJson)),anchors=Array.isArray(raw)?raw:raw.rects?[{...raw,documentVersionId,exact:String(r.quote)}]:[]
 return {markStyle:(r.markStyle==='underline'?'underline':'highlight') as Annotation['markStyle'],id:String(r.id),documentVersionId,type:String(r.type),quote:String(r.quote),comment:String(r.comment??''),color:String(r.color??'#B78D3B'),stackOrder:Number(r.stackOrder),sourcePayload:r.sourcePayload?String(r.sourcePayload):null,paletteId:String(r.paletteId),slot:r.slot===null?null:Number(r.slot),highlightId:r.highlightId?String(r.highlightId):null,anchors,translation:r.translation?String(r.translation):null,status:r.status?String(r.status):null,createdAt:String(r.createdAt),revision:Number(r.revision)}
 }).sort(orderAnnotations)
}
export function paletteSettings(db:Db,value:unknown){const old={...DEFAULT_PALETTE,...JSON.parse(String(db.get("SELECT value FROM meta WHERE key='highlight_palette'")?.value??'{}'))};if(value!==undefined){const patch=z.object({paletteId:z.enum(PALETTES.map(p=>p.id)as [string,...string[]]).optional(),opacity:z.number().min(.25).max(.55).optional(),recentSlot:z.number().int().min(1).max(6).optional()}).strict().parse(value);Object.assign(old,patch);db.run("INSERT OR REPLACE INTO meta(key,value) VALUES('highlight_palette',?)",[JSON.stringify(old)])}return old}
