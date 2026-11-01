import { localize, type Locale } from '../../shared/localization'
import { readAnchors } from '../../shared/anchors'
import { createHash } from 'node:crypto'
import CSL from 'citeproc'
import apa from '../../../resources/csl/apa.csl?raw'
import mla from '../../../resources/csl/modern-language-association.csl?raw'
import chicago from '../../../resources/csl/chicago-author-date.csl?raw'
import ieee from '../../../resources/csl/ieee.csl?raw'
import { CITATION_STYLES, type CitationStyle } from '../../shared/m4'
import style from '../../../resources/csl/gbt7714-2015-numeric.csl?raw'
import zh from '../../../resources/csl/locales-zh-CN.xml?raw'
import en from '../../../resources/csl/locales-en-US.xml?raw'
import type { ItemDetail, Creator } from '../../shared/domain'
import type { ExportFormat, ExportPreview } from '../../shared/m4'
import type { ExportRow } from '../../data-service/m4'
const typeMap:Record<string,string>={journalArticle:'article-journal',book:'book',bookSection:'chapter',conferencePaper:'paper-conference',thesis:'thesis',report:'report',webpage:'webpage',preprint:'article',dataset:'dataset',patent:'patent',newspaperArticle:'article-newspaper',magazineArticle:'article-magazine'}
const bibTypes:Record<string,string>={journalArticle:'article',book:'book',bookSection:'incollection',conferencePaper:'inproceedings',thesis:'phdthesis',report:'techreport'}
export const citationProvenance={processor:'citeproc-js 2.4.63',style:'GB/T 7714-2015 顺序编码（CSL）',styleId:'china-national-standard-gb-t-7714-2015-numeric',locale:'zh-CN + en-US',mapping:'jian-csl/1',styleSha256:createHash('sha256').update(style).digest('hex'),localeZhSha256:createHash('sha256').update(zh).digest('hex'),localeEnSha256:createHash('sha256').update(en).digest('hex')}
function fieldsFor(item:ItemDetail):Record<string,string> {
 const f={...item.fields}
 f.publicationTitle ||= f.bookTitle||f.proceedingsTitle||f.websiteTitle||''
 f.publisher ||= f.university||f.institution||''
 return f
}
function cslName(c:Creator):Record<string,string> {return c.nameMode==='literal'?{literal:c.literalName??''}:{...(c.familyName?{family:c.familyName}:{}),...(c.givenName?{given:c.givenName}:{})}}
export function toCsl(item:ItemDetail):Record<string,unknown> {
 const out:Record<string,unknown>={id:item.id,type:typeMap[item.type]??'document',title:item.title},values=fieldsFor(item)
 const fields:Record<string,string>={publicationTitle:'container-title',volume:'volume',issue:'issue',pages:'page',publisher:'publisher',place:'publisher-place',DOI:'DOI',url:'URL',ISBN:'ISBN',ISSN:'ISSN',edition:'edition',series:'collection-title',abstractNote:'abstract',shortTitle:'title-short'}
 for(const [from,to]of Object.entries(fields))if(values[from])out[to]=values[from]
 if(item.type==='thesis'&&item.fields.thesisType)out.genre=item.fields.thesisType
 if(item.type==='report'&&item.fields.reportType)out.genre=item.fields.reportType
 if(item.language)out.language=item.language
 if(item.date){const m=/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(item.date);out.issued=m?{'date-parts':[m.slice(1).filter(Boolean).map(Number)]}:{literal:item.date}}
 for(const role of ['author','editor','translator']){const names=item.creatorsList.filter(c=>c.role===role).map(cslName);if(names.length)out[role]=names}
 return out
}
const styles:Record<CitationStyle,string>={gbt:style,apa,mla,chicago,ieee}
function citationEngine(items:ItemDetail[],selected:CitationStyle,output:'html'|'text'):{engine:any;records:Record<string,unknown>[]} {
 const records=items.map(toCsl),byId=new Map(records.map(r=>[String(r.id),r]))
 const engine=new CSL.Engine({retrieveLocale:(lang:string)=>lang.startsWith('zh')?zh:en,retrieveItem:(id:string)=>byId.get(id)},styles[selected],selected==='gbt'?'zh-CN':'en-US')
 engine.setOutputFormat(output);engine.updateItems(items.map(i=>i.id));return {engine,records}
}
export function formatCitations(items:ItemDetail[],selected:CitationStyle='gbt'):string {
 const {engine}=citationEngine(items,selected,'text'),result=engine.makeBibliography()
 if(!result)throw new Error('引用处理器未生成参考文献')
 return result[1].join('').trim()
}
export function citationOutput(items:ItemDetail[],selected:CitationStyle='gbt'):{html:string;inText:string} {
 const {engine}=citationEngine(items,selected,'html'),result=engine.makeBibliography()
 if(!result)throw new Error('引用处理器未生成参考文献')
 const textEngine=citationEngine(items,selected,'text').engine
 return {html:'<div class="csl-bib-body">'+result[1].join('')+'</div>',inText:textEngine.makeCitationCluster(items.map(i=>({id:i.id}))) as string}
}
export function toRis(item:ItemDetail):string {
 const types:Record<string,string>={journalArticle:'JOUR',book:'BOOK',bookSection:'CHAP',conferencePaper:'CONF',thesis:'THES',report:'RPRT',webpage:'ELEC',dataset:'DATA',preprint:'UNPB'}
 const line=(tag:string,value:string)=>value?tag+'  - '+value.replace(/[\r\n]+/g,' ')+'\n':''
 let text=line('TY',types[item.type]??'GEN')+line('TI',item.title)
 for(const c of item.creatorsList){const tag=c.role==='editor'?'ED':c.role==='author'?'AU':null;if(tag)text+=line(tag,c.nameMode==='literal'?c.literalName??'':[c.familyName,c.givenName].filter(Boolean).join(', '))}
 const fields:Record<string,string>={publicationTitle:'T2',DOI:'DO',url:'UR',volume:'VL',issue:'IS',publisher:'PB',place:'CY',abstractNote:'AB',ISSN:'SN',ISBN:'SN'}
 for(const [key,tag]of Object.entries(fields))text+=line(tag,fieldsFor(item)[key]??'')
 if(item.date)text+=line('PY',item.date.slice(0,4))+line('DA',item.date.replace(/-/g,'/'))
 if(item.fields.pages){const [first,...last]=item.fields.pages.split(/[-–—]/);text+=line('SP',first);if(last.length)text+=line('EP',last.join('-'))}
 return text+'ER  - \n'
}
function bibEscape(value:string):string {return value.replace(/[\\{}%&$#_~^]/g,c=>({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','&':'\\&','$':'\\$','#':'\\#','_':'\\_','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[c]!)).replace(/[\r\n]+/g,' ')}
export function toBibtex(item:ItemDetail):string {
 const entries:Record<string,string>={title:bibEscape(item.title)},values=fieldsFor(item)
 for(const role of ['author','editor']){const people=item.creatorsList.filter(c=>c.role===role).map(c=>c.nameMode==='literal'?'{'+bibEscape(c.literalName??'')+'}':[c.familyName,c.givenName].filter(Boolean).map(s=>bibEscape(s!)).join(', '));if(people.length)entries[role]=people.join(' and ')}
 const fields:Record<string,string>={publicationTitle:item.type==='bookSection'||item.type==='conferencePaper'?'booktitle':'journal',volume:'volume',issue:'number',pages:'pages',publisher:item.type==='thesis'?'school':item.type==='report'?'institution':'publisher',place:'address',DOI:'doi',url:'url',ISBN:'isbn',ISSN:'issn',edition:'edition',series:'series'}
 for(const[from,to]of Object.entries(fields))if(values[from])entries[to]=bibEscape(values[from])
 if(item.date){const match=/^(\d{4})(?:-(\d{2}))?/.exec(item.date);if(match){entries.year=match[1];if(match[2])entries.month=match[2]}else entries.note=bibEscape('Date: '+item.date)}
 const bibType=item.type==='thesis'?/master|硕士/i.test(item.fields.thesisType??'')?'mastersthesis':/doctor|phd|博士/i.test(item.fields.thesisType??'')?'phdthesis':'misc':bibTypes[item.type]??'misc'
 if(item.type==='thesis'&&bibType==='misc')entries.note=bibEscape(item.fields.thesisType||'Thesis (degree unspecified)')
 return '@'+bibType+'{jian_'+item.id.replace(/-/g,'')+',\n'+Object.entries(entries).map(([key,value])=>'  '+key+' = {'+value+'}').join(',\n')+'\n}'
}
const md=(s:string):string=>s.replace(/[\\`*_{}\[\]<>#!|]/g,'\\$&').replace(/[\r\n]+/g,' ')
export function buildExport(rows:ExportRow[],format:ExportFormat,locale:Locale='zh',selected:CitationStyle='gbt'):ExportPreview {
 const items=rows.map(r=>r.item),warnings:string[]=[]
 for(const item of items){if(!item.creatorsList.some(c=>c.role==='author'))warnings.push(`「${item.title}」未记录作者，引用按无作者条目处理。`);if(!item.date)warnings.push(`「${item.title}」未记录日期。`);if(!typeMap[item.type])warnings.push(`「${item.title}」类型 ${item.type} 采用通用映射，请检查。`)}
 const excerpts=rows.map(r=>({item:toCsl(r.item),annotations:r.annotations.map(a=>({id:a.id,documentVersionId:a.documentVersionId,type:a.type,markStyle:a.markStyle??'highlight',quote:a.quote,translation:a.output??null,comment:a.comment??'',anchors:readAnchors(String(a.anchorsJson),String(a.documentVersionId),String(a.quote)),createdAt:a.createdAt}))}))
 let content='',extension='',html:string|undefined,inText:string|undefined,provenance:Record<string,string>={mapping:'jian-export/1'}
 if(format==='csl-json'){content=JSON.stringify(items.map(toCsl),null,2);extension='json'}
 else if(format==='bibtex'){content=items.map(toBibtex).join('\n\n');extension='bib'}
 else if(format==='ris'){content=items.map(toRis).join('\n');extension='ris'}
 else if(format==='citation'||format==='bibliography-html'){content=formatCitations(items,selected);({html,inText}=citationOutput(items,selected));extension=format==='citation'?'txt':'html';if(format==='bibliography-html')content='<!doctype html><html><head><meta charset="utf-8"><title>Glossleaf · Bibliography</title><style>body{max-width:48rem;margin:4rem auto;padding:0 2rem;font:17px/1.8 Georgia,serif}.csl-entry{margin-bottom:1em}.csl-left-margin{float:left;padding-right:1em}</style></head><body>'+html+'</body></html>';provenance={...citationProvenance,style:CITATION_STYLES.find(s=>s.id===selected)!.label,styleId:styles[selected].match(/<id>([^<]+)<\/id>/)?.[1]??selected,styleSha256:createHash('sha256').update(styles[selected]).digest('hex'),license:'CC BY-SA 3.0'}}
 else if(format==='excerpts-json'){content=JSON.stringify({format:'jian-reading/1',items:excerpts},null,2);extension='json'}
 else {extension='md';content=(locale==='en'?'# Glossleaf · Excerpts\n\n':'# 笺 · 阅读撷英\n\n')+excerpts.map((r,i)=>{
  const item=items[i]
  const header=`## ${md(item.title)}\n\n${md([item.creators,item.date].filter(Boolean).join(' · '))}\n\n`+(item.fields.DOI?`DOI：${md(item.fields.DOI)}\n\n`:'')+(locale==='en'?`Document ID: ${item.id}\n\n`:`文献 ID：${item.id}\n\n`)
  return header+(r.annotations.length?r.annotations.map((a,j)=>`### ${j+1}. ${[...new Set(a.anchors.map(anchor=>anchor.pageLabel??String(anchor.pageIndex+1)))].map(p=>locale==='en'?'Page '+p:'第 '+p+' 页').join(locale==='en'?', ':'、')}\n\n`+String(a.quote).split('\n').map(line=>'> '+md(line)).join('\n')+'\n\n'+(a.translation?(locale==='en'?'Translation:\n\n':'译文：\n\n')+String(a.translation).split('\n').map(line=>'> '+md(line)).join('\n')+'\n\n':'')+(a.comment?(locale==='en'?'Comment: ':'评论：')+md(String(a.comment))+'\n\n':'')+(locale==='en'?`Source: document version ${a.documentVersionId} · excerpt ${a.id}\n\n`:`来源：文档版本 ${a.documentVersionId} · 摘录 ${a.id}\n\n`)).join(''):locale==='en'?'No saved excerpts.\n\n':'暂无保存的摘录。\n\n')
 }).join('---\n\n')}
 if(format==='bibtex'||format==='csl-json'||format==='ris')warnings.push('文献交换仅导出支持映射的元数据，不包含附件、集合、标注、阅读位置或翻译任务。')
 if(format==='markdown'||format==='excerpts-json')warnings.push('阅读成果包含已保存摘录；不包含 PDF 文件，也不能替代完整文库备份。')
 return {html,inText,content:content+'\n',filename:`glossleaf-${items.length===1?items[0].id.slice(0,8):'selection'}-${format}.${extension}`,extension,warnings:[...new Set(warnings)].map(w=>localize(w,locale)),provenance:{...provenance,style:provenance.style?localize(provenance.style,locale):''}}
}
