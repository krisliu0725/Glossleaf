import type { ProviderConfig } from './m3'

export const PROVIDER_PRESETS = [
  { id: 'deepseek', label: 'DeepSeek 官方 API', kind: 'compatible', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  { id: 'openai', label: 'OpenAI · GPT', kind: 'compatible', baseUrl: 'https://api.openai.com/v1', model: '' },
  { id: 'anthropic', label: 'Anthropic · Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: '' },
  { id: 'kimi', label: 'Moonshot · Kimi', kind: 'compatible', baseUrl: 'https://api.moonshot.ai/v1', model: '' },
  { id: 'kimi-cn', label: 'Moonshot · Kimi（中国）', kind: 'compatible', baseUrl: 'https://api.moonshot.cn/v1', model: '' },
  { id: 'gemma', label: 'Google Gemini API · Gemma 4', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemma-4-26b-a4b-it' },
  { id: 'gemini', label: 'Google Gemini API · Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-lite' },
  { id: 'ollama', label: '本地模型 · Ollama', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen3:8b' },
] as const

export function normalizeBaseUrl(kind: ProviderConfig['kind'], value: string): string {
  let base = value.trim().replace(/\/+$/, '')
  if (kind === 'compatible') base = base.replace(/\/(chat\/completions|models)$/, '')
  else if (kind === 'anthropic') base = base.replace(/\/(messages|models)$/, '')
  else if (kind === 'gemini') base = base.replace(/\/models(?:\/[^/]+:(?:streamGenerateContent|generateContent))?$/, '')
  else base = base.replace(/\/api\/(chat|tags)$/, '')
  return base
}
export function credentialIdentity(config: Pick<ProviderConfig, 'kind' | 'baseUrl'>): string {
  return JSON.stringify([config.kind, normalizeBaseUrl(config.kind, config.baseUrl)])
}
export function inferPreset(config: ProviderConfig): string {
  const base = normalizeBaseUrl(config.kind, config.baseUrl)
  if (config.kind === 'gemini' && base === PROVIDER_PRESETS.find(p=>p.id==='gemini')!.baseUrl) return config.model.replace(/^models\//, '').startsWith('gemma-') ? 'gemma' : 'gemini'
  return PROVIDER_PRESETS.find(p => p.kind === config.kind && p.baseUrl === base)?.id ?? 'custom'
}
export function requestPreview(config: ProviderConfig): string {
  const base = normalizeBaseUrl(config.kind, config.baseUrl)
  if (config.kind === 'gemini') return `${base}/models/${encodeURIComponent(config.model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`
  if(config.kind==='anthropic') return base+'/messages'
  return base + (config.kind === 'ollama' ? '/api/chat' : '/chat/completions')
}
