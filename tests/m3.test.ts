import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { openLibrary } from '../src/data-service/db';
import { dispatchM3 } from '../src/data-service/m3';
import { prepare, protect, restore, matchingTerms, configSchema, translateRemote, listModels } from '../src/main/translation/core';
import { CredentialVault } from '../src/main/translation/credentials';
import { credentialIdentity, requestPreview } from '../src/shared/providers';
import { TranslationManager } from '../src/main/translation/manager';
import { analyzePage } from '../src/renderer/src/reader/layout/analyze';
import type { ProviderConfig, TranslationInput, GlossaryEntry } from '../src/shared/m3';
const config: ProviderConfig = { kind: 'compatible', baseUrl: 'http://127.0.0.1:1234/v1', model: 'fixture', targetLanguage: 'zh-CN', consent: false };
const input: TranslationInput = { mode: 'selection', text: 'bank [12]', context: 'a river bank', itemId: null, sourceLanguage: 'auto' };
const term = (source: string, target: string, scope: 'library' | 'item' = 'library'): GlossaryEntry => ({ id: randomUUID(), source, target, scope, scopeId: null, matchMode: 'exact', revision: 1 });
test('cache captures context, endpoint, mode, matching glossary and generation semantics', () => {
    const base = prepare(input, config, []).hash;
    assert.notEqual(base, prepare({ ...input, context: 'a financial bank' }, config, []).hash);
    assert.notEqual(base, prepare({ ...input, mode: 'paragraph' }, config, []).hash);
    assert.notEqual(base, prepare(input, { ...config, baseUrl: 'http://127.0.0.1:2222/v1' }, []).hash);
    assert.equal(base, prepare(input, config, [term('unrelated', '无关')]).hash);
    assert.notEqual(base, prepare(input, config, [term('bank', '河岸')]).hash);
    assert.equal(matchingTerms('statement bank', [term('state', '国家')]).length, 0);
    assert.equal(matchingTerms('bank', [term('bank', '银行'), term('bank', '河岸', 'item')])[0].target, '河岸');
});
test('placeholder multiset rejects missing, duplicate, extra and survives reordering', () => {
    const p = protect('See [12], $x_i$ and https://example.org.');
    assert.equal(p.slots.length, 3);
    assert.equal(restore('⟦P2⟧ ⟦P1⟧ ⟦P3⟧', p.slots).valid, true);
    for (const text of ['⟦P1⟧', '⟦P1⟧ ⟦P1⟧ ⟦P3⟧', '⟦P1⟧ ⟦P2⟧ ⟦P3⟧ ⟦P4⟧'])
        assert.equal(restore(text, p.slots).valid, false);
});
test('provider rejects unsafe endpoints and permits explicit loopback HTTP', () => {
    for (const baseUrl of ['http://example.org/v1', 'file:///tmp/x', 'https://user:secret@example.com', 'https://example.org?a=1'])
        assert.equal(configSchema.safeParse({ ...config, baseUrl }).success, false);
    assert.equal(configSchema.safeParse(config).success, true);
});
test('annotation multi-page anchors, translation record and glossary persist on restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jian-m3-')), file = join(dir, 'jian.sqlite');
    let db = openLibrary(dir);
    try {
        const item = randomUUID(), document = randomUUID(), version = randomUUID(), time = new Date().toISOString();
        for (const [id, kind] of [[item, 'item'], [document, 'document'], [version, 'document']])
            db.run('INSERT INTO entity(id,kind,createdAt,updatedAt) VALUES (?,?,?,?)', [id, kind, time, time]);
        db.run("INSERT INTO item(id,type,title) VALUES (?,'journalArticle','Fixture')", [item]);
        db.run("INSERT INTO document(id,itemId,displayName,contentType,activeVersionId) VALUES (?,?,'test.pdf','application/pdf',?)", [document, item, version]);
        db.run("INSERT INTO document_version(id,documentId,externalGrantId,fingerprint,pageCount) VALUES (?,?,'fixture','test',2)", [version, document]);
        const prepared = prepare(input, config, []), result = { text: '河岸 [12]', status: 'completed', cached: false, inputHash: prepared.hash, providerFingerprint: prepared.providerFingerprint, inputSnapshot: prepared.inputSnapshot };
        const anchors = [0, 1].map(pageIndex => ({ documentVersionId: version, pageIndex, rects: [[10, 20, 100, 40]], exact: 'part' }));
        const id = dispatchM3(db, 'm3.annotationSave', { documentVersionId: version, anchors, quote: 'bank [12]', comment: 'note', type: 'excerpt', translation: result });
        dispatchM3(db, 'm3.cachePut', { result });
        dispatchM3(db, 'm3.termSave', { source: 'bank', target: '河岸', itemId: item });
        assert.throws(() => dispatchM3(db, 'm3.annotationSave', { documentVersionId: version, anchors: [{ ...anchors[0], documentVersionId: randomUUID() }], quote: 'bad', comment: '', type: 'excerpt' }));
        db.close();
        db = openLibrary(dir);
        const saved = dispatchM3(db, 'm3.annotations', { documentVersionId: version }) as Array<{
            id: string;
            anchors: unknown[];
            translation: string;
        }>;
        assert.equal(saved.length, 2);
        assert.equal(saved[0].id, id);
        assert.equal(saved[0].anchors.length, 2);
        assert.equal(saved[0].translation, '河岸 [12]');
        assert.equal((dispatchM3(db, 'm3.cacheGet', { hash: prepared.hash }) as {
            text: string;
        }).text, '河岸 [12]');
        assert.equal((dispatchM3(db, 'm3.glossary', { itemId: item }) as unknown[]).length, 1);
        assert.equal(db.all('PRAGMA foreign_key_check').length, 0);
        dispatchM3(db, 'm3.annotationDelete', { id });
        assert.equal((dispatchM3(db, 'm3.annotations', { documentVersionId: version }) as unknown[]).length, 1);
        assert.ok(file);
    }
    finally {
        db.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('layout does not interleave two columns and flags reference regions', () => {
    const glyphs = [];
    for (let i = 0; i < 8; i++)
        for (const [x, text] of [[40, `Left ${i}.`], [330, `Right ${i}.`]] as const)
            glyphs.push({ text, x0: x, y0: 100 + i * 20, x1: x + 170, y1: 112 + i * 20, rect: [x, 500 - i * 20, x + 170, 512 - i * 20] as [
                    number,
                    number,
                    number,
                    number
                ], index: glyphs.length });
    const segments = analyzePage(glyphs, 600, 800, 0), joined = segments.map(s => s.text).join('|');
    assert.ok(joined.indexOf('Left 7') < joined.indexOf('Right 0'));
    assert.equal(analyzePage([], 600, 800, 0).length, 0);
    const refs = analyzePage([{ text: 'References', x0: 40, y0: 100, x1: 220, y1: 112, rect: [40, 500, 220, 512], index: 0 }], 600, 800, 0);
    assert.equal(refs[0].kind, 'reference');
});
test('real HTTP stream transport, shared cancellation, cache reuse and truncation rejection', async () => {
    let calls = 0, truncated = false;
    const server = createServer((req, res) => {
        req.resume();
        req.on('end', () => {
            calls++;
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            setTimeout(() => {
                if (res.destroyed)
                    return;
                res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '河岸 ⟦P1⟧' }, finish_reason: null }] }) + '\n\n');
                res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: truncated ? 'length' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
            }, 35);
        });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as {
        port: number;
    }, cfg = { ...config, baseUrl: `http://127.0.0.1:${addr.port}/v1` };
    const cache = new Map<string, unknown>(), store = async <T = unknown>(method: string, p: Record<string, unknown> = {}) => { if (method === 'm3.glossary')
        return [] as T; if (method === 'm3.cacheGet')
        return (cache.get(String(p.hash)) ?? null) as T; if (method === 'm3.cachePut') {
        const r = p.result as {
            inputHash: string;
        };
        cache.set(r.inputHash, r);
        return true as T;
    } return undefined as T; };
    const manager = new TranslationManager(store, async () => ({ config: cfg, key: '' }));
    try {
        const id1 = randomUUID(), id2 = randomUUID(), p1 = manager.translate({ requestId: id1, generation: 1, input }, () => { }).then(() => null, e => e as Error), p2 = manager.translate({ requestId: id2, generation: 1, input }, () => { });
        await new Promise(r => setTimeout(r, 15));
        manager.cancel(id1);
        assert.ok(await p1 instanceof Error);
        const result = await p2;
        assert.equal(result.text, '河岸 [12]');
        assert.equal(calls, 1);
        const cached = await manager.translate({ requestId: randomUUID(), generation: 2, input }, () => { });
        assert.equal(cached.cached, true);
        assert.equal(calls, 1);
        truncated = true;
        const prepared = prepare({ ...input, context: 'other' }, cfg, []);
        await assert.rejects(() => translateRemote(cfg, '', prepared, new AbortController().signal, () => { }), /正常完成/);
        assert.equal(cache.size, 1);
    }
    finally {
        manager.stop();
        server.closeAllConnections();
        await new Promise<void>(r => server.close(() => r()));
    }
});
test('cancel before configuration resolves never launches a network request', async () => {
    let release: (v: {
        config: ProviderConfig;
        key: string;
    }) => void = () => { }, calls = 0;
    const environment = () => new Promise<{
        config: ProviderConfig;
        key: string;
    }>(r => { release = r; });
    const store = async <T = unknown>(method: string) => { calls++; return (method === 'm3.glossary' ? [] : null) as T; };
    const manager = new TranslationManager(store, environment), id = randomUUID();
    const pending = manager.translate({ requestId: id, generation: 0, input }, () => { }).then(() => false, () => true);
    assert.equal(manager.cancel(id), true);
    release({ config, key: '' });
    assert.equal(await pending, true);
    assert.equal(calls, 2);
    manager.stop();
});
test('Ollama NDJSON supports chunks split across network boundaries', async () => {
    const server = createServer((req, res) => {
        req.resume();
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
            const stream = JSON.stringify({ message: { content: '语境译文 ⟦P1⟧' }, done: false }) + '\n' + JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop' }) + '\n';
            const bytes = Buffer.from(stream);
            res.write(bytes.subarray(0, 55));
            setTimeout(() => res.end(bytes.subarray(55)), 5);
        });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const cfg = { ...config, kind: 'ollama' as const, baseUrl: `http://127.0.0.1:${(server.address() as {
            port: number;
        }).port}` };
    try {
        const result = await translateRemote(cfg, '', prepare(input, cfg, []), new AbortController().signal, () => { });
        assert.equal(result.text, '语境译文 [12]');
        assert.equal(result.status, 'completed');
    }
    finally {
        server.closeAllConnections();
        await new Promise<void>(r => server.close(() => r()));
    }
});
test('document jobs pause, restart from checkpoints and reject changed config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jian-job-')), db = openLibrary(dir);
    const store = async <T = unknown>(m: string, p: Record<string, unknown> = {}) => dispatchM3(db, m, p) as T;
    let cfg = config, calls = 0;
    const server = createServer((req, res) => { req.resume(); req.on('end', () => { calls++; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); setTimeout(() => res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: '译文' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'), 40); }); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    cfg = { ...config, baseUrl: `http://127.0.0.1:${(server.address() as {
            port: number;
        }).port}/v1` };
    let manager = new TranslationManager(store, async () => ({ config: cfg, key: '' }));
    const waitFor = async (check: () => boolean | Promise<boolean>) => { for (let i = 0; i < 150; i++) {
        if (await check())
            return;
        await new Promise(r => setTimeout(r, 10));
    } throw Error('test timeout'); };
    const documentVersionId = randomUUID(), segments = [0, 1, 2].map(i => ({ id: String(i), pageIndex: 0, text: `Paragraph ${i}`, rects: [] as [
            number,
            number,
            number,
            number
        ][], kind: 'body' as const, confidence: 1 }));
    try {
        const id = await manager.startJob(documentVersionId, segments, null);
        await waitFor(() => calls === 1);
        await manager.controlJob(id, 'pause');
        await waitFor(() => Number(db.get('SELECT count(*) AS n FROM job_unit WHERE jobId=?', [id])?.n) === 1);
        manager.stop();
        manager = new TranslationManager(store, async () => ({ config: cfg, key: '' }));
        cfg = { ...cfg, model: 'changed' };
        await assert.rejects(() => manager.controlJob(id, 'resume'), /配置已改变/);
        cfg = { ...cfg, model: 'fixture' };
        await manager.controlJob(id, 'resume');
        await waitFor(async () => (await manager.jobs(documentVersionId))[0].status === 'completed');
        assert.equal(calls, 3);
        const job = (await manager.jobs(documentVersionId))[0];
        assert.equal(job.completed, 3);
        assert.equal(job.failed, 0);
    }
    finally {
        manager.stop();
        server.closeAllConnections();
        await new Promise<void>(r => server.close(() => r()));
        db.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('full backup accepts current schema and preserves M3 user data when restored', async () => {
    const { createBackup, verifyBackup, applyRestore } = await import('../src/data-service/backup');
    const dir = mkdtempSync(join(tmpdir(), 'jian-restore-'));
    let db = openLibrary(dir);
    try {
        dispatchM3(db, 'm3.termSave', { source: 'sovereignty', target: '主权' });
        const backup = await createBackup(db, dir, { appVersion: '0.3.0', includeBlobs: true });
        assert.equal(backup.verified, true);
        const plan = await verifyBackup(dir, backup.id);
        assert.deepEqual(plan.problems, []);
        db.run('DELETE FROM glossary_entry');
        db.close();
        await applyRestore(dir, plan);
        db = openLibrary(dir);
        assert.equal((dispatchM3(db, 'm3.glossary', { itemId: null }) as Array<{
            target: string;
        }>)[0].target, '主权');
    }
    finally {
        db.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('editable provider URLs normalize paths; temperature affects cache, timeout does not', () => {
    assert.equal(configSchema.parse({ ...config, baseUrl: 'https://api.deepseek.com/chat/completions/' }).baseUrl, 'https://api.deepseek.com');
    const gemma = configSchema.parse({ ...config, kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent', model: 'models/gemma-4-31b-it' });
    assert.equal(gemma.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
    assert.equal(gemma.model, 'gemma-4-31b-it');
    assert.equal(requestPreview(gemma), 'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:streamGenerateContent?alt=sse');
    assert.equal(configSchema.safeParse({ ...config, timeoutMs: 0 }).success, false);
    assert.equal(configSchema.safeParse({ ...config, temperature: 3 }).success, false);
    assert.notEqual(prepare(input, config, []).hash, prepare(input, { ...config, temperature: 0.5 }, []).hash);
    assert.equal(prepare(input, config, []).hash, prepare(input, { ...config, timeoutMs: 30000 }, []).hash);
});

test('endpoint-bound encrypted credentials migrate once, remain separate and never resurrect a removed key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jian-keys-'));
    // An injected deterministic codec tests routing and migration, not OS encryption.
    const codec = { available: () => true, encrypt: (value: string) => Buffer.from(value).map(b => b ^ 0x55), decrypt: (value: Buffer) => Buffer.from(value).map(b => b ^ 0x55).toString() };
    const first = { ...config, baseUrl: 'https://api.deepseek.com' };
    const second = { ...config, kind: 'gemini' as const, baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };
    try {
        writeFileSync(join(dir, 'provider.enc'), codec.encrypt('first-secret'));
        const vault = new CredentialVault(dir, codec);
        assert.equal(vault.get(first, first), 'first-secret');
        assert.equal(vault.get(second, first), '');
        vault.migrate(first); // Must precede changing the active config, even when key input is left blank.
        assert.equal(vault.get(second, second), '');
        vault.set(second, 'second-secret', first);
        assert.equal(vault.get(first, second), 'first-secret');
        assert.equal(vault.get(second, second), 'second-secret');
        assert.equal(vault.get({ ...first, baseUrl: 'https://other.example/v1' }, first), '');
        assert.equal(vault.get({ ...first, kind: 'gemini' }, first), '');
        assert.equal(credentialIdentity(first), credentialIdentity({ ...first, baseUrl: first.baseUrl + '/chat/completions/' }));
        assert.equal(readFileSync(join(dir, 'profiles.enc')).includes('second-secret'), false);
        vault.set(first, '', second);
        assert.equal(new CredentialVault(dir, codec).get(first, first), '');
        assert.equal(vault.get(second, first), 'second-secret');
        writeFileSync(join(dir, 'profiles.enc'), Buffer.from('corrupted'));
        assert.throws(() => vault.get(first, first), /无法读取/);
        assert.throws(() => new CredentialVault(dir, { ...codec, available: () => false }).set(second, 'key', null), /安全存储不可用/);
        assert.equal(existsSync(join(dir, 'profiles.enc.tmp')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Google native model discovery paginates, filters generation models and uses a header key', async () => {
    const requests: Array<{ url: string; key?: string; authorization?: string }> = [];
    const server = createServer((req, res) => {
        requests.push({ url: req.url!, key: req.headers['x-goog-api-key'] as string, authorization: req.headers.authorization });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const url = new URL(req.url!, 'http://localhost');
        res.end(JSON.stringify(url.searchParams.has('pageToken') ? { models: [{ name: 'models/gemma-4-31b-it', supportedGenerationMethods: ['generateContent'] }] } : {
            models: [{ name: 'models/gemma-4-26b-a4b-it', displayName: 'Gemma 4', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next page',
        }));
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
        const cfg = { ...config, kind: 'gemini' as const, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1beta` };
        const models = await listModels(cfg, 'google-secret');
        assert.deepEqual(models.map(m => m.id), ['gemma-4-26b-a4b-it', 'gemma-4-31b-it']);
        assert.equal(models[0].label, 'Gemma 4');
        assert.equal(requests.length, 2);
        assert.equal(new URL(requests[1].url, 'http://localhost').searchParams.get('pageToken'), 'next page');
        for (const request of requests) { assert.equal(request.key, 'google-secret'); assert.equal(request.authorization, undefined); assert.ok(!request.url.includes('google-secret')); }
        assert.equal(new URL(requests[0].url, 'http://localhost').pathname, '/v1beta/models');
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test('Gemma native SSE request streams text, excludes thoughts and rejects interrupted or blocked completions', async () => {
    let finish = 'STOP', broken = false;
    const captures: Array<{ url: string; key?: string; authorization?: string; body: Record<string, any> }> = [];
    const server = createServer((req, res) => {
        let body = ''; req.on('data', c => body += c);
        req.on('end', () => {
            captures.push({ url: req.url!, key: req.headers['x-goog-api-key'] as string, authorization: req.headers.authorization, body: JSON.parse(body) });
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            const json = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hidden reasoning', thought: true }, { text: '原生译文 ⟦P1⟧' }] }, ...(!broken ? { finishReason: finish } : {}) }] });
            // Valid multiline SSE data, plus a split inside the first UTF-8 CJK character.
            const sse = ': keepalive\r\nevent: message\r\ndata: ' + json.replace(',"content":', ',\n"content":').replace('"candidates":[', '"candidates":\n[').replace('\n', '\r\ndata: ') + '\r\n\r\n';
            const bytes = Buffer.from(sse), split = bytes.indexOf(Buffer.from('原')) + 1;
            res.write(bytes.subarray(0, split)); setTimeout(() => res.end(bytes.subarray(split)), 3);
        });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
        const cfg: ProviderConfig = { ...config, kind: 'gemini', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1beta`, model: 'gemma-4-26b-a4b-it', temperature: 0.2 };
        const chunks: string[] = [];
        const result = await translateRemote(cfg, 'google-secret', prepare(input, cfg, []), new AbortController().signal, s => chunks.push(s));
        assert.equal(result.text, '原生译文 [12]'); assert.deepEqual(chunks, ['原生译文 ⟦P1⟧']);
        const c = captures[0];
        assert.equal(c.url, '/v1beta/models/gemma-4-26b-a4b-it:streamGenerateContent?alt=sse');
        assert.equal(c.key, 'google-secret'); assert.equal(c.authorization, undefined);
        assert.equal(c.body.generationConfig.temperature, 0.2); assert.equal(c.body.contents[0].role, 'user');
        assert.ok(c.body.systemInstruction.parts[0].text.includes('学术翻译器'));
        assert.equal(c.body.messages, undefined); assert.equal(JSON.parse(c.body.contents[0].parts[0].text).translate, 'bank ⟦P1⟧');
        for (finish of ['MAX_TOKENS', 'SAFETY']) await assert.rejects(() => translateRemote(cfg, '', prepare(input, cfg, []), new AbortController().signal, () => {}), /正常完成/);
        finish = 'STOP'; broken = true;
        await assert.rejects(() => translateRemote(cfg, '', prepare(input, cfg, []), new AbortController().signal, () => {}), /正常完成/);
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test('DeepSeek-compatible custom model uses Bearer authentication and normalized endpoints', async () => {
    let status = 200;
    const calls: Array<{ path: string; authorization?: string; googleKey?: string; body: Record<string, any> | null }> = [];
    const server = createServer((req, res) => {
        let body = ''; req.on('data', c => body += c);
        req.on('end', () => {
            calls.push({ path: req.url!, authorization: req.headers.authorization, googleKey: req.headers['x-goog-api-key'] as string, body: body ? JSON.parse(body) : null });
            res.writeHead(status, { 'Content-Type': req.method === 'GET' ? 'application/json' : 'text/event-stream' });
            if (status !== 200) { res.end('{}'); return; }
            res.end(req.method === 'GET' ? JSON.stringify({ data: [{ id: 'my-deepseek-model' }] }) : 'data: ' + JSON.stringify({ choices: [{ delta: { content: '译文 ⟦P1⟧' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
        });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
        const cfg = configSchema.parse({ ...config, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions/`, model: 'my-deepseek-model' });
        assert.equal((await listModels(cfg, 'deepseek-secret'))[0].id, 'my-deepseek-model');
        const result = await translateRemote(cfg, 'deepseek-secret', prepare(input, cfg, []), new AbortController().signal, () => {});
        assert.equal(result.text, '译文 [12]');
        assert.deepEqual(calls.map(c => c.path), ['/v1/models', '/v1/chat/completions']);
        assert.equal(calls[1].body?.model, 'my-deepseek-model'); assert.equal(calls[1].body?.stream, true);
        for (const call of calls) { assert.equal(call.authorization, 'Bearer deepseek-secret'); assert.equal(call.googleKey, undefined); }
        status = 401;
        await assert.rejects(() => listModels(cfg, 'wrong'), /认证失败/);
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
