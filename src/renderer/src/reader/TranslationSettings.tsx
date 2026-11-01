import { ui } from '../i18n'
import { useEffect, useState } from 'react';
import type { ModelOption, ProviderConfig, ProviderSettings } from '@shared/m3';
import { inferPreset, PROVIDER_PRESETS, requestPreview } from '@shared/providers';
import Dialog from './Dialog';

const suggestions = { anthropic:[], compatible: [], gemini: ['gemma-4-26b-a4b-it', 'gemma-4-31b-it', 'gemini-3.1-flash-lite'], ollama: ['qwen3:8b'] };
function SettingsShell({embedded,children,footer,...rest}:{embedded?:boolean;children:React.ReactNode;footer?:React.ReactNode;title:string;onClose:()=>void}):React.ReactElement{return embedded?<div className="translation-settings-embedded">{children}<div className="embedded-footer">{footer}</div></div>:<Dialog {...rest} footer={footer}>{children}</Dialog>}
export default function TranslationSettings({ onClose, onSaved,embedded=false }: {
    embedded?:boolean;
    onClose: () => void;
    onSaved: () => void;
}): React.ReactElement {
    const [config, setConfig] = useState<ProviderSettings | null>(null);
    const [preset, setPreset] = useState('custom');
    const [key, setKey] = useState<string | undefined>();
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [models, setModels] = useState<ModelOption[]>([]);
    useEffect(() => { void window.jian.m3.settings().then(r => {
        if (r.ok) { setConfig(r.data); setPreset(inferPreset(r.data)); }
        else setMessage(r.error.message);
    }); }, []);
    let local = false;
    try { local = !!config && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.baseUrl).hostname); } catch { /* Draft endpoint may be incomplete while typing. */ }
    const change = (patch: Partial<ProviderSettings>) => setConfig(c => c ? { ...c, ...patch } : null);
    function changeEndpoint(patch: Partial<ProviderConfig>): void {
        change({ ...patch, hasKey: false, consent: false });
        setKey(undefined); setModels([]); setMessage('');
    }
    async function save(): Promise<void> {
        if (!config) return;
        setBusy(true);
        try {
            const r = await window.jian.m3.configure(config, key);
            setMessage(r.ok ? ui("配置已保存") : r.error.message);
            if (r.ok) { setConfig(r.data); setKey(undefined); onSaved(); }
        } finally { setBusy(false); }
    }
    async function discover(): Promise<void> {
        if (!config) return;
        setBusy(true); setMessage(ui("正在获取模型…"));
        try {
            const r = await window.jian.m3.models({ ...config, model: config.model.trim() || 'model-list' }, key);
            if (r.ok) { setModels(r.data); setMessage(ui("取得 {0} 个模型，可从模型输入框选择，也可手动填写。", r.data.length)); }
            else setMessage(ui(r.error.message) + ui("；也可以手动填写模型 ID。"));
        } finally { setBusy(false); }
    }
    async function test(): Promise<void> {
        if (!config) return;
        setBusy(true); setMessage(ui("正在用当前配置翻译示例句…"));
        try {
            const r = await window.jian.m3.testDraft(config, key);
            setMessage(r.ok ? ui("测试成功：{0}", r.data) : r.error.message);
        } finally { setBusy(false); }
    }
    return <SettingsShell embedded={embedded} title={ui("翻译设置")} onClose={onClose} footer={config ? <div className="provider-footer-content">
        <label className="provider-consent"><input type="checkbox" disabled={busy} checked={config.consent} onChange={e => change({ consent: e.target.checked })}/>{ui("我同意向此服务发送翻译内容")}</label>
        {!local && !config.consent && <p className="m3-muted provider-consent-hint">{ui("测试和翻译前，请勾选上方授权。")}</p>}{message && <p role="status" className="provider-status">{ui(message)}</p>}
        <div className="m3-actions"><button type="submit" form="provider-settings" className="btn btn--primary" disabled={busy}>{ui("保存配置")}</button><button type="button" className="btn" disabled={busy || (!local && !config.consent)} title={!local && !config.consent ? ui("请先同意向此服务发送翻译内容") : ui("使用当前填写的配置测试")} onClick={() => void test()}>{ui("测试翻译")}</button></div>
    </div> : undefined}>{config ? <form id="provider-settings" onSubmit={e => { e.preventDefault(); void save(); }} className="m3-form provider-form">
        <p className="m3-muted provider-intro">{ui("选择服务，自由调整连接方式。配置只保存在本机。")}</p><p className="m3-muted">{ui("连接设置可自由调整，模型 ID 以服务商实际开放为准。")}</p>
        <fieldset disabled={busy} className="provider-fields">
            <label>{ui("服务")}<select value={preset} onChange={e => {
                const id = e.target.value; setPreset(id);
                const p = PROVIDER_PRESETS.find(p => p.id === id);
                if (p) changeEndpoint({ kind: p.kind, baseUrl: p.baseUrl, model: p.model,temperature:undefined });
            }}>
                {PROVIDER_PRESETS.map(p => <option key={p.id} value={p.id}>{ui(p.label)}</option>)}
                <option value="custom">{ui("自定义服务")}</option>
            </select></label>
            <label>{ui("API 基础地址")}<input type="url" required value={config.baseUrl} onChange={e => { setPreset('custom'); changeEndpoint({ baseUrl: e.target.value }); }} spellCheck={false} placeholder="https://api.deepseek.com"/></label>
            <label>{ui("模型 ID")}<input required list="provider-models" value={config.model} onChange={e => change({ model: e.target.value })} spellCheck={false} placeholder={ui("可直接输入服务商提供的模型 ID")}/></label>
            <datalist id="provider-models">{[...new Map([...suggestions[config.kind].map(id => ({ id, label: id })), ...models].map(m => [m.id, m])).values()].map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
            <div className="m3-actions"><button type="button" className="btn" onClick={() => void discover()}>{ui("获取模型列表")}</button><span className="m3-muted">{ui("支持手动填写；列表以服务商返回为准")}</span></div>
            {config.kind !== 'ollama' && <label>API Key<input type="password" autoComplete="off" value={key ?? ''} placeholder={key === '' ? ui("保存后移除该端点的密钥") : ui("留空使用该端点已保存的密钥")} onChange={e => setKey(e.target.value || undefined)}/><span className="provider-key-hint m3-muted">{key === '' ? ui("已标记移除；点击保存配置后生效。") : config.hasKey ? ui("当前端点已有密钥，使用系统安全存储加密保存。") : ui("密钥按协议和端点分别加密保存，可随时替换。")} <button type="button" className="provider-text-button" onClick={() => { setKey(key === '' ? undefined : ''); setMessage(''); }}>{key === '' ? ui("撤销移除") : ui("移除此端点密钥")}</button></span></label>}
            <details className="provider-advanced"><summary>{ui("更多设置")}</summary><div className="provider-advanced-fields">
            <label>{ui("接口协议")}<select value={config.kind} onChange={e => { setPreset('custom'); changeEndpoint({ kind: e.target.value as ProviderConfig['kind'] }); }}>
                <option value="compatible">{ui("OpenAI 兼容 · Chat Completions")}</option>
                <option value="anthropic">{ui("Anthropic 原生 · Claude")}</option><option value="gemini">{ui("Google 原生 · Gemini / Gemma")}</option>
                <option value="ollama">{ui("Ollama 本地接口")}</option>
            </select></label>
                <label>{ui("目标语言")}<input required value={config.targetLanguage} onChange={e => change({ targetLanguage: e.target.value })}/></label>
                <div className="provider-numbers">{config.kind!=='anthropic'&&<label>{ui("生成温度")}<input type="number" min="0" max="2" step="0.1" placeholder={ui("服务默认")} value={config.temperature ?? ''} onChange={e => change({ temperature: e.target.value===''?undefined:Number(e.target.value) })}/></label>}<label>{ui("请求超时 · 秒")}<input type="number" min="15" max="300" step="1" value={(config.timeoutMs ?? 90000) / 1000} onChange={e => change({ timeoutMs: Number(e.target.value) * 1000 })}/></label></div>
                <p className="m3-muted">{ui("翻译建议使用较低 Temperature；可用范围以模型要求为准。")}</p>
                <label>{ui("翻译提示词")}<textarea maxLength={4000} value={config.prompt??''} onChange={e=>change({prompt:e.target.value})} placeholder={ui("可补充术语风格与译文要求")}/></label><label className="m3-muted">{ui("实际请求地址")}<code className="provider-request">{requestPreview(config)}</code></label>
            </div></details>
            <p className="m3-muted">{ui("翻译会发送选中内容、所属段落及命中的术语。文件名、路径与笔记不会发送。测试翻译只发送一条示例句，可能产生少量用量。")}</p>
        </fieldset>
    </form> : <p>{ui(message) || ui("正在读取配置…")}</p>}</SettingsShell>;
}
