import {readingTools} from './reading-tools';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from './db';
import type { GlossaryEntry, TranslationResult } from '../shared/m3';
import {anchorSchema,saveAnnotation,annotations,paletteSettings} from './annotations';
export {anchorSchema,saveAnnotation,annotations};
export function glossary(db: Db, itemId: string | null): GlossaryEntry[] {
    return db.all("SELECT * FROM glossary_entry WHERE scope='library' OR (scope='item' AND scopeId=?)", [itemId]).map(r => ({ ...r }) as unknown as GlossaryEntry);
}
export function dispatchM3(db: Db, method: string, p: Record<string, unknown>): unknown {
    switch (method) {
        case 'm3.readingTools': return readingTools(db,String(p.documentVersionId),p.patch);
        case 'm3.paletteSettings': return paletteSettings(db,p.value);
        case 'm3.annotationRevise': return saveAnnotation(db,p);
        case 'm3.cacheClear': db.run('DELETE FROM translation_cache');return true;
        case 'm3.readerData': return JSON.parse(String(db.get("SELECT value FROM meta WHERE key=?",['reader:'+z.string().uuid().parse(p.documentVersionId)])?.value??'{"overrides":[],"edits":{}}'));
        case 'm3.readerDataSave': {
            const id=z.string().uuid().parse(p.documentVersionId);
            if(!db.get('SELECT id FROM document_version WHERE id=?',[id]))throw Error('文档版本不存在');
            const segment=z.object({id:z.string().max(200),pageIndex:z.number().int().min(0),text:z.string().min(1).max(30000),rects:z.array(z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()])).min(1).max(2000),kind:z.enum(['body','heading','title','abstract','keywords','caption','footnote','margin','reference']),confidence:z.number()});
            const data=z.object({overrides:z.array(z.object({id:z.string().max(200),action:z.enum(['replace','ignore','merge']),segment:segment.optional()})).max(5000),edits:z.record(z.string().max(200),z.object({source:z.string().max(30000),text:z.string().max(100000)}))}).parse(p.data);
            if(JSON.stringify(data).length>2000000)throw Error('保存内容过大');
            db.run('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)',['reader:'+id,JSON.stringify(data)]);return true;
        }
        case 'm3.settings': return JSON.parse(String(db.get("SELECT value FROM meta WHERE key='translation_config'")?.value ?? 'null'));
        case 'm3.configure':
            db.run("INSERT OR REPLACE INTO meta(key,value) VALUES ('translation_config',?)", [JSON.stringify(p.config)]);
            return true;
        case 'm3.glossary': return glossary(db, (p.itemId as string | null) ?? null);
        case 'm3.termSave': {
            const term = z.object({ id: z.string().uuid().optional(), source: z.string().trim().min(1).max(200), target: z.string().trim().min(1).max(500), itemId: z.string().uuid().nullable().optional() }).parse(p);
            const duplicate = db.get("SELECT id FROM glossary_entry WHERE scope=? AND scopeId IS ? AND source=? COLLATE NOCASE", [term.itemId ? 'item' : 'library', term.itemId ?? null, term.source]);
            if (term.id && duplicate && duplicate.id !== term.id)
                throw new Error('此范围已存在相同术语，请编辑已有条目');
            const id = term.id ?? (duplicate ? String(duplicate.id) : randomUUID());
            db.run(`INSERT INTO glossary_entry(id,scope,scopeId,source,target) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,scopeId=excluded.scopeId,source=excluded.source,target=excluded.target,revision=revision+1`, [id, term.itemId ? 'item' : 'library', term.itemId ?? null, term.source, term.target]);
            return id;
        }
        case 'm3.termDelete':
            db.run('DELETE FROM glossary_entry WHERE id=?', [String(p.id)]);
            return true;
        case 'm3.annotations': return annotations(db, String(p.documentVersionId));
        case 'm3.annotationSave': return saveAnnotation(db, p);
        case 'm3.annotationDelete':
            db.run('UPDATE entity SET deletedAt=?,revision=revision+1 WHERE id=? AND kind=?', [new Date().toISOString(), String(p.id), 'annotation']);
            return true;
        case 'm3.cacheGet': {
            const r = db.get("SELECT * FROM translation_cache WHERE inputHash=? AND state='completed'", [String(p.hash)]);
            if (!r)
                return null;
            db.run('UPDATE translation_cache SET lastUsedAt=? WHERE inputHash=?', [new Date().toISOString(), String(p.hash)]);
            return JSON.parse(String(r.validation));
        }
        case 'm3.cachePut': {
            const r = p.result as TranslationResult;
            if (r.status !== 'completed')
                return false;
            const now = new Date().toISOString();
            db.run('INSERT OR REPLACE INTO translation_cache(inputHash,state,output,providerFingerprint,validation,createdAt,lastUsedAt) VALUES (?,?,?,?,?,?,?)', [r.inputHash, r.status, r.text, r.providerFingerprint, JSON.stringify(r), now, now]);
            return true;
        }
        case 'm3.jobs': return db.all("SELECT * FROM job WHERE kind='translation' ORDER BY createdAt DESC").filter(r => JSON.parse(String(r.configJson)).documentVersionId === p.documentVersionId).map(r => ({ id: r.id, ...JSON.parse(String(r.progressJson)), status: r.status, documentVersionId: p.documentVersionId }));
        case 'm3.jobUnits': return db.all('SELECT unitKey,status FROM job_unit WHERE jobId=?', [String(p.id)]);
        case 'm3.jobGet': return db.get("SELECT * FROM job WHERE id=? AND kind='translation'", [String(p.id)]) ?? null;
        case 'm3.jobSave': {
            db.transaction(() => {
                db.run(`INSERT INTO job(id,kind,status,configJson,progressJson,createdAt) VALUES (?,'translation',?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,progressJson=excluded.progressJson`, [String(p.id), String(p.status), JSON.stringify(p.config), JSON.stringify(p.progress), new Date().toISOString()]);
                for (const u of (p.units as Array<{
                    id: string;
                    status: string;
                    error?: string;
                }>) ?? [])
                    db.run(`INSERT INTO job_unit(jobId,unitKey,status,attempt,error) VALUES (?,?,?,1,?) ON CONFLICT(jobId,unitKey) DO UPDATE SET status=excluded.status,attempt=attempt+1,error=excluded.error`, [String(p.id), u.id, u.status, u.error ?? null]);
            });
            return true;
        }
        default: throw new Error('未知阅读数据方法');
    }
}
