import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {openLibrary} from '../src/data-service/db'
import {dispatchM4,type ExportRow} from '../src/data-service/m4'
import {buildExport} from '../src/main/m4/exports'
import {CITATION_STYLES,type MetadataDraft} from '../src/shared/m4'
import {doiHints,titleSimilarity,metadataChanges,mergeMetadata} from '../src/shared/metadata-match'
import {resolveDoi,findMetadata,fromDataCite,metadataJson} from '../src/main/m4/metadata'
import {listModels,translateRemote,prepare} from '../src/main/translation/core'
import {PROVIDER_PRESETS,requestPreview,inferPreset,credentialIdentity} from '../src/shared/providers'
import {reportedUsage,unknownUsage} from '../src/main/analytics/tokens'
import type {ProviderConfig} from '../src/shared/m3'
const draft:MetadataDraft={title:'Evidence and Interpretation',type:'journalArticle',date:'2026-02-15',language:'en',fields:{DOI:'10.1234/evidence',publicationTitle:'Journal of Research',volume:'12',issue:'3',pages:'20-35'},creators:[{order:0,role:'author',nameMode:'person',familyName:'Smith',givenName:'Alice',literalName:null},{order:1,role:'author',nameMode:'literal',familyName:null,givenName:null,literalName:'World Research Council'}]}
const raw={DOI:'10.1234/evidence',title:['Evidence and Interpretation'],type:'journal-article',published:{'date-parts':[[2026,2,15]]},author:[{family:'Smith',given:'Alice'},{name:'World Research Council'}],'container-title':['Journal of Research']}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})
test('all five real CSL styles render bibliography, in-text citation and rich HTML; APA and MLA differ',()=>{
 const dir=mkdtempSync(join(tmpdir(),'glossleaf-cite-')),db=openLibrary(dir)
 try{const id=dispatchM4(db,'m4.metadataSave',{draft}) as string,rows=dispatchM4(db,'m4.exportData',{ids:[id]}) as ExportRow[],results=new Map<string,string>()
 for(const {id:style}of CITATION_STYLES){const result=buildExport(rows,'citation','en',style);assert.match(result.content,/smith/i);assert.match(result.content,/evidence/i);assert.ok(result.inText);assert.ok(result.html?.includes('csl-entry'));assert.equal(result.provenance.styleSha256.length,64);results.set(style,result.content);const html=buildExport(rows,'bibliography-html','en',style);assert.match(html.content,/<meta charset="utf-8">/);assert.equal(html.extension,'html')}
 const unsafe=buildExport([{...rows[0],item:{...rows[0].item,title:'A <script>alert(1)</script> test',fields:{url:'javascript:alert(1)'}}}],'bibliography-html','en','apa');assert.doesNotMatch(unsafe.content,/<script[ >]|href=["']javascript:/i)
 assert.match(results.get('apa')!,/Smith, A\./);assert.match(results.get('apa')!,/\(2026\)/);assert.match(results.get('mla')!,/Smith, Alice/);assert.notEqual(results.get('apa'),results.get('mla'))
 const ris=buildExport(rows,'ris');assert.match(ris.content,/TY  - JOUR/);assert.match(ris.content,/AU  - Smith, Alice/);assert.match(ris.content,/AU  - World Research Council/);assert.match(ris.content,/SP  - 20/);assert.match(ris.content,/EP  - 35/);assert.match(ris.content,/ER  - /)
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
})
test('metadata hints and title ranking handle Chinese, accents and identifiers without treating filename authors as facts',()=>{
 assert.deepEqual(doiHints('DOI: 10.1234/EXAMPLE. 正文 https://doi.org/10.5555/abc;'),['10.1234/example','10.5555/abc'])
 assert.equal(titleSimilarity('“生命治理”：证据与方法','生命治理：证据与方法'),1)
 assert.ok(titleSimilarity('Evidence and Interpretation','Evidence and Interpretation: An Essay')>.7)
 assert.ok(titleSimilarity('Evidence and Interpretation','Unrelated chemistry')<.4)
})
test('field-level merge preserves existing authors and title by default; explicit replacement preserves source-only fields',()=>{
 const current={...draft,title:'Original title',creators:[{...draft.creators[0],familyName:'Original'}],fields:{custom:'Keep me',DOI:'10.1234/evidence'}}
 const changes=metadataChanges(current,draft),keys=changes.filter(c=>c.use).map(c=>c.key),merged=mergeMetadata(current,draft,keys)
 assert.equal(merged.title,'Original title');assert.equal(merged.creators[0].familyName,'Original');assert.equal(merged.fields.publicationTitle,'Journal of Research');assert.equal(merged.fields.custom,'Keep me')
 const replaced=mergeMetadata(current,draft,['creators','title']);assert.equal(replaced.title,draft.title);assert.equal(replaced.creators[0].familyName,'Smith');assert.equal(replaced.fields.custom,'Keep me');assert.equal(replaced.fields.publicationTitle,undefined)
 assert.deepEqual(mergeMetadata(current,draft,[]),current)
})
test('DOI resolution checks identifiers, falls back to DataCite only for 404, and preserves organization names',async()=>{
 const urls:string[]=[]
 const data={doi:raw.DOI,titles:[{title:draft.title}],publicationYear:2026,types:{resourceTypeGeneral:'Dataset'},creators:[{name:'World Council',nameType:'Organizational'},{name:'Smith, Alice',nameType:'Personal',familyName:'Smith',givenName:'Alice'}]}
 const mock=(async(url:any)=>{urls.push(String(url));return String(url).includes('crossref')?json({},404):json({data:{attributes:data}})}) as typeof fetch
 const result=await resolveDoi(raw.DOI,new AbortController().signal,mock);assert.equal(result.draft.type,'dataset');assert.equal(result.draft.creators[0].nameMode,'literal');assert.equal(result.draft.creators[1].familyName,'Smith');assert.equal(urls.length,2);assert.match(urls[1],/^https:\/\/api.datacite.org\/dois\//)
 assert.throws(()=>fromDataCite({...data,doi:'10.1234/wrong'},raw.DOI));let calls=0
 await assert.rejects(()=>resolveDoi(raw.DOI,new AbortController().signal,(async()=>{calls++;return json({},429)}) as typeof fetch));assert.equal(calls,1)
})
test('title query sends only bounded query to fixed Crossref host, sorts candidates locally and retains explicit mismatch evidence',async()=>{
 let sent='';const result=await findMetadata(draft.title,new AbortController().signal,(async(url:any)=>{sent=String(url);return json({message:{items:[{...raw,DOI:'10.1234/unrelated',title:['Other topic']},raw,{...raw,DOI:''}]}})}) as typeof fetch)
 assert.equal(new URL(sent).hostname,'api.crossref.org');assert.equal(new URL(sent).searchParams.get('query.bibliographic'),draft.title);assert.equal(result.length,2);assert.equal(result[0].doi,raw.DOI);assert.equal(result[0].similarity,1);assert.equal(result[0].match,'title')
 await assert.rejects(()=>metadataJson('https://api.crossref.org/works/x',new AbortController().signal,(async()=>new Response('x'.repeat(2_000_001))) as typeof fetch),/大小上限/)
 const c=new AbortController();c.abort();await assert.rejects(()=>resolveDoi(raw.DOI,c.signal,(async(_url:any,opts:any)=>{opts.signal.throwIfAborted();return json({})}) as typeof fetch))
})
test('presets keep service-specific URLs and editable models; protocol and endpoint isolate credentials',()=>{
 for(const id of ['deepseek','openai','anthropic','gemini','gemma','kimi','kimi-cn','ollama'])assert.ok(PROVIDER_PRESETS.some(p=>p.id===id))
 const config:ProviderConfig={kind:'anthropic',baseUrl:'https://api.anthropic.com/v1/messages',model:'chosen-by-user',targetLanguage:'zh-CN',consent:true}
 assert.equal(requestPreview(config),'https://api.anthropic.com/v1/messages');assert.equal(inferPreset(config),'anthropic');assert.notEqual(credentialIdentity(config),credentialIdentity({...config,kind:'compatible'}))
 assert.equal(inferPreset({...config,kind:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'gemma-4-sample'}),'gemma')
})
test('Claude native request, model pagination, text-only SSE and cumulative usage work without compatible-protocol shortcuts',async()=>{
 let stopped=false,modelRequests=0;const attempts:any[]=[],server=createServer(async(req,res)=>{
 assert.equal(req.headers.authorization,'Bearer fixture-key');assert.equal(req.headers['anthropic-version'],'2026-10-21')
 if(req.method==='GET'){modelRequests++;const more=!req.url?.includes('after_id');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:more?'model-a':'model-b',display_name:'Model'}],has_more:more,last_id:'model-a'}));return}
 let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);assert.ok(b.system);assert.equal(b.messages.some((m:any)=>m.role==='system'),false);assert.equal(b.max_tokens,8192);assert.equal(b.temperature,undefined);assert.equal(b.stream_options,undefined)
 const events=[{type:'message_start',message:{usage:{input_tokens:20,cache_read_input_tokens:8,cache_creation_input_tokens:2,output_tokens:0}}},{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'private reasoning'}},{type:'content_block_delta',delta:{type:'text_delta',text:'研究证据。'}},{type:'message_delta',delta:{stop_reason:stopped?'max_tokens':'end_turn'},usage:{output_tokens:5}},{type:'message_stop'}]
 res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''))
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 try{const address=server.address() as {port:number},config:ProviderConfig={kind:'anthropic',baseUrl:'http://127.0.0.1:'+address.port+'/v1',model:'model-a',targetLanguage:'zh-CN',consent:false},input={mode:'selection' as const,text:'Research evidence.',context:'',itemId:null,sourceLanguage:'en'}
 assert.deepEqual((await listModels(config,'fixture-key')).map(m=>m.id),['model-a','model-b']);assert.equal(modelRequests,2)
 let chunks='';const result=await translateRemote(config,'fixture-key',prepare(input,config,[]),new AbortController().signal,c=>chunks+=c,{purpose:'test',record:async a=>attempts.push(a)})
 assert.equal(result.text,'研究证据。');assert.equal(chunks,result.text);assert.equal(attempts[0].inputTokens,30);assert.equal(attempts[0].totalTokens,35);assert.equal(attempts[0].cachedInputTokens,8)
 stopped=true;await assert.rejects(()=>translateRemote(config,'fixture-key',prepare(input,config,[]),new AbortController().signal,()=>undefined),/未正常完成/)
 const usage=reportedUsage('anthropic',{type:'message_delta',usage:{output_tokens:10}},reportedUsage('anthropic',{message:{usage:{input_tokens:20,cache_read_input_tokens:8}}},unknownUsage()));assert.equal(usage.totalTokens,38)
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
})
