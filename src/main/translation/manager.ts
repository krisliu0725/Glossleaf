import { randomUUID } from 'node:crypto';
import type { DocumentJob, GlossaryEntry, ProviderConfig, TranslationEvent, TranslationInput, TranslationResult, Segment, TranslateRequest } from '../../shared/m3';
import { paragraphInput } from '../../shared/m3';
import { prepare, translateRemote, configSchema, inputSchema, digest } from './core';
type Store = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
type Environment = () => Promise<{
    config: ProviderConfig;
    key: string;
}>;
interface Subscriber {
    request: TranslateRequest;
    emit: (e: TranslationEvent) => void;
    sequence: number;
    resolve: (r: TranslationResult) => void;
    reject: (e: Error) => void;
}
interface Flight {
    controller: AbortController;
    subscribers: Map<string, Subscriber>;
    started: boolean;
    background: boolean;
    run: () => Promise<void>;
}
export class TranslationManager {
    private flights = new Map<string, Flight>();
    private requests = new Map<string, {
        hash: string;
        sub: Subscriber;
    }>();
    private active = 0;
    private activeBackground = 0;
    private pendingIds = new Set<string>();
    private cancelledIds = new Set<string>();
    private runningJobs = new Set<string>();
    private paused = new Set<string>();
    private cancelled = new Set<string>();
    constructor(private store: Store, private environment: Environment) { }
    private pump(): void {
        for (const [hash, f] of this.flights) {
            if (this.active >= 2)
                break;
            if (f.started || !f.subscribers.size || (f.background && this.activeBackground >= 1))
                continue;
            f.started = true;
            this.active++;
            if (f.background)
                this.activeBackground++;
            void f.run().finally(() => { if (this.flights.get(hash) === f)
                this.flights.delete(hash); this.active--; if (f.background)
                this.activeBackground--; this.pump(); });
        }
    }
    async translate(request: TranslateRequest, emit: (e: TranslationEvent) => void, frozen?: {
        config: ProviderConfig;
        key: string;
        terms: GlossaryEntry[];
    }): Promise<TranslationResult> {
        if (this.pendingIds.size >= 64)
            throw new Error('等待中的请求较多，请稍后重试');
        this.pendingIds.add(request.requestId);
        try {
            if (this.requests.has(request.requestId))
                throw new Error('请求编号已存在');
            const input = inputSchema.parse(request.input);
            const env = frozen ?? await this.environment();
            const config = configSchema.parse(env.config);
            const u = new URL(config.baseUrl), local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
            if (!local && !config.consent)
                throw new Error('请先确认云端发送范围');
            const terms = frozen?.terms ?? await this.store<GlossaryEntry[]>('m3.glossary', { itemId: input.itemId });
            const prepared = prepare(input, config, terms), cached = request.force ? null : await this.store<TranslationResult | null>('m3.cacheGet', { hash: prepared.hash });
            if (this.cancelledIds.delete(request.requestId))
                throw new Error('已取消');
            if (cached) {
                await this.store('analytics.operation',{kind:'cache_hit'}).catch(()=>undefined);
                return { ...cached, cached: true };
            }
            if (this.requests.has(request.requestId))
                throw new Error('请求编号已存在');
            return await new Promise((resolve, reject) => {
                const sub: Subscriber = { request, emit, sequence: 0, resolve, reject };
                let f = this.flights.get(prepared.hash);
                if (!f) {
                    f = { controller: new AbortController(), subscribers: new Map(), started: false, background: request.requestId.startsWith('job:'), run: async () => { } };
                    const flight = f;
                    f.run = async () => {
                        let result: TranslationResult | undefined, error: Error | undefined;
                        try {
                            result = await translateRemote(config, env.key, prepared, flight.controller.signal, text => { for (const s of flight.subscribers.values())
                                s.emit({ requestId: s.request.requestId, generation: s.request.generation, sequence: ++s.sequence, type: 'chunk', text }); }, {purpose:flight.background?'background':'interactive',record:attempt=>this.store('analytics.attempt',attempt as unknown as Record<string,unknown>)});
                            if (!flight.controller.signal.aborted && result.status === 'completed')
                                await this.store('m3.cachePut', { result });
                        }
                        catch (e) {
                            error = e instanceof Error ? e : new Error('翻译失败');
                        }
                        for (const [id, s] of flight.subscribers) {
                            this.requests.delete(id);
                            if (result && !flight.controller.signal.aborted) {
                                s.emit({ requestId: id, generation: s.request.generation, sequence: ++s.sequence, type: 'completed', result });
                                s.resolve(result);
                            }
                            else {
                                s.emit({ requestId: id, generation: s.request.generation, sequence: ++s.sequence, type: 'failed', error: error?.message ?? '已取消' });
                                s.reject(error ?? new Error('已取消'));
                            }
                        }
                        flight.subscribers.clear();
                    };
                    this.flights.set(prepared.hash, f);
                }
                if (!f.started && !request.requestId.startsWith('job:'))
                    f.background = false;
                f.subscribers.set(request.requestId, sub);
                this.requests.set(request.requestId, { hash: prepared.hash, sub });
                this.pump();
            });
        }
        finally {
            this.pendingIds.delete(request.requestId);
        }
    }
    cancel(id: string): boolean {
        const ref = this.requests.get(id);
        if (!ref) {
            if (this.pendingIds.has(id)) {
                this.cancelledIds.add(id);
                return true;
            }
            return false;
        }
        const flight = this.flights.get(ref.hash);
        this.requests.delete(id);
        flight?.subscribers.delete(id);
        ref.sub.emit({ requestId: id, generation: ref.sub.request.generation, sequence: ++ref.sub.sequence, type: 'cancelled' });
        ref.sub.reject(new Error('已取消'));
        if (flight && !flight.subscribers.size) {
            flight.controller.abort();
            if (this.flights.get(ref.hash) === flight)
                this.flights.delete(ref.hash);
        }
        return true;
    }
    cancelInteractive(): void { for (const id of new Set([...this.requests.keys(), ...this.pendingIds]))
        if (!id.startsWith('job:'))
            this.cancel(id); }
    stop(): void { for (const id of new Set([...this.requests.keys(), ...this.pendingIds]))
        this.cancel(id); for (const id of this.runningJobs)
        this.paused.add(id); }
    async peek(input: TranslationInput): Promise<TranslationResult | null> {
        const env = await this.environment(), terms = await this.store<GlossaryEntry[]>('m3.glossary', { itemId: input.itemId });
        const p = prepare(inputSchema.parse(input), configSchema.parse(env.config), terms);
        const cached = await this.store<TranslationResult | null>('m3.cacheGet', { hash: p.hash });
        return cached ? { ...cached, cached: true } : null;
    }
    async startJob(documentVersionId: string, segments: Segment[], itemId: string | null): Promise<string> {
        const env = await this.environment(), terms = await this.store<GlossaryEntry[]>('m3.glossary', { itemId });
        const id = randomUUID(), inputs = segments.filter(s => s.kind !== 'reference' && s.kind !== 'margin').map(s => ({ id: s.id, input: paragraphInput(s, segments, itemId) }));
        if (!inputs.length)
            throw new Error('没有可翻译段落');
        if (inputs.reduce((n, u) => n + u.input.text.length + u.input.context.length, 0) > 4000000)
            throw new Error('整篇内容过大，请分段翻译');
        if (new Set(inputs.map(u => u.id)).size !== inputs.length)
            throw new Error('段落编号重复');
        const config = { documentVersionId, inputs, provider: env.config, terms, providerFingerprint: digest(env.config) };
        await this.store('m3.jobSave', { id, status: 'running', config, progress: { total: inputs.length, completed: 0, failed: 0, error: null } });
        void this.runJob(id).catch(() => undefined);
        return id;
    }
    async controlJob(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<void> {
        const row = await this.store<Record<string, unknown> | null>('m3.jobGet', { id });
        if (!row)
            throw new Error('任务不存在');
        if (['completed', 'cancelled'].includes(String(row.status)))
            return;
        if (action === 'resume') {
            const env = await this.environment(), cfg = JSON.parse(String(row.configJson));
            if (digest(env.config) !== cfg.providerFingerprint)
                throw new Error('引擎配置已改变；请恢复原配置继续，或另建任务');
            this.paused.delete(id);
            this.cancelled.delete(id);
            await this.store('m3.jobSave', { id, status: 'running', config: cfg, progress: JSON.parse(String(row.progressJson)) });
            void this.runJob(id).catch(() => undefined);
        }
        else {
            this.paused.add(id);
            if (action === 'cancel') {
                this.cancelled.add(id);
                for (const key of new Set([...this.requests.keys(), ...this.pendingIds]))
                    if (key.startsWith(`job:${id}:`))
                        this.cancel(key);
            }
            await this.store('m3.jobSave', { id, status: action === 'cancel' ? 'cancelled' : 'paused', config: JSON.parse(String(row.configJson)), progress: JSON.parse(String(row.progressJson)) });
        }
    }
    private async runJob(id: string): Promise<void> {
        if (this.runningJobs.has(id))
            return;
        this.runningJobs.add(id);
        try {
            const row = await this.store<Record<string, unknown>>('m3.jobGet', { id });
            const cfg = JSON.parse(String(row.configJson)) as {
                documentVersionId: string;
                inputs: Array<{
                    id: string;
                    input: TranslationInput;
                }>;
                provider: ProviderConfig;
                terms: GlossaryEntry[];
            };
            const env = await this.environment(), units = await this.store<Array<{
                unitKey: string;
                status: string;
            }>>('m3.jobUnits', { id }), done = new Set(units.filter(u => u.status === 'completed').map(u => u.unitKey));
            let completed = done.size, failed = 0, lastError: string | null = null;
            for (const unit of cfg.inputs) {
                if (this.paused.has(id))
                    break;
                if (done.has(unit.id))
                    continue;
                try {
                    const r = await this.translate({ requestId: `job:${id}:${unit.id}`, generation: 0, input: unit.input }, () => undefined, { config: cfg.provider, key: env.key, terms: cfg.terms });
                    if (r.status === 'completed')
                        completed++;
                    else {
                        failed++;
                        lastError = r.warning ?? '需核对';
                    }
                    await this.store('m3.jobSave', { id, status: this.cancelled.has(id) ? 'cancelled' : this.paused.has(id) ? 'paused' : 'running', config: cfg, progress: { total: cfg.inputs.length, completed, failed, error: lastError }, units: [{ id: unit.id, status: r.status }] });
                }
                catch (e) {
                    if (this.paused.has(id) || this.cancelled.has(id))
                        break;
                    failed++;
                    lastError = e instanceof Error ? e.message : '请求失败';
                    if (failed >= 3)
                        this.paused.add(id);
                    await this.store('m3.jobSave', { id, status: this.paused.has(id) ? 'paused' : 'running', config: cfg, progress: { total: cfg.inputs.length, completed, failed, error: lastError }, units: [{ id: unit.id, status: 'failed', error: lastError }] });
                }
            }
            if (!this.paused.has(id))
                await this.store('m3.jobSave', { id, status: failed ? 'failed' : 'completed', config: cfg, progress: { total: cfg.inputs.length, completed, failed, error: lastError } });
        }
        finally {
            this.runningJobs.delete(id);
        }
    }
    get busy():boolean {return this.runningJobs.size>0||this.requests.size>0||this.pendingIds.size>0}
    async jobs(documentVersionId: string): Promise<DocumentJob[]> { return this.store('m3.jobs', { documentVersionId }); }
}
