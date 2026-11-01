import { randomUUID } from 'node:crypto'
import type { ReadingHeartbeat, ReadingSample } from '../../shared/analytics'
/** Pure controller: focus/idle gates are supplied by main, never trusted from renderer. */
export class ReadingController {
 private previous: {value:ReadingHeartbeat;at:number;mono:number;sessionId:string}|null=null
 constructor(private write:(value:ReadingSample)=>Promise<unknown>,private now=()=>Date.now(),private monotonic=()=>performance.now()){}
 reset():void{this.previous=null}
 async heartbeat(value:ReadingHeartbeat,eligible:boolean):Promise<boolean>{
  const at=this.now(),mono=this.monotonic(),previous=this.previous
  if(!eligible||!value.visible||!value.active){this.reset();return false}
  const continuous=!!previous&&mono-previous.mono>0&&mono-previous.mono<=15000&&at-previous.at>0&&at-previous.at<=15000&&Math.abs((at-previous.at)-(mono-previous.mono))<1000
  const sessionId=continuous?previous.sessionId:randomUUID()
  // Update synchronously before awaiting the single writer, so concurrent heartbeats cannot double count.
  this.previous={value:{...value},at,mono,sessionId}
  if(continuous){await this.write({id:randomUUID(),sessionId:previous.sessionId,documentVersionId:previous.value.documentVersionId,pageIndex:previous.value.pageIndex,startedAt:new Date(previous.at).toISOString(),finishedAt:new Date(at).toISOString(),visit:false})}
  if(!continuous||previous.value.documentVersionId!==value.documentVersionId||previous.value.pageIndex!==value.pageIndex){await this.write({id:randomUUID(),sessionId,documentVersionId:value.documentVersionId,pageIndex:value.pageIndex,startedAt:new Date(at).toISOString(),finishedAt:new Date(at).toISOString(),visit:true})}
  return true
 }
}
