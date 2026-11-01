import {effectivePageLabels,type ReadingTools} from '../../shared/reading-tools';
import {dialog,clipboard} from 'electron';
import {writeFile} from 'node:fs/promises';
import {notesMarkdown} from '../../shared/annotations';
import {nativeLocale,nativeUi} from '../preferences';
import {getMainWindow} from '../window';
import type {Annotation} from '../../shared/m3';
import { ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { z } from 'zod';
import { call } from '../data-client';
import { isTrustedSender } from '../guard';
import { configSchema, inputSchema, testConnection, listModels, prepare, translateRemote } from './core';
import { CredentialVault } from './credentials';
import { TranslationManager } from './manager';
import type { ProviderConfig, ProviderSettings, TranslateRequest } from '../../shared/m3';
export function registerTranslationIpc(libraryDir: string): TranslationManager {
    const defaults: ProviderConfig = { kind: 'compatible', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', targetLanguage: 'zh-CN', consent: false };
    const vault = new CredentialVault(join(libraryDir, '.secrets'), { available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value) });
    const savedConfig = () => call<ProviderConfig | null>('m3.settings');
    async function settings(): Promise<ProviderSettings> {
        const saved = await savedConfig(), config = saved ?? defaults;
        return { ...config, hasKey: !!vault.get(config, saved) };
    }
    async function draft(raw: unknown, apiKey?: unknown): Promise<{ config: ProviderConfig; key: string }> {
        const config = configSchema.parse(raw), saved = await savedConfig();
        const key = apiKey === undefined ? vault.get(config, saved) : z.string().max(5000).parse(apiKey);
        return { config, key };
    }
    const manager = new TranslationManager(call, async () => { const saved = await savedConfig(), config = saved ?? defaults; return { config, key: vault.get(config, saved) }; });
    const uuid = z.string().uuid();
    const handlers: Record<string, (p: Record<string, unknown>, event: Electron.IpcMainInvokeEvent) => Promise<unknown>> = {
        paletteSettings:async p=>call('m3.paletteSettings',p),
        annotationRevise:async p=>call('m3.annotationRevise',p),
        exportNotes:async p=>{
            const v=z.object({documentVersionId:uuid,ids:z.array(uuid).max(10000),title:z.string().max(1000),metadata:z.string().max(3000),copy:z.boolean(),includeQuotes:z.boolean().optional()}).parse(p);
            const all=await call<Annotation[]>('m3.annotations',{documentVersionId:v.documentVersionId}),tools=await call<ReadingTools>('m3.readingTools',{documentVersionId:v.documentVersionId}),allowed=new Set(v.ids),count=Math.max(tools.pageLabels.length,...all.flatMap(a=>a.anchors.map(x=>x.pageIndex+1)),0),text=notesMarkdown(v.title,v.metadata,all.filter(a=>allowed.has(a.id)),nativeLocale()==='en',{labels:effectivePageLabels(tools,count),includeQuotes:v.includeQuotes});
            if(v.copy){await clipboard.writeText(text);return true}
            const win=getMainWindow();if(!win)throw Error('窗口已关闭');const target=await dialog.showSaveDialog(win,{title:nativeUi('导出札记'),defaultPath:v.title.replace(/[\/\\:*?"<>|]/g,'_').slice(0,120)+'.md',filters:[{name:'Markdown',extensions:['md']}]});
            if(target.canceled||!target.filePath)return false;await writeFile(target.filePath,text,'utf8');return true;
        },
        settings: () => settings(),
        clearCache:async()=>{manager.cancelInteractive();return call('m3.cacheClear')},
        readingTools:async p=>call('m3.readingTools',{documentVersionId:uuid.parse(p.documentVersionId),patch:p.patch}),
        readerData:async p=>call('m3.readerData',{documentVersionId:uuid.parse(p.documentVersionId)}),
        readerDataSave:async p=>call('m3.readerDataSave',p),
        configure: async (p) => {
            const config = configSchema.parse(p.config), previous = await savedConfig();
            const apiKey = z.string().max(5000).optional().parse(p.apiKey);
            vault.migrate(previous);
            if (apiKey !== undefined) vault.set(config, apiKey, previous);
            await call('m3.configure', { config });
            manager.cancelInteractive();
            return settings();
        },
        models: async p => { const env = await draft(p.config, p.apiKey); return listModels(env.config, env.key); },
        testDraft: async p => {
            const env = await draft(p.config, p.apiKey);
            const local = ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.config.baseUrl).hostname);
            if (!local && !env.config.consent) throw new Error('请先确认发送范围，测试只发送一条示例句，不发送文献');
            const prepared = prepare({ mode: 'selection', text: 'Research connects evidence with careful interpretation.', context: '', itemId: null, sourceLanguage: 'en' }, env.config, []);
            const result = await translateRemote(env.config, env.key, prepared, new AbortController().signal, () => undefined, {purpose:'test',record:attempt=>call('analytics.attempt',attempt as unknown as Record<string,unknown>)});
            return result.text;
        },
        test: async () => { const saved = await savedConfig(), config = saved ?? defaults; return testConnection(config, vault.get(config, saved)); },
        translate: async (p, event) => {
            const req = z.object({ requestId: uuid, generation: z.number().int().min(0), force: z.boolean().optional(), input: inputSchema }).parse(p) as TranslateRequest;
            return manager.translate(req, e => { if (!event.sender.isDestroyed())
                event.sender.send('m3:event', e); });
        },
        cached: async (p) => manager.peek(inputSchema.parse(p)),
        cancel: async (p) => manager.cancel(z.string().max(200).parse(p.requestId)),
        glossary: async (p) => call('m3.glossary', { itemId: uuid.nullable().parse(p.itemId) }),
        termSave: async (p) => call('m3.termSave', p), termDelete: async (p) => call('m3.termDelete', { id: uuid.parse(p.id) }),
        annotations: async (p) => call('m3.annotations', { documentVersionId: uuid.parse(p.documentVersionId) }),
        annotationSave: async (p) => call('m3.annotationSave', p), annotationDelete: async (p) => call('m3.annotationDelete', { id: uuid.parse(p.id) }),
        jobs: async (p) => manager.jobs(uuid.parse(p.documentVersionId)),
        startJob: async (p) => {
            const segment = z.object({ id: z.string().max(200), pageIndex: z.number().int().min(0), text: z.string().min(1).max(30000), rects: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])), kind: z.enum(['body', 'heading', 'reference', 'margin','title','abstract','keywords','caption','footnote']), confidence: z.number() });
            return manager.startJob(uuid.parse(p.documentVersionId), z.array(segment).min(1).max(20000).parse(p.segments), uuid.nullable().parse(p.itemId));
        },
        controlJob: async (p) => { await manager.controlJob(uuid.parse(p.id), z.enum(['pause', 'resume', 'cancel']).parse(p.action)); return true; }
    };
    for (const [name, fn] of Object.entries(handlers))
        ipcMain.handle('m3:' + name, async (event, raw) => {
            if (!isTrustedSender(event))
                return { ok: false, error: { code: 'UNTRUSTED', message: '调用方校验失败', retryable: false } };
            try {
                return { ok: true, data: await fn((raw ?? {}) as Record<string, unknown>, event) };
            }
            catch (e) {
                return { ok: false, error: { code: 'M3', message: e instanceof Error ? e.message : '操作失败', retryable: true } };
            }
        });
    return manager;
}
