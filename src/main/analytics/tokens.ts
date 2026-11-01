import type { TokenUsage } from '../../shared/analytics'
const count=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null
export const unknownUsage=():TokenUsage=>({inputTokens:null,outputTokens:null,totalTokens:null,cachedInputTokens:null,reasoningTokens:null})
/** Responses report cumulative counters. Replace fields, never add chunks. */
export function reportedUsage(kind:'compatible'|'gemini'|'ollama'|'anthropic',value:Record<string,any>,previous:TokenUsage):TokenUsage {
 let next:TokenUsage
 if(kind==='anthropic'){
  const u=value.usage??value.message?.usage;if(!u||typeof u!=='object')return previous
  const cached=count(u.cache_read_input_tokens)??previous.cachedInputTokens,created=count(u.cache_creation_input_tokens),raw=count(u.input_tokens)
  const inputTokens=raw===null?previous.inputTokens:raw+(cached??0)+(created??0),outputTokens=count(u.output_tokens)??previous.outputTokens
  next={inputTokens,outputTokens,totalTokens:inputTokens!==null&&outputTokens!==null?inputTokens+outputTokens:null,cachedInputTokens:cached,reasoningTokens:null}
 }else if(kind==='gemini'){
  const u=value.usageMetadata;if(!u||typeof u!=='object')return previous
  next={inputTokens:count(u.promptTokenCount),outputTokens:count(u.candidatesTokenCount),totalTokens:count(u.totalTokenCount),cachedInputTokens:count(u.cachedContentTokenCount),reasoningTokens:count(u.thoughtsTokenCount)}
 }else if(kind==='ollama'){
  if(!value.done)return previous
  const inputTokens=count(value.prompt_eval_count),outputTokens=count(value.eval_count)
  next={inputTokens,outputTokens,totalTokens:inputTokens!==null&&outputTokens!==null?inputTokens+outputTokens:null,cachedInputTokens:count(value.prompt_eval_cached_count),reasoningTokens:null}
 }else{
  const u=value.usage;if(!u||typeof u!=='object')return previous
  next={inputTokens:count(u.prompt_tokens),outputTokens:count(u.completion_tokens),totalTokens:count(u.total_tokens),cachedInputTokens:count(u.prompt_tokens_details?.cached_tokens??u.prompt_cache_hit_tokens),reasoningTokens:count(u.completion_tokens_details?.reasoning_tokens)}
 }
 return Object.fromEntries(Object.entries(next).map(([key,n])=>[key,n??previous[key as keyof TokenUsage]])) as unknown as TokenUsage
}
