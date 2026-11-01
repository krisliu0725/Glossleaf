import { ui } from '../i18n'
import { useState } from 'react'
import type { SearchGroup, SearchHit } from '@shared/m4'
export function Highlight({ text, marks }: {text:string;marks:Array<[number,number]>}):React.ReactElement {
 const sorted=[...marks].sort((a,b)=>a[0]-b[0]),parts:React.ReactNode[]=[];let at=0
 for(const [start,end]of sorted){if(end<=at)continue;if(start>at)parts.push(text.slice(at,start));parts.push(<mark key={`${start}-${end}`}>{text.slice(Math.max(at,start),end)}</mark>);at=end}
 parts.push(text.slice(at));return <>{parts}</>
}
export default function SearchResults({groups,onHit}:{groups:SearchGroup[];onHit:(hit:SearchHit)=>void}):React.ReactElement {
 const [expanded,setExpanded]=useState<Set<string>>(new Set())
 return <div className="search-groups">{groups.map(group=><section className="search-group" key={group.itemId}>
  <h3>{group.title||ui("（无标题）")}</h3>
  {(expanded.has(group.itemId)?group.hits:group.hits.slice(0,3)).map(hit=><button key={hit.id} className="search-hit" data-kind={hit.kind} onClick={()=>onHit(hit)}>
   <span className="search-hit__label">{hit.kind==='metadata'?ui("文献信息"):hit.kind==='body'?ui("正文"):hit.annotationType==='note'?ui("朱批"):ui("撷英")}{hit.pageIndex!==null?ui("· 第 {0} 页", hit.pageIndex+1):''}</span>
   <span><Highlight text={hit.snippet} marks={hit.marks}/></span>
  </button>)}
  {group.hits.length>3&&<button className="provider-text-button search-expand" onClick={()=>setExpanded(s=>{const n=new Set(s);if(n.has(group.itemId))n.delete(group.itemId);else n.add(group.itemId);return n})}>{expanded.has(group.itemId)?ui("收起"):ui("展开其余 {0} 处命中", group.hits.length-3)}</button>}
 </section>)}</div>
}
