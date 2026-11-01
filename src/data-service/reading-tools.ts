import {z} from 'zod'
import type {Db} from './db'
import {DEFAULT_READING_TOOLS,type ReadingTools} from '../shared/reading-tools'
const bookmark=z.object({id:z.string().uuid(),pageIndex:z.number().int().min(0).max(100000),title:z.string().trim().min(1).max(300),createdAt:z.string().datetime()})
const schema=z.object({pageLabels:z.array(z.string().max(100)).max(50000),printedStart:z.number().int().min(1).max(10000000).nullable(),bookmarks:z.array(bookmark).max(5000).refine(v=>new Set(v.map(b=>b.id)).size===v.length),singlePage:z.boolean(),paper:z.enum(['original','rice','night']),brightness:z.number().min(.6).max(1.2),noteFont:z.enum(['kai','serif','sans']),noteLayout:z.enum(['auto','drawer'])})
export function readingTools(db:Db,version:string,patch?:unknown):ReadingTools{
 const id=z.string().uuid().parse(version),doc=db.get('SELECT pageCount FROM document_version WHERE id=?',[id]);if(!doc)throw Error('文档版本不存在')
 const old={...DEFAULT_READING_TOOLS,...JSON.parse(String(db.get('SELECT value FROM meta WHERE key=?',['reading-tools:'+id])?.value??'{}'))}
 if(patch===undefined)return schema.parse(old)
 const next=schema.parse({...old,...schema.partial().strict().parse(patch)})
 if(doc.pageCount&&next.bookmarks.some(b=>b.pageIndex>=Number(doc.pageCount)))throw Error('书签页码超出文档范围')
 if(JSON.stringify(next).length>2000000)throw Error('保存内容过大')
 db.run('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)',['reading-tools:'+id,JSON.stringify(next)]);return next
}
